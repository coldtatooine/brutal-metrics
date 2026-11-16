// Pure logic of the Metrics panel: no Herdr imports, so it runs under `node --test` (see scripts/).
// Prices, window and agent-kind rules, formatting, and the pairing of terminals with sessions.

// Anthropic API list prices, USD per million tokens: [input, output, cache read, cache write 5m, cache write 1h].
// Source: platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-12). Keyed by model id without a
// date suffix; "@long" is a request over the model's long-prompt size (the collector tags those).
export const PRICES = {
  "claude-fable-5-2": [8, 40, 0.2, 10, 16],
  "claude-mythos-5-2": [8, 40, 0.2, 10, 16],
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20],
  "claude-mythos-5-1": [10, 50, 0.25, 12.5, 20],
  "claude-fable-5": [10, 50, 1, 12.5, 20],
  "claude-mythos-5": [10, 50, 1, 12.5, 20],
  "claude-opus-5-5": [4, 20, 0.2, 5, 8],
  "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-7": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-6": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-1": [15, 75, 1.5, 18.75, 30],
  "claude-opus-4": [15, 75, 1.5, 18.75, 30],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5, 4],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-4-6": [3, 15, 0.3, 3.75, 6],
  "claude-sonnet-4-5": [3, 15, 0.3, 3.75, 6],
  "claude-sonnet-4": [3, 15, 0.3, 3.75, 6],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125, 0.2],
  "claude-haiku-5-5@long": [0.5, 2.5, 0.05, 0.625, 1],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2],
};
// A model not in the table: priced by its family's current model, and the cost is shown as an estimate (~).
export const FAMILY = [[/fable|mythos/, "claude-fable-5-2"], [/opus/, "claude-opus-5-5"], [/haiku/, "claude-haiku-5-5"], [/./, "claude-sonnet-5-5"]];
export const COST_TIP = "API-equivalent cost at Anthropic list prices, not what a subscription is billed";
export const WARN = 0.6, HIGH = 0.8;
// Context window: Claude Code reports no limit, so infer it (over 200k means the 1M window).
export const windowOf = (ctx) => (ctx > 200_000 ? 1_000_000 : 200_000);
// A session's window: Codex reports its own; Claude's is inferred from the context size.
export const winOf = (s) => s?.window || windowOf(s?.ctx ?? 0);
// Which agent a session or a terminal is: "claude", "codex", "omp", or null when the terminal doesn't say.
export const kindOfApp = (app) => (/codex/i.test(app ?? "") ? "codex" : /claude/i.test(app ?? "") ? "claude" : /\bomp\b/i.test(app ?? "") ? "omp" : null);
export const isCodex = (s) => s?.agent === "codex";
export const isOmp = (s) => s?.agent === "omp";

export const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));

export const money = (x) => (x >= 100 ? "$" + Math.round(x) : x >= 10 ? "$" + x.toFixed(1) : "$" + x.toFixed(2));

// Account of a session as the collector resolved it: login email, or the credential kind (API KEY, BEDROCK...).
export const acctName = (a) => (a ? (a.kind === "login" ? a.email : a.label) : null);
export const acctKey = (a) => acctName(a) ?? "?";

// Usage of the current turn (everything since the person's last prompt), in the same shape as a session.
export function turnOf(s) {
  const t = s?.turn;
  return t ? { in: t.in, out: t.out, cache_read: t.cr, cache_write: t.cw, by_model: t.by } : s;
}

// Price row of a collector model key: exact id, then the id without a date suffix (-20251001), else null.
export function priceOf(key) {
  const [id, tier] = key.split("@"), base = id.replace(/-\d{8}$/, ""), sfx = tier ? "@" + tier : "";
  return PRICES[id + sfx] ?? PRICES[base + sfx] ?? PRICES[base] ?? null;
}

// USD of a by-model usage map ({model: [in, out, cache read, write 5m, write 1h]}; an older 4-long row's write
// counts as 5m). `estimated` is true when some model with usage had no price of its own.
export function costOf(by) {
  let usd = 0, estimated = false;
  for (const [key, [i = 0, o = 0, cr = 0, w5 = 0, w1 = 0]] of Object.entries(by ?? {})) {
    let p = priceOf(key);
    if (!p) {
      p = PRICES[FAMILY.find(([re]) => re.test(key))[1]];
      if (i || o || cr || w5 || w1) estimated = true;
    }
    usd += (i * p[0] + o * p[1] + cr * p[2] + w5 * p[3] + w1 * p[4]) / 1e6;
  }
  return { usd, estimated };
}
export const moneyOf = (usd, estimated) => (estimated ? "~" : "") + money(usd);
export const costTip = (estimated) => COST_TIP + (estimated ? ". Estimated: a model here has no list price in the table, so its family's price is used" : "");

