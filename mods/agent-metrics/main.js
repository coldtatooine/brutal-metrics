// Per-agent usage metrics for the selected space: context, tokens, cost, and a blink
// for agents that need a human (blocked) or are waiting on other agents.
// Data: Claude Code transcripts, read in WSL by collect.py. Read-only; no network.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { avatar, animated } from "./avatar.js";
import { spaces, agents, terminals, panes, exec, hc, appHome, home, window, theme, run } from "herdr";

const DISTRO = "Ubuntu";
const REFRESH_MS = 5000;
// USD per million tokens: [input, output, cache read, cache write]. Estimates: edit to match your plan.
const PRICES = [
  [/opus/, [15, 75, 1.5, 18.75]],
  [/haiku/, [1, 5, 0.1, 1.25]],
  [/./, [3, 15, 0.3, 3.75]], // sonnet and anything unknown
];
const WARN = 0.6, HIGH = 0.8;
// Context window: Claude Code reports no limit, so infer it (over 200k means the 1M window).
const windowOf = (ctx) => (ctx > 200_000 ? 1_000_000 : 200_000);

const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
const money = (x) => (x >= 100 ? "$" + Math.round(x) : x >= 10 ? "$" + x.toFixed(1) : "$" + x.toFixed(2));

// Account of a session as the collector resolved it: login email, or the credential kind (API KEY, BEDROCK...).
const acctName = (a) => (a ? (a.kind === "login" ? a.email : a.label) : null);
const acctKey = (a) => acctName(a) ?? "?";

// Usage of the current turn (everything since the person's last prompt), in the same shape as a session.
function turnOf(s) {
  const t = s?.turn;
  return t ? { in: t.in, out: t.out, cache_read: t.cr, cache_write: t.cw, by_model: t.by } : s;
}

function cost(by) {
  let usd = 0;
  for (const [model, [i, o, cr, cw]] of Object.entries(by ?? {})) {
    const p = PRICES.find(([re]) => re.test(model))[1];
    usd += (i * p[0] + o * p[1] + cr * p[2] + cw * p[3]) / 1e6;
  }
  return usd;
}

// A Windows path as WSL sees it (C:\Users\you -> /mnt/c/Users/you); other paths unchanged.
function wslPath(p) {
  const u = p.replaceAll("\\", "/"), m = u.match(/^([A-Za-z]):\/(.*)$/);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : u;
}
const scriptPath = () => wslPath(appHome()) + "/mods/agent-metrics/collect.py";

// Low-poly rainbow border for a working agent's card: flat rainbow facets, alternately lit and shaded,
// stepping one facet per tick (the avatar's 200ms timer). An overlay: no size change, takes no clicks.
const RAINBOW = ["#ff4d4d", "#ff9f43", "#ffd93d", "#4ade80", "#38bdf8", "#818cf8", "#c084fc"];
const shade = (hex, k) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
const FX = 14, FY = 5, EDGE = 3;
function rainbowEdge(tick) {
  const n = 2 * (FX + FY);
  const at = (p) => { const i = (((p - tick) % n) + n) % n, b = RAINBOW[i % RAINBOW.length]; return i % 2 ? shade(b, 0.72) : b; };
  // Facets need an explicit cross size: a row centers its children instead of stretching them, so a facet
  // with only flex_1 is 0px tall and the top and bottom edges vanish.
  const hsegs = (count, pos) => Array.from({ length: count }, (_, i) => div().flex_1().h_full().bg(at(pos(i))));
  const vsegs = (count, pos) => Array.from({ length: count }, (_, i) => div().flex_1().w_full().bg(at(pos(i))));
  // One absolute strip per edge, so all four always draw: top and bottom run the width, left and right the height.
  return div().absolute().inset_0().overflow_hidden()
    .child(v_flex().absolute().inset_0().child(h_flex().w_full().h(EDGE).children(hsegs(FX, (i) => i))))
    .child(h_flex().absolute().inset_0().justify_end().child(v_flex().h_full().w(EDGE).children(vsegs(FY, (i) => FX + i))))
    .child(v_flex().absolute().inset_0().justify_end().child(h_flex().w_full().h(EDGE).children(hsegs(FX, (i) => FX + FY + (FX - 1 - i)))))
    .child(h_flex().absolute().inset_0().child(v_flex().h_full().w(EDGE).children(vsegs(FY, (i) => 2 * FX + FY + (FY - 1 - i)))));
}

