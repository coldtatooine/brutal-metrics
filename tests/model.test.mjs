// Unit tests of mods/agent-metrics/model.js (pure logic). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const M = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "mods", "agent-metrics", "model.js")).href);

test("fmt scales k, M and B", () => {
  assert.equal(M.fmt(950), "950");
  assert.equal(M.fmt(12_400), "12k");
  assert.equal(M.fmt(1_250_000), "1.3M");
  assert.equal(M.fmt(2_000_000_000), "2.0B");
});

test("window is inferred: over 200k means 1M; a reported window wins", () => {
  assert.equal(M.winOf({ ctx: 150_000 }), 200_000);
  assert.equal(M.winOf({ ctx: 250_000 }), 1_000_000);
  assert.equal(M.winOf({ ctx: 10, window: 400_000 }), 400_000);
});

test("kindOfApp and isCodex", () => {
  assert.equal(M.kindOfApp("claude-code"), "claude");
  assert.equal(M.kindOfApp("codex"), "codex");
  assert.equal(M.kindOfApp("pi"), null);
  assert.equal(M.isCodex({ agent: "codex" }), true);
  assert.equal(M.isCodex({}), false);
});

test("kindOfApp knows omp, and isOmp reads the session", () => {
  assert.equal(M.kindOfApp("omp"), "omp");
  assert.equal(M.kindOfApp("oh-my-pi"), null);
  assert.equal(M.isOmp({ agent: "omp" }), true);
  assert.equal(M.isOmp({ agent: "codex" }), false);
});

test("account names", () => {
  assert.equal(M.acctName({ kind: "login", email: "a@b.c" }), "a@b.c");
  assert.equal(M.acctName({ kind: "env", label: "API KEY" }), "API KEY");
  assert.equal(M.acctKey(null), "?");
});

test("turnOf maps the turn object to a session-shaped usage", () => {
  const s = { turn: { in: 1, out: 2, cr: 3, cw: 4, by: { m: [1] } } };
  assert.deepEqual(M.turnOf(s), { in: 1, out: 2, cache_read: 3, cache_write: 4, by_model: { m: [1] } });
  const bare = { in: 9 };
  assert.equal(M.turnOf(bare), bare);
});

test("turnsLeft: null when not growing, else turns until the window is full", () => {
  assert.equal(M.turnsLeft({ hist: [10, 10, 10], ctx: 10 }), null);
  assert.equal(M.turnsLeft({ hist: [1000] , ctx: 1000 }), null);
  // grows 10k a turn, 100k used of 200k: 10 turns left
  assert.equal(M.turnsLeft({ hist: [80_000, 90_000, 100_000], ctx: 100_000 }), 10);
});

test("age", () => {
  assert.equal(M.age(10_000), "now");
  assert.equal(M.age(5 * 60_000), "5m");
  assert.equal(M.age(2 * 3_600_000), "2h");
  assert.equal(M.age(3 * 86_400_000), "3d");
});

test("normPath drops the WSL prefix, trailing slash and case", () => {
  assert.equal(M.normPath(String.raw`\\wsl.localhost\Ubuntu\home\Ale\proj` + "\\"), "/home/ale/proj");
  assert.equal(M.normPath(null), "");
});

test("cost: a family fallback is an estimate, a known model is not", () => {
  const known = M.costOf({ "claude-sonnet-5-5": [1_000_000, 0, 0, 0, 0] });
  assert.equal(known.usd, 2);
  assert.equal(known.estimated, false);
  const unknown = M.costOf({ "claude-sonnet-9-9": [1_000_000, 0, 0, 0, 0] });
  assert.equal(unknown.estimated, true);
  assert.equal(M.moneyOf(1.2, true), "~$1.20");
  assert.equal(M.moneyOf(120, false), "$120");
});

// ---- matchSessions ----
const ctx = (over = {}) => ({ created: {}, titleOf: () => null, folderOf: () => "", kinds: {}, ...over });

test("match by title and folder, ahead of a newer session elsewhere", () => {
  const sessions = [
    { session: "s1", title: "Fix login", cwd: "/home/ale/a", mtime: 1, started: 0 },
    { session: "s2", title: "Fix login", cwd: "/home/ale/b", mtime: 9, started: 0 },
  ];
  const out = M.matchSessions(sessions, [{ address: "t1", depth: 0 }], ctx({ titleOf: () => "Fix login", folderOf: () => "/home/ale/a" }));
  assert.equal(out.t1.session, "s1");
});