// A Windows path as WSL sees it (C:\Users\you -> /mnt/c/Users/you); other paths unchanged.
export function wslPath(p) {
  const u = p.replaceAll("\\", "/"), m = u.match(/^([A-Za-z]):\/(.*)$/);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : u;
}

// ~N turns until the window is full, from the average growth of the last turns (null when not growing).
export function turnsLeft(s) {
  const h = s?.hist ?? [], d = [];
  for (let i = 1; i < h.length; i++) if (h[i] > h[i - 1]) d.push(h[i] - h[i - 1]);
  if (d.length < 2) return null;
  const avg = d.reduce((x, y) => x + y, 0) / d.length;
  return Math.max(0, Math.ceil((winOf(s) - s.ctx) / avg));
}

// Time since the last activity: now, 5m, 2h, 3d.
export const age = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

// A path as comparable text: slashes, no \wsl.localhost\<distro> prefix, no trailing slash, lower case.
export const normPath = (p) => (p ?? "").replaceAll("\\", "/").replace(/^\/\/wsl[.]localhost\/[^/]+/i, "").replace(/\/+$/, "").toLowerCase();

// Pairs terminals with collector sessions. Pure: everything it needs about the terminals is passed in.
//   sessions: the collector's list (a session has `machine`: the remote machine's name, "" or absent for this one);
//   list: [{ address, depth }]; created: address -> created_ms;
//   titleOf(address): the terminal's title; folderOf(address): its normalized folder; kinds: address -> "claude" | "codex" | "omp";
//   pids: address -> the pid of the program in the terminal's foreground (omp reports its own pid, so that pairs exactly).
// A terminal's machine is the part of its address before "/"; it only takes sessions collected on that machine.
// Returns { address: session }.
export function matchSessions(sessions, list, { created, titleOf, folderOf, kinds, pids = {} }) {
  const out = {}, used = new Set();
  const machineOf = (addr) => (addr.includes("/") ? addr.slice(0, addr.indexOf("/")) : "");
  // 0) Same process: omp's session says which omp process writes it, and the terminal says which program runs in it.
  for (const a of list) {
    const pid = pids[a.address];
    if (!pid) continue;
    const s = sessions.find((s) => !used.has(s.session) && s.pid === pid && s.agent === "omp" && (s.machine ?? "") === machineOf(a.address));
    if (s) { out[a.address] = s; used.add(s.session); }
  }
  // 1) Same title: Claude Code sets the terminal title to its session title (ai-title, or the /rename),
  // which survives restarts and resumes, when terminal creation times say nothing. Sub-agents first, so
  // a parent whose title went stale and matches a sub-agent's falls through to the rules below.
  // omp prefixes it with "π", a spinner or ">" and a space: "π ⠴ Fix the login form".
  const clean = (x) => (x ?? "").replace(/^π\s+\S+\s+/u, "").replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
  // A session never goes to a terminal of another agent kind or machine; a terminal that reports no app takes any kind.
  const fits = (addr, s) => (!kinds[addr] || kinds[addr] === (s.agent ?? "claude")) && (s.machine ?? "") === machineOf(addr);
  // Codex titles its terminal "<thread name> | <folder>"; Claude Code uses the session title as is.
  const sameTitle = (term, sess) => Boolean(sess) && (term === sess || term.startsWith(sess + " | "));
  // Two sessions can share a title (two agents named after the same AGENTS.md). Pair title plus folder
  // first, then title alone, so a terminal in that folder isn't robbed by one elsewhere with the newer mtime.
  for (const sameFolder of [true, false]) {
    for (const a of [...list].sort((x, y) => y.depth - x.depth)) {
      if (out[a.address]) continue;
      const t = clean(titleOf(a.address)), here = folderOf(a.address);
      if (!t || (sameFolder && !here)) continue;
      const s = sessions.filter((s) => !used.has(s.session) && fits(a.address, s) && sameTitle(t, clean(s.title)) && (!sameFolder || normPath(s.cwd) === here))
        .sort((x, y) => (y.mtime ?? 0) - (x.mtime ?? 0))[0];
      if (s) { out[a.address] = s; used.add(s.session); }
    }
  }
  // Terminals started together launch their agents in the same order, so pair them in order:
  // the earliest unused session that started within a minute after each terminal's creation.
  const byStart = [...sessions].sort((x, y) => x.started - y.started);
  for (const a of [...list].filter((a) => created[a.address] && !out[a.address]).sort((x, y) => created[x.address] - created[y.address])) {
    const c = created[a.address];
    const s = byStart.find((s) => !used.has(s.session) && fits(a.address, s) && s.started - c >= -2000 && s.started - c < 60000);
    if (s) { out[a.address] = s; used.add(s.session); }
  }
  // Last: the newest unused session running in the same folder (an agent typed into a shell).
  for (const a of list) {
    if (out[a.address]) continue;
    const here = folderOf(a.address);
    const cand = sessions.filter((s) => !used.has(s.session) && fits(a.address, s) && here && normPath(s.cwd) === here).sort((x, y) => (y.mtime ?? 0) - (x.mtime ?? 0))[0];
    if (cand) { out[a.address] = cand; used.add(cand.session); }
  }
  return out;
}