export default class AgentMetrics extends View {
  init(_props, cx) {
    this.data = null;      // last collector output
    this.error = null;
    this.created = {};     // terminal address -> created_ms (never changes)
    this.width = 300;
    this.busy = false;
    this.tick = 0; this.anim = false;
    this.view = "turn"; // "turn" = last turn, "total" = whole session
    // Avatars step through their poses only while some agent is active (each tick redraws the window).
    cx.timer.every(200, (cx) => { if (this.anim) { this.tick++; cx.notify(); } });
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        for (const a of terminals().filter((x) => x.state === "live")) {
          if (this.created[a.address]) continue;
          try { this.created[a.address] = JSON.parse((await hc(["get", a.address, "--json"])).stdout).created_ms ?? 0; }
          catch (e) { this.created[a.address] = 0; }
        }
        const win = window()?.platform === "windows";
        const r = win
          ? await exec("wsl.exe", ["-d", DISTRO, "python3", scriptPath(), wslPath(home()) + "/.claude"])
          : await exec("python3", [scriptPath(), home() + "/.claude"]);
        if (r.code !== 0) throw new Error((r.stderr || "collector failed").split("\n").slice(-2).join(" "));
        this.data = JSON.parse(r.stdout);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
  }

  // terminal address -> collector session.
  // 1) the session that started just after the terminal was created (agent launched as the terminal's program);
  // 2) else the newest session running in the same folder (claude typed into a shell).
  match(list) {
    const out = {}, used = new Set(), sessions = this.data?.sessions ?? [];
    // 0) Same title: Claude Code sets the terminal title to its session title (ai-title, or the /rename),
    // which survives restarts and resumes, when terminal creation times say nothing. Sub-agents first, so
    // a parent whose title went stale and matches a sub-agent's falls through to the rules below.
    const clean = (x) => (x ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
    const titleOf = (addr) => agents().find((a) => a.address === addr)?.title
      || panes().find((p) => p.terminal === addr)?.title
      || terminals().find((x) => x.address === addr)?.title;
    for (const a of [...list].sort((x, y) => y.depth - x.depth)) {
      const t = clean(titleOf(a.address));
      if (!t) continue;
      const s = sessions.filter((s) => !used.has(s.session) && clean(s.title) === t).sort((x, y) => (y.mtime ?? 0) - (x.mtime ?? 0))[0];
      if (s) { out[a.address] = s; used.add(s.session); }
    }
    // Terminals started together launch their agents in the same order, so pair them in order:
    // the earliest unused session that started within a minute after each terminal's creation.
    const byStart = [...sessions].sort((x, y) => x.started - y.started);
    for (const a of [...list].filter((a) => this.created[a.address] && !out[a.address]).sort((x, y) => this.created[x.address] - this.created[y.address])) {
      const c = this.created[a.address];
      const s = byStart.find((s) => !used.has(s.session) && s.started - c >= -2000 && s.started - c < 60000);
      if (s) { out[a.address] = s; used.add(s.session); }
    }
    const norm = (p) => (p ?? "").replaceAll("\\", "/").replace(/^\/\/wsl[.]localhost\/[^/]+/i, "").replace(/\/+$/, "").toLowerCase();
    const cwds = Object.fromEntries(panes().map((p) => [p.terminal, p.cwd]));
    for (const a of list) {
      if (out[a.address]) continue;
      const here = norm(cwds[a.address] ?? terminals().find((x) => x.address === a.address)?.cwd);
      const cand = sessions.filter((s) => !used.has(s.session) && here && norm(s.cwd) === here).sort((x, y) => (y.mtime ?? 0) - (x.mtime ?? 0))[0];
      if (cand) { out[a.address] = cand; used.add(cand.session); }
    }
    return out;
  }

  // Brutalist summary: big mono numbers, thick borders, solid blocks. Turns red and blinks when someone is needed.
  hero(t, { space, rows, totalUsd, totalTok, cachePct, ctxPct, cfg, needs, waiting, accounts }) {
    const MONO = "JetBrains Mono";
    const hot = needs > 0;
    // Palette grays from the reference still; rust (#95553a) when someone is needed.
    const bg = hot ? "#95553a" : "#7a8076", fg = "#0a1312", edge = hot ? "#b09270" : "#95a7a7";
    // Compact stat cell: value over label, centered, thin rule on the right. `warn` tints the value.
    const cell = (value, label, last, warn) => v_flex().flex_1().min_w(0).px(4).py(4).items_center()
      .when(!last, (el) => el.border_r(2).border_color(fg))
      .child(div().text_size(15).font_family(MONO).font_black().text_color(warn ? "#522d1b" : fg).truncate().child(value))
      .child(div().text_size(9).font_family(MONO).font_bold().text_color(fg).child(label));
    return div().flex_none().p(8).child(v_flex().w_full().border(3).border_color(edge).bg(bg)
      .when(hot || waiting > 0, (el) => el.child(h_flex().px(10).pt(6).items_center().gap(8)
        .child(div().flex_1())
        .when(hot, (el) => el.child(div().px(6).bg(fg).text_size(11).font_family(MONO).font_black().text_color(bg).loop("opacity", { from: 0.25, to: 1, period: 650 }).child(`${needs} NEEDS YOU`)))
        .when(!hot && waiting > 0, (el) => el.child(div().px(6).border(2).border_color(fg).text_size(11).font_family(MONO).font_black().text_color(fg).loop("opacity", { from: 0.4, to: 1, period: 1500 }).child(`${waiting} WAITING`)))))
      .child(h_flex().px(10).pt(6).pb(2).gap(6)
        .children([["turn", "LAST TURN"], ["total", "TOTAL COST"]].map(([k, label]) => {
          const on = this.view === k;
          return div().id(`view-${k}`).flex_1().h(18).flex().items_center().justify_center().cursor_pointer()
            .text_size(10).font_family(MONO).font_black().border(2).border_color(fg)
            .bg(on ? fg : "#00000000").text_color(on ? bg : fg)
            .tooltip(k === "turn" ? "Cost, tokens and cache since the last prompt" : "Cost, tokens and cache of the whole session")
            .on_click((_e, cx) => { cx.stop_propagation(); this.view = k; cx.notify(); })
            .child(label);
        })))
      .child(div().px(10).text_size(42).font_family(MONO).font_black().text_color(fg).truncate().child(money(totalUsd)))
      .child(h_flex().border_t(2).border_color(fg)
        .child(cell(String(rows.length), "AGENTS"))
        .child(cell(fmt(totalTok), "TOKENS"))
        .child(cell(`${cachePct}%`, "CACHE"))
        .child(cell(`${Math.round(ctxPct * 100)}%`, "CTX MAX", true, ctxPct >= HIGH)))
      .child(h_flex().border_t(2).border_color(fg)
        .child(cell(String(cfg.plugins), "PLUGINS"))
        .child(cell(String(cfg.mcp), "MCP"))
        .child(cell(String(cfg.hooks), "HOOKS", true)))
      .child(h_flex().border_t(2).border_color(fg).px(10).py(5).gap(8).items_start()
        .child(div().flex_none().text_size(10).font_family(MONO).font_bold().text_color(fg).child(accounts.length > 1 ? `${accounts.length} CONTAS` : (accounts[0]?.org ?? "CONTA").toUpperCase()))
        .child(v_flex().flex_1().min_w(0)
          .children((accounts.length ? accounts : [{ name: "?" }]).map((x) =>
            div().truncate().text_size(11).font_family(MONO).font_black().text_color(fg).child(accounts.length > 1 ? `${x.name} ×${x.n}` : x.name))))));
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const all = terminals();
    // Agents shown in this space, then their sub-agents (terminals an agent started), indented under them.
    const top = agents().filter((a) => a.space === space?.id);
    const list = [];
    const walk = (addr, depth) => {
      for (const x of all.filter((x) => x.parent === addr && x.state === "live")) {
        list.push({ address: x.address, status: x.status, focused: false, depth, name: x.name });
        walk(x.address, depth + 1);
      }
    };
    for (const a of top) {
      list.push({ address: a.address, status: a.status, focused: a.focused, depth: 0, name: all.find((x) => x.address === a.address)?.name || a.title || a.address });
      walk(a.address, 1);
    }
    const sess = this.match(list);

    const rows = list.map((a) => {
      const kids = all.filter((x) => x.parent === a.address && x.state === "live" && (x.status === "working" || x.status === "blocked"));
      const state = a.status === "blocked" ? "blocked" : kids.length > 0 ? "waiting" : a.status;
      const s = sess[a.address];
      const u = this.view === "total" ? s : turnOf(s);
      const usd = u ? cost(u.by_model) : 0;
      return { a, name: a.name, kids, state, s, u, usd };
    });

    // Accounts in this space, from each agent's own session; most used first.
    const tally = new Map();
    for (const r of rows) {
      const k = acctKey(r.s?.account);
      const e = tally.get(k) ?? { name: k === "?" ? "?" : k, org: r.s?.account?.org ?? null, n: 0 };
      e.n++; tally.set(k, e);
    }
    const accounts = [...tally.values()].sort((x, y) => y.n - x.n);
    const mainAcct = accounts[0]?.name;
    this.anim = rows.some((r) => animated(r.state));
    const totalUsd = rows.reduce((x, r) => x + r.usd, 0);
    const totalTok = rows.reduce((x, r) => x + (r.u ? r.u.in + r.u.out + r.u.cache_write : 0), 0);
    // Space-wide cache hit (same formula as a card) and the fullest context among its agents.
    const cs = rows.filter((r) => r.s);
    const cachePct = Math.round((cs.reduce((x, r) => x + r.u.cache_read, 0) / Math.max(1, cs.reduce((x, r) => x + r.u.in + r.u.cache_read + r.u.cache_write, 0))) * 100);
    const ctxPct = cs.reduce((x, r) => Math.max(x, r.s.ctx / windowOf(r.s.ctx)), 0);
    // What the space's folders have configured: the union over its agents, so a shared user setting counts once.
    const union = (k) => new Set(cs.flatMap((r) => r.s.config?.[k] ?? [])).size;
    const cfg = { plugins: union("plugins"), mcp: union("mcp"), hooks: union("hooks") };
    const needs = rows.filter((r) => r.state === "blocked").length;
    const waiting = rows.filter((r) => r.state === "waiting").length;

    const color = { blocked: t.blocked, waiting: t.accent, working: t.working, done: t.done, idle: t.dim };
    // Brutalist rows: square blocks, 2px borders, mono caps, a solid status stamp, a chunky segmented bar.
    const MONO = "JetBrains Mono";
    const label = (r) => r.state === "blocked" ? "NEEDS YOU"
      : r.state === "waiting" ? `WAITING ${r.kids.length}`
      : r.state.toUpperCase();

    const stamp = (r) => {
      const c = color[r.state] ?? t.dim, solid = r.state === "blocked" || r.state === "waiting" || r.state === "working";
      const el = div().flex_none().px(6).h(18).flex().items_center().text_size(10.5).font_family(MONO).font_black()
        .border(2).border_color(c).bg(solid ? c : "#00000000").text_color(solid ? (t.accent_foreground ?? t.background) : c).child(label(r));
      if (r.state === "blocked") return el.loop("opacity", { from: 0.2, to: 1, period: 650 });
      if (r.state === "waiting") return el.loop("opacity", { from: 0.45, to: 1, period: 1500 });
      return el;
    };

    // Context bar like /context: base (system prompt, tools, rules, skills, MCP = the session's first turn),
    // conversation (the rest), free. Palette: gray, sand, rust when nearly full.
    const SEGS = 24;
    const BASE_C = "#7a8076", CONV_C = "#b09270", HIGH_C = "#95553a", FREE_C = "#1d1e19";
    const bar = (r) => {
      const ctx = r.s?.ctx ?? 0, win = windowOf(ctx), base = Math.min(r.s?.base ?? 0, ctx);
      const nBase = base > 0 ? Math.max(1, Math.round((base / win) * SEGS)) : 0;
      const nUsed = Math.min(SEGS, Math.max(nBase, Math.round((ctx / win) * SEGS)));
      const conv = ctx / win >= HIGH ? HIGH_C : CONV_C;
      return h_flex().h(5).w_full().gap(2).children(Array.from({ length: SEGS }, (_, i) =>
        div().flex_1().h_full().bg(i < nBase ? BASE_C : i < nUsed ? conv : FREE_C)));
    };
    // ~N turns until the window is full, from the average growth of the last turns (null when not growing).
    const turnsLeft = (s) => {
      const h = s?.hist ?? [], d = [];
      for (let i = 1; i < h.length; i++) if (h[i] > h[i - 1]) d.push(h[i] - h[i - 1]);
      if (d.length < 2) return null;
      const avg = d.reduce((x, y) => x + y, 0) / d.length;
      return Math.max(0, Math.ceil((windowOf(s.ctx) - s.ctx) / avg));
    };
    const age = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

    // /clear: types /clear into the agent's terminal, starting a fresh context. It throws the conversation
    // away, so the first click arms it (CONFIRM?) and a second click within 3s sends it.
    const ARM_MS = 3000;
    const clearBtn = (r) => {
      const armed = this.armed?.address === r.a.address && Date.now() - this.armed.at < ARM_MS;
      return div().id(`clr-${r.a.address}`).flex_none().px(6).h(18).flex().items_center()
        .text_size(10.5).font_family(MONO).font_black().cursor_pointer()
        .border(2).border_color(armed ? t.blocked : t.border)
        .bg(armed ? t.blocked : "#00000000").text_color(armed ? (t.accent_foreground ?? t.background) : t.muted)
        .hover((s) => s.border_color(armed ? t.blocked : t.foreground).text_color(armed ? (t.accent_foreground ?? t.background) : t.foreground))
        .tooltip(armed ? "Click again to clear this agent's context" : "Run /clear in this agent")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (armed) {
            this.armed = null;
            hc(["send", r.a.address, "/clear"]).catch((e) => { this.error = String(e?.message ?? e); });
          } else {
            this.armed = { address: r.a.address, at: Date.now() };
          }
          cx.notify();
        })
        .child(armed ? "CONFIRM?" : "/CLEAR");
    };