test("a Claude session never goes to a Codex terminal", () => {
  const sessions = [{ session: "s1", title: "x", cwd: "/p", mtime: 1, started: 0 }];
  const out = M.matchSessions(sessions, [{ address: "t1", depth: 0 }], ctx({ titleOf: () => "x", folderOf: () => "/p", kinds: { t1: "codex" } }));
  assert.deepEqual(out, {});
});

test("terminals started together pair with sessions in order of start", () => {
  const sessions = [
    { session: "a", title: "", cwd: "/x", started: 1000, mtime: 1 },
    { session: "b", title: "", cwd: "/x", started: 2000, mtime: 1 },
  ];
  const list = [{ address: "t2", depth: 0 }, { address: "t1", depth: 0 }];
  const out = M.matchSessions(sessions, list, ctx({ created: { t1: 900, t2: 1900 } }));
  assert.equal(out.t1.session, "a");
  assert.equal(out.t2.session, "b");
});

test("last resort: the newest unused session in the same folder", () => {
  const sessions = [
    { session: "old", cwd: "/p", mtime: 1, started: 0 },
    { session: "new", cwd: "/p", mtime: 5, started: 0 },
  ];
  const out = M.matchSessions(sessions, [{ address: "t1", depth: 0 }], ctx({ folderOf: () => "/p" }));
  assert.equal(out.t1.session, "new");
});

// ---- omp: pid, machine, title ----
const omp = (over) => ({ agent: "omp", mtime: 1, started: 0, cwd: "/p", ...over });

test("omp: the terminal's foreground pid pairs it with the session that process writes, whatever the titles say", () => {
  const sessions = [omp({ session: "a", pid: 100, title: "Same" }), omp({ session: "b", pid: 200, title: "Same" })];
  const list = [{ address: "t1", depth: 0 }, { address: "t2", depth: 0 }];
  const out = M.matchSessions(sessions, list, ctx({ titleOf: () => "Same", folderOf: () => "/p", kinds: { t1: "omp", t2: "omp" }, pids: { t1: 200, t2: 100 } }));
  assert.equal(out.t1.session, "b");
  assert.equal(out.t2.session, "a");
});

test("omp: a pid from another machine never matches, even when the number is the same", () => {
  const sessions = [omp({ session: "far", pid: 100, machine: "box" })];
  const out = M.matchSessions(sessions, [{ address: "t1", depth: 0 }], ctx({ kinds: { t1: "omp" }, pids: { t1: 100 }, folderOf: () => "/p" }));
  assert.deepEqual(out, {});
});

test("a terminal on a machine only takes that machine's sessions, in every rule", () => {
  const sessions = [omp({ session: "here", title: "Fix", pid: 1 }), omp({ session: "box", title: "Fix", pid: 1, machine: "box" })];
  const out = M.matchSessions(sessions, [{ address: "box/t3", depth: 0 }], ctx({ titleOf: () => "Fix", folderOf: () => "/p", kinds: { "box/t3": "omp" }, pids: { "box/t3": 1 } }));
  assert.equal(out["box/t3"].session, "box");
  const local = M.matchSessions(sessions, [{ address: "t3", depth: 0 }], ctx({ titleOf: () => "Fix", folderOf: () => "/p", kinds: { t3: "omp" } }));
  assert.equal(local.t3.session, "here");
});

test("omp titles: the π, spinner and icon prefix of the terminal title is ignored", () => {
  const sessions = [omp({ session: "a", title: "Fix the login form" })];
  const out = M.matchSessions(sessions, [{ address: "t1", depth: 0 }], ctx({ titleOf: () => "π ⠴ ✨ Fix the login form", folderOf: () => "/p", kinds: { t1: "omp" } }));
  assert.equal(out.t1.session, "a");
});

test("an omp session never goes to a Claude terminal", () => {
  const sessions = [omp({ session: "a", title: "x", pid: 5 })];
  const out = M.matchSessions(sessions, [{ address: "t1", depth: 0 }], ctx({ titleOf: () => "x", folderOf: () => "/p", kinds: { t1: "claude" } }));
  assert.deepEqual(out, {});
});
