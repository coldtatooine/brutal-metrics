// Flow tab: who messages whom in the selected space, as a vertical flowchart. The orchestrator (Chief of
// Staff) sits on top with a line to every agent; agents that message each other get a lane on the right.
// Every send fires a pulse that runs the line from sender to receiver.
// Animation is native (.transition, .loop). The timers here only poll data and mount or unmount pulses.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, run, settings } from "herdr";
import { agentAvatar, activeEdge, needsTick } from "./active.js";
import { plan, lengthOf } from "./flow.js";
import * as source from "./source.js";

const MONO = "JetBrains Mono";
// Palette swatches (RECIPE): lines, hot line, pulse; the orchestrator block as the Metrics summary.
const LINE = "#3d3f34", HOT = "#95a7a7", PULSE = "#adc1cc", INK = "#0a1312", HERO = "#7a8076", HERO_EDGE = "#95a7a7";
const POLL_MS = 1000;     // new events and mock sends (data, not animation)
const HOT_MS = 6000;      // an edge stays lit this long after its last send
const SPEED = 0.3;        // pulse speed, px per ms
const MOCK_MS = [2000, 4000];

export default class AgentFlow extends View {
  init(_props, cx) {
    this.size = { width: 368, height: 600 };
    this.seen = null;       // event ids already drawn; null until the first poll so history doesn't replay
    this.pulses = [];       // { key, pts, durs, stage }
    this.firedAt = new Map(); // event id -> when its pulse fired (real events arrive ~20s after `ts`)
    this.geom = null;       // last plan(), for routing new pulses
    this.nextMock = Date.now() + 800;
    this.tick = 0; this.anim = false;
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    if (needsTick) cx.timer.every(200, (cx) => { if (this.anim) { this.tick++; cx.notify(); } });
  }

  // Agents of the selected space and their live sub-agent terminals, with a Metrics-style state.
  graph() {
    const space = spaces().find((s) => s.active);
    const all = terminals();
    const term = (addr) => all.find((x) => x.address === addr);
    const list = [];
    const walk = (addr) => {
      for (const x of all.filter((x) => x.parent === addr && x.state === "live")) {
        list.push({ address: x.address, status: x.status, focused: false, name: x.name || x.address, labels: x.labels });
        walk(x.address);
      }
    };
    for (const a of agents().filter((a) => a.space === space?.id)) {
      const x = term(a.address);
      list.push({ address: a.address, status: a.status, focused: a.focused, name: x?.name || a.title || a.address, labels: x?.labels });
      walk(a.address);
    }
    for (const n of list) {
      const busyKids = all.filter((x) => x.parent === n.address && x.state === "live" && (x.status === "working" || x.status === "blocked")).length;
      n.kids = busyKids;
      n.state = n.status === "blocked" ? "blocked" : busyKids > 0 ? "waiting" : n.status;
      n.active = n.state === "working" || n.state === "waiting" || n.status === "working";
    }
    // The feed covers every space; keep the sends between this space's nodes.
    const here = new Set(list.map((n) => n.address));
    const evs = source.withKinds(source.events()).filter((e) => here.has(e.from) && here.has(e.to));
    return { space, nodes: list, evs, orchestrator: source.orchestratorOf(list, evs) };
  }

  poll(cx) {
    // On the first poll, and whenever the source flips between real and simulated, take the window as
    // already seen: history (or the other source's ids) must not fire a burst of pulses.
    const real = source.live();
    if (!this.seen || real !== this.real) { this.seen = new Set(source.events().map((e) => e.id)); this.firedAt.clear(); this.real = real; cx.notify(); }
    for (const [id, at] of [...this.firedAt]) if (Date.now() - at > HOT_MS + 1000) this.firedAt.delete(id);
    if (!real && Date.now() >= this.nextMock) {
      const { nodes, orchestrator } = this.graph();
      source.mockTick(nodes.map((n) => n.address), orchestrator);
      this.nextMock = Date.now() + MOCK_MS[0] + Math.random() * (MOCK_MS[1] - MOCK_MS[0]);
    }
    const fresh = source.events().filter((e) => !this.seen.has(e.id));
    fresh.forEach((e, i) => { this.seen.add(e.id); this.firedAt.set(e.id, Date.now() + i * 300); this.fire(e, cx, i * 300); });
    // Redraw while an edge is lit, so it cools down.
    if (fresh.length || this.geom?.hot.length) cx.notify();
  }