    // /compact: summarizes the conversation in place, so nothing is lost and one click is enough.
    const compactBtn = (r) => div().id(`cmp-${r.a.address}`).flex_none().px(6).h(18).flex().items_center()
      .text_size(10.5).font_family(MONO).font_black().cursor_pointer()
      .border(2).border_color(t.border).text_color(t.muted)
      .hover((s) => s.border_color(t.foreground).text_color(t.foreground))
      .tooltip("Run /compact in this agent")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        hc(["send", r.a.address, "/compact"]).catch((e) => { this.error = String(e?.message ?? e); cx.notify(); });
      })
      .child("/COMPACT");

    const row = (r) => {
      const c = color[r.state] ?? t.dim, hot = r.state === "blocked", s = r.s, ctx = s?.ctx ?? 0;
      const ink = hot ? c : t.foreground, win = windowOf(ctx), pct = s ? ctx / win : 0;
      const left = turnsLeft(s);
      const cache = s ? Math.round((r.u.cache_read / Math.max(1, r.u.in + r.u.cache_read + r.u.cache_write)) * 100) : 0;
      const active = r.state === "working" || r.state === "blocked" || r.state === "waiting";
      // Processing: working itself, or a parent whose sub-agents are working (shown as WAITING).
      const working = r.state === "working" || r.state === "waiting" || r.a.status === "working";
      return h_flex().id(`m-${r.a.address}`).w_full().ml(r.a.depth * 12).relative()
        .border(2).border_color(working ? "#00000000" : hot ? c : t.border).bg(hot ? c + "26" : t.surface)
        .child(v_flex().flex_none().self_stretch().w(r.a.depth > 0 ? 46 : 60).pl(2).items_center().pb(4).bg(t.chrome).border_r(2).border_color(hot ? c : t.border)
          .child(div().flex_1().flex().items_center().justify_center()
            .child(avatar(r.a.address, r.a.depth > 0 ? 4 : 5, r.state, this.tick)))
          // terminal code (hc address), pinned to the bottom of the avatar column
          // click: open (focus) this agent's terminal; sub-agents without a pane get one
          .child(div().id(`term-${r.a.address}`).flex_none().px(3).cursor_pointer()
            .text_size(r.a.depth > 0 ? 9 : 10).font_family(MONO).font_bold().text_color(hot ? c : t.muted)
            .hover((s) => s.text_color(t.accent).underline())
            .tooltip(`Open terminal ${r.a.address}`)
            .on_click((_e, cx) => {
              cx.stop_propagation();
              try { run("agent.focus", { terminal: r.a.address }); }
              catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
            })
            .child(r.a.address)))
        .child(v_flex().flex_1().min_w(0).p(8).gap(6)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(r.a.depth > 0 ? 11 : 12).font_family(MONO).font_black().text_color(r.a.focused ? t.accent : ink).child(r.name.toUpperCase()))
            .when(accounts.length > 1 && acctKey(s?.account) !== mainAcct, (el) => el.child(div().flex_none().px(4).h(18).flex().items_center().border(2).border_color(t.foreground).text_size(10).font_family(MONO).font_black().text_color(t.foreground).child(`@${(acctName(s?.account) ?? "?").split("@").pop().split(".")[0].toUpperCase()}`)))
            .child(stamp(r)))
          .child(s ? bar(r) : div().h(5).border(2).border_color(t.border))
          .child(h_flex().gap(8).items_baseline().text_size(11).font_family(MONO).text_color(t.muted)
            .when(!s, (el) => el.child(div().font_bold().text_color(ink).child("NO DATA")))
            .when(Boolean(s), (el) => el
              .child(div().font_bold().text_color(pct >= HIGH ? t.blocked : ink).child(`${fmt(ctx)}/${fmt(win)}`))
              .child(`⚡${cache}%`)
              .when(left !== null, (e) => e.child(div().text_color(left <= 10 ? "#b09270" : t.muted).font_bold().child(`~${left > 99 ? "99+" : left}T`)))
              .child(s.mtime ? age(Date.now() - s.mtime) : "")
              .child(div().flex_1())
              .child(div().text_size(15).font_black().text_color(t.foreground).child(money(r.usd)))))
          .when(Boolean(s?.tool) && active, (el) => el.child(div().truncate().text_size(10.5).font_family(MONO).text_color(hot ? c : t.dim).child(`▸ ${s.tool}`)))
          .child(h_flex().justify_end().gap(6).child(compactBtn(r)).child(clearBtn(r))))
        // Last child: drawn over the avatar column and the content, so all four edges show.
        .when(working, (el) => el.child(rainbowEdge(this.tick)));
    };

    return v_flex().id("metrics-root").size_full().bg(t.chrome).overflow_hidden()
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .child(this.hero(t, { space, rows, totalUsd, totalTok, cachePct, ctxPct, cfg, needs, waiting, accounts }))
      .child(v_flex().id("metrics-list").flex_1().min_h(0).px(8).pb(8).gap(8).overflow_y_scrollbar()
        .when(rows.length === 0, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("No agents in this space")))
        .children(rows.map(row)));
  }
}