// What the detail dialog shows about one session: a plain, JSON-safe snapshot (it travels through shared
// state, from the Metrics tab that owns the collector to the dialog, which runs in its own view).
export function detailOf(s) {
  if (!s) return null;
  const win = winOf(s), used = s.in + s.cache_read + s.cache_write;
  const t = turnOf(s);
  return {
    kind: s.agent ?? "claude", model: s.model ?? null, account: acctName(s.account), cwd: s.cwd ?? null,
    session: s.session ?? null, title: s.title ?? null, started: s.started ?? null, mtime: s.mtime ?? null,
    ctx: s.ctx ?? 0, win, base: Math.min(s.base ?? 0, s.ctx ?? 0),
    cachePct: Math.round((s.cache_read / Math.max(1, used)) * 100), left: turnsLeft(s),
    tokens: { in: s.in, out: s.out, cw: s.cache_write, cr: s.cache_read },
    turn: { in: t.in, out: t.out, cw: t.cache_write, cr: t.cache_read },
    turns: s.turns ?? 0, tools: s.tools ?? 0, tool: s.tool ?? null,
    planUsed: s.agent === "codex" && s.plan?.used != null ? Math.round(s.plan.used) : null,
    config: { plugins: s.config?.plugins ?? [], mcp: s.config?.mcp ?? [], hooks: s.config?.hooks ?? [] },
  };
}

// The dialog's label/value rows for a detailOf() snapshot. `now` (ms) is passed in so it stays pure.
export function detailRows(d, now) {
  if (!d) return [];
  const tok = (x) => fmt((x?.in ?? 0) + (x?.out ?? 0) + (x?.cw ?? 0));
  const rows = [
    ["MODEL", d.model ?? "—"],
    ["ACCOUNT", d.account ?? "?"],
    ["FOLDER", d.cwd ?? "—"],
    ["SESSION", d.session ? d.session.slice(0, 8) : "—"],
    ["CONTEXT", `${fmt(d.ctx)} / ${fmt(d.win)} (${Math.round((d.ctx / d.win) * 100)}%)`],
    ["BASE", `${fmt(d.base)} (system prompt, tools, rules, MCP)`],
    ["CACHE HIT", `${d.cachePct}%`],
    ["TURNS LEFT", d.left === null ? "—" : `~${d.left > 99 ? "99+" : d.left}`],
    ["TOKENS · SESSION", tok(d.tokens)],
    ["TOKENS · LAST TURN", tok(d.turn)],
    ["TURNS", String(d.turns)],
    ["TOOL CALLS", String(d.tools)],
    ["LAST TOOL", d.tool ?? "—"],
    ["STARTED", d.started ? `${age(now - d.started)} ago` : "—"],
    ["LAST ACTIVITY", d.mtime ? age(now - d.mtime) : "—"],
    ["CONFIGURED", `${d.config.plugins.length} plugins · ${d.config.mcp.length} MCP · ${d.config.hooks.length} hooks`],
  ];
  if (d.planUsed !== null) rows.splice(8, 0, ["PLAN USED", `${d.planUsed}%`]);
  return rows;
}
