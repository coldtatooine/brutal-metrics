// Where the Flow tab's message events come from. Every event has the collector's contract shape
// (collect.py `events[]`: id, seq, ts, from, from_name, to, to_session, kind, summary), with `to`
// already resolved to an hc address.
//   MODE "shared": agent-metrics publishes the collector's window, `to` resolved by its match(),
//                  in shared state KEY as { ok, at, orchestrator, events }. This mod never runs collect.py.
//                  While that feed is missing, failed (ok false) or stale (no write for STALE_MS), the
//                  tab falls back to the mock below.
//   MODE "mock":   simulated sends between the space's real agents, always.
import { shared } from "herdr";

export const MODE = "shared";
const STALE_MS = 40000;
export const KEY = "flow.events";
// Who orchestrates when nothing better says so (no `role=orchestrator` label, no published value).
export const ORCHESTRATOR_HINT = "t24";
const WINDOW = 50, SUMMARY = 60;

const SAMPLES = [
  "TAREFA: revisar o contrato da aba Flow",
  "OK, pode implementar os itens 1 a 6",
  "check passou, sync feito, errors vazio",
  "contrato em flow-contract.md",
  "aguardo OK do Chief of Staff",
  "preciso de uma decisao sobre o rainbow",
  "collect.py validado contra transcripts",
  "rodar herdr-app check em agent-flow",
  "feito: botao Flow no tab bar",
  "nao edite collect.py ate eu avisar",
];

let seq = 0;
const log = [];
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

// One simulated send between `addresses`: mostly to or from the orchestrator, sometimes agent to agent.
export function mockTick(addresses, orchestrator) {
  const others = addresses.filter((a) => a !== orchestrator);
  if (!orchestrator || others.length === 0) return null;
  const r = Math.random();
  let from, to;
  if (r < 0.45 || others.length < 2) { from = orchestrator; to = pick(others); }
  else if (r < 0.8) { from = pick(others); to = orchestrator; }
  else { from = pick(others); to = pick(others.filter((a) => a !== from)); }
  if (r >= 0.45 && r < 0.8 && others.length < 2) [from, to] = [to, from];
  seq++;
  const ev = { id: `mock:${seq}`, seq, ts: Date.now(), from, from_name: null, to, to_session: null, kind: "send", summary: pick(SAMPLES).slice(0, SUMMARY) };
  log.push(ev);
  if (log.length > WINDOW) log.shift();
  return ev;
}

// The live feed, or null (mock mode, not published yet, collector failed, or stale).
function feed() {
  if (MODE !== "shared") return null;
  const s = shared(KEY);
  return s && s.ok && Array.isArray(s.events) && Date.now() - (s.at ?? 0) < STALE_MS ? s : null;
}
// True when the events are real (else they are simulated).
export const live = () => feed() !== null;

// The current window of events, oldest first, only those whose receiver is known.
export function events() {
  const s = feed();
  return s ? s.events.filter((e) => e && e.from && e.to) : log;
}

// `reply` = a send A to B after an earlier B to A in the window (the collector only emits `send`).
export function withKinds(evs) {
  const seen = new Set();
  return evs.map((e) => {
    const kind = e.kind === "send" && seen.has(`${e.to}>${e.from}`) ? "reply" : e.kind;
    seen.add(`${e.from}>${e.to}`);
    return kind === e.kind ? e : { ...e, kind };
  });
}

const roleOf = (labels) => (Array.isArray(labels) ? labels.find((l) => /^role=/.test(l))?.slice(5) : labels?.role);

// The orchestrator: published value, then an hc label role=orchestrator, then (mock) the hint,
// then the node that sent to the most distinct agents, then the hint, then the first node.
export function orchestratorOf(nodes, evs) {
  const addrs = new Set(nodes.map((n) => n.address));
  const real = live();
  const pub = real ? feed().orchestrator : null;
  if (pub && addrs.has(pub)) return pub;
  const labeled = nodes.find((n) => roleOf(n.labels) === "orchestrator");
  if (labeled) return labeled.address;
  if (!real && addrs.has(ORCHESTRATOR_HINT)) return ORCHESTRATOR_HINT;
  const outs = new Map();
  for (const e of evs) {
    if (!addrs.has(e.from) || !e.to) continue;
    if (!outs.has(e.from)) outs.set(e.from, new Set());
    outs.get(e.from).add(e.to);
  }
  let best = null, most = 0;
  for (const [a, s] of outs) if (s.size > most) { best = a; most = s.size; }
  if (best) return best;
  if (addrs.has(ORCHESTRATOR_HINT)) return ORCHESTRATOR_HINT;
  return nodes[0]?.address ?? null;
}
