// Pixel-art avatars for agents. Colors: the 10-swatch palette of the reference still
// (dark coal -> olive -> sage -> sky -> sand -> rust -> brown). Each agent gets a random body color
// and a random symmetric 8x8 sprite the first time it is seen; both are kept in shared state
// ("agent.avatars") so every mod shows the same avatar. Copy of this file lives in agents-metrics/.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, setShared } from "herdr";

export const PALETTE = ["#0a1312", "#1d1e19", "#3d3f34", "#7a8076", "#95a7a7", "#adc1cc", "#b09270", "#95553a", "#522d1b", "#26150d"];
// Body colors (the swatches that read on a dark UI) and the darker swatch used for shading each.
const BODY = [3, 4, 5, 6, 7, 8];
const SHADE = { 3: 2, 4: 3, 5: 4, 6: 7, 7: 8, 8: 9 };
const OUTLINE = PALETTE[0], LIGHT = PALETTE[5];

const KEY = "agent.avatars";
const pending = {};
let flushing = false;

function flush() {
  if (flushing) return;
  flushing = true;
  Promise.resolve().then(() => {
    flushing = false;
    const cur = { ...(shared(KEY) ?? {}) };
    let changed = false;
    for (const [addr, v] of Object.entries(pending)) {
      if (!cur[addr]) { cur[addr] = v; changed = true; }
      delete pending[addr];
    }
    if (changed) setShared(KEY, cur);
  });
}

// The agent's avatar record {c: palette index, s: sprite seed}; random on first sight, then fixed.
export function avatarOf(address) {
  const stored = (shared(KEY) ?? {})[address];
  if (stored) return stored;
  pending[address] ??= { c: BODY[Math.floor(Math.random() * BODY.length)], s: Math.floor(Math.random() * 2 ** 31) };
  flush();
  return pending[address];
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 8x8 grid, left half random and mirrored. 0 empty, 1 body, 2 shade, 3 eye, 4 outline.
function sprite(seed) {
  const r = rng(seed);
  const g = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let y = 1; y <= 6; y++) for (let x = 0; x < 4; x++) {
    const core = x >= 2 && y >= 2 && y <= 5;
    const on = core || r() < (y === 1 || y === 6 ? 0.45 : 0.62);
    if (on) g[y][x] = g[y][7 - x] = 1;
  }
  g[3][2] = g[3][5] = 3; // eyes
  for (let x = 0; x < 8; x++) if (g[5][x] === 1 && r() < 0.5) g[5][x] = 2; // a little shading
  for (let x = 0; x < 8; x++) if (g[6][x] === 1) g[6][x] = 2;
  // outline: empty cells touching a filled one
  const o = g.map((row) => row.slice());
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (g[y][x] !== 0) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (g[y + dy]?.[x + dx]) { o[y][x] = 4; break; }
    }
  }
  return o;
}

// Three poses cycled by a tick: 0 stand, 1 hop (up, feet shifted left), 2 blink-and-step (eyes shut, feet shifted right).
// The canvas is 8 wide, 9 tall so the hop has room. Standing sits on row 1.
function pose(base, f) {
  const g = Array.from({ length: 9 }, () => Array(8).fill(0));
  const off = f === 1 ? 0 : 1;
  const feet = f === 1 ? -1 : f === 2 ? 1 : 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let v = base[y][x];
    if (!v) continue;
    if (f === 2 && v === 3) v = 4; // eyes shut
    const nx = y >= 6 ? x + feet : x;  // feet and the outline under them shuffle
    if (nx >= 0 && nx < 8) g[y + off][nx] = v;
  }
  return g;
}

// Which pose each status shows at a given tick (the mods tick every 200 ms while something is active).
const frameOf = (status, tick) =>
  status === "blocked" ? tick % 3
  : status === "working" ? Math.floor(tick / 2) % 3
  : status === "waiting" ? Math.floor(tick / 4) % 3
  : 0;
export const animated = (status) => status === "blocked" || status === "working" || status === "waiting";

const cache = new Map();
// A px*8 by px*9 avatar. Active agents cycle the three poses; idle ones stand still, dimmed.
export function avatar(address, px = 3, status = "idle", tick = 0) {
  const { c, s } = avatarOf(address);
  const f = frameOf(status, tick), key = `${c}:${s}:${f}`;
  if (!cache.has(key)) cache.set(key, pose(sprite(s), f));
  const body = PALETTE[c], shade = PALETTE[SHADE[c]], eye = c >= 7 ? LIGHT : OUTLINE;
  const colors = { 1: body, 2: shade, 3: eye, 4: OUTLINE };
  const el = v_flex().flex_none().w(px * 8).h(px * 9).children(cache.get(key).map((row) =>
    h_flex().flex_none().h(px).children(row.map((v) => div().flex_none().size(px).bg(v ? colors[v] : "#00000000")))));
  return status === "idle" ? el.opacity(0.6) : el;
}