  // One pulse: dots mount at the start of each segment, then get the segment's end as their target, and
  // .transition runs each segment after the previous one (delay). Removed once it has arrived.
  fire(ev, cx, delay) {
    const pts = this.geom?.route(ev.from, ev.to);
    if (!pts) return;
    const durs = pts.slice(1).map((b, k) => Math.max(90, lengthOf(pts[k], b) / SPEED));
    const total = durs.reduce((x, y) => x + y, 0);
    const p = { key: ev.id.replace(/[^A-Za-z0-9]/g, "_"), pts, durs, stage: 0 };
    cx.spawn(async (cx) => {
      if (delay) await cx.sleep(delay);
      this.pulses.push(p); cx.notify();
      await cx.sleep(50);
      p.stage = 1; cx.notify();
      await cx.sleep(total + 450);
      this.pulses = this.pulses.filter((x) => x !== p); cx.notify();
    });
  }

  render() {
    const t = theme();
    const { nodes, evs, orchestrator } = this.graph();
    // on_size_change reports window px; Herdr's zoom scales every px we draw, so divide it out.
    const zoom = settings()?.zoom || 1;
    const W = Math.floor(this.size.width / zoom), H = Math.floor(this.size.height / zoom);
    const root = v_flex().id("flow-root").size_full().bg(t.chrome).overflow_hidden()
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) {
          this.size = { width: size.width, height: size.height }; cx.notify();
        }
      });
    this.anim = nodes.some((n) => n.active);
    if (nodes.length < 2 || !orchestrator) {
      this.geom = null;
      return root.child(div().p(16).text_size(12).font_family(MONO).font_bold().text_color(t.dim)
        .child(nodes.length ? "FLOW NEEDS 2+ AGENTS IN THIS SPACE" : "NO AGENTS IN THIS SPACE"));
    }
    const cos = nodes.find((n) => n.address === orchestrator);
    const others = nodes.filter((n) => n !== cos);
    // Hot = recently fired here, not recently sent: the feed lags the send.
    const lit = evs.map((e) => ({ ...e, ts: this.firedAt.get(e.id) ?? 0 }));
    const g = plan({ width: W, height: H, orchestrator, others: others.map((n) => n.address), events: lit, now: Date.now(), hotMs: HOT_MS });
    this.geom = g;

    // Per node: sends out, sends in, and the latest one it took part in.
    const stats = new Map(nodes.map((n) => [n.address, { out: 0, in: 0, last: null }]));
    for (const e of evs) {
      const f = stats.get(e.from), r = stats.get(e.to);
      const text = (e.summary ?? "").replace(/\s+/g, " ");
      if (f) { f.out++; f.last = `→${e.to} ${text}`; }
      if (r) { r.in++; r.last = `${e.kind === "reply" ? "↩" : "←"}${e.from} ${text}`; }
    }

    const seg = (a, b, color) => (a.y === b.y
      ? div().absolute().left(Math.min(a.x, b.x) - 1).top(a.y - 1).w(Math.abs(b.x - a.x) + 2).h(2).bg(color)
      : div().absolute().left(a.x - 1).top(Math.min(a.y, b.y) - 1).w(2).h(Math.abs(b.y - a.y) + 2).bg(color));
    const poly = (pts, color) => pts.slice(1).map((b, k) => seg(pts[k], b, color));
    // Pixel-art arrowhead (2px columns or rows of 10, 6, 2) at the receiver's end.
    const arrow = (pts, color) => {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const bar = (w, h) => div().flex_none().w(w).h(h).bg(color);
      if (a.y === b.y) {
        const right = b.x > a.x, cells = [bar(2, 10), bar(2, 6), bar(2, 2)];
        return h_flex().absolute().left(right ? b.x - 6 : b.x).top(b.y - 5).w(6).h(10).items_center().children(right ? cells : cells.reverse());
      }
      const down = b.y > a.y, cells = [bar(10, 2), bar(6, 2), bar(2, 2)];
      return v_flex().absolute().left(b.x - 5).top(down ? b.y - 6 : b.y).w(10).h(6).items_center().children(down ? cells : cells.reverse());
    };

    const color = { blocked: t.blocked, waiting: t.accent, working: t.working, done: t.done, idle: t.dim };
    const stamp = (n, onHero) => {
      const c = onHero ? INK : color[n.state] ?? t.dim, solid = n.active || n.state === "blocked";
      const label = n.state === "blocked" ? "NEEDS YOU" : n.state === "waiting" ? `WAITING ${n.kids}` : String(n.state ?? "idle").toUpperCase();
      const el = div().flex_none().px(5).h(16).flex().items_center().text_size(9.5).font_family(MONO).font_black()
        .border(2).border_color(c).bg(solid ? c : "#00000000").text_color(solid ? (onHero ? HERO : t.accent_foreground ?? t.background) : c).child(label);
      if (n.state === "blocked") return el.loop("opacity", { from: 0.2, to: 1, period: 650 });
      if (n.state === "waiting") return el.loop("opacity", { from: 0.45, to: 1, period: 1500 });
      return el;
    };
    // Terminal code: click opens that agent's terminal, as on the Metrics cards.
    const code = (n, ink) => div().id(`fc-${n.address}`).flex_none().cursor_pointer().font_bold().text_color(ink)
      .hover((s) => s.text_color(t.accent).underline()).tooltip(`Open terminal ${n.address}`)
      .on_click((_e, cx) => { cx.stop_propagation(); try { run("agent.focus", { terminal: n.address }); } catch (e) { /* gone */ } })
      .child(n.address);

    const node = (n, box, hero) => {
      const s = stats.get(n.address), hot = n.state === "blocked";
      const edge = hero ? HERO_EDGE : hot ? t.blocked : t.border;
      const ink = hero ? INK : hot ? t.blocked : t.foreground, sub = hero ? INK : t.muted;
      const px = hero ? 5 : g.compact ? 3 : 4, colW = hero ? 56 : g.compact ? 34 : 46;
      return div().id(`fn-${n.address}`).absolute().left(box.x).top(box.y).w(box.w).h(box.h)
        .child(h_flex().size_full().relative().overflow_hidden()
          .border(hero ? 3 : 2).border_color(n.active ? "#00000000" : edge).bg(hero ? HERO : hot ? t.blocked + "26" : t.surface)
          .child(v_flex().flex_none().h_full().w(colW).items_center().justify_center().bg(t.chrome).border_r(2).border_color(hero ? INK : edge)
            .child(agentAvatar(n.address, px, n.state, this.tick)))
          .child(v_flex().flex_1().min_w(0).px(8).gap(hero ? 1 : 3).justify_center()
            .child(h_flex().gap(6).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(hero ? 11 : g.compact ? 11 : 12).font_family(MONO).font_black()
                .text_color(!hero && n.focused ? t.accent : ink).child(hero ? `${n.name.toUpperCase()} / ORCHESTRATOR` : n.name.toUpperCase()))
              .when(!source.live() && hero, (el) => el.child(div().flex_none().px(4).h(16).flex().items_center().border(2).border_color(INK)
                .text_size(9.5).font_family(MONO).font_black().text_color(INK).tooltip("Simulated sends until the collector feed is on").child("MOCK")))
              .child(stamp(n, hero)))
            .when(hero, (el) => el.child(h_flex().gap(8).items_baseline().font_family(MONO).text_color(INK)
              .child(div().text_size(20).font_black().child(`${evs.length} MSGS`))
              .child(div().text_size(10.5).child(code(n, INK)))
              .when(g.wide && Boolean(s.last), (e) => e.child(div().flex_1().min_w(0).truncate().text_size(10.5).child(`▸ ${s.last}`)))))
            .when(!hero, (el) => el.child(h_flex().gap(8).items_baseline().text_size(10.5).font_family(MONO).text_color(sub)
              .child(code(n, hot ? t.blocked : sub))
              .child(`↑${s.out} ↓${s.in}`)
              .when(g.wide && Boolean(s.last), (e) => e.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`▸ ${s.last}`))))))
          // Last child: drawn over everything, so all four edges show.
          .when(n.active, (el) => el.child(activeEdge(box.w, box.h, this.tick))));
    };

    const pulse = (p) => p.pts.slice(0, -1).map((a, k) => {
      const b = p.pts[k + 1], at = p.stage ? b : a;
      const delay = p.durs.slice(0, k).reduce((x, y) => x + y, 0);
      const move = { duration: p.durs[k], delay, easing: "linear" };
      return div().id(`fp-${p.key}-${k}`).absolute().left(at.x - 3).top(at.y - 3).size(6).bg(PULSE)
        .transition("left", move).transition("top", move)
        .opacity(k === 0 || p.stage ? 1 : 0).transition("opacity", { duration: 16, delay });
    });

    return root.child(div().id("flow-scroll").flex_1().min_h(0).overflow_y_scrollbar()
      .child(div().relative().w(W).h(g.height)
        .children(g.lines.flatMap((pts) => poly(pts, LINE)))
        .children(g.hot.flatMap((pts) => poly(pts, HOT)))
        .children(g.hot.map((pts) => arrow(pts, HOT)))
        .child(node(cos, g.cos, true))
        .children(others.map((n, i) => node(n, g.boxes[i], false)))
        .children(this.pulses.flatMap(pulse))));
  }
}
