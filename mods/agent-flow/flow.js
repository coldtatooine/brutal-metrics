// Geometry of the Flow tab: a vertical flowchart sized to the panel. Pure data (points in px), no elements.
//
//   +-----------------------------+   the orchestrator, full width
//   +--+--------------------------+
//      |                              trunk: from the orchestrator down to the last agent
//      +--> [ agent 1 ]---+           stub into every agent (orchestrator lines are always drawn)
//      +--> [ agent 2 ]   |  lane     one lane on the right per pair of agents that messaged each other
//      +--> [ agent 3 ]<--+
export const PAD = 8;
const TRUNK_DX = 12, STUB = 16, LANE_PAD = 10, LANE_GAP = 6, COS_H = 64, MAX_LANES = 4;
const NODE_H = 52, NODE_GAP = 10, COMPACT_H = 40, COMPACT_GAP = 8;

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const lengthOf = (a, b) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

// width/height: the panel; others: agent addresses top to bottom; events: oldest first.
export function plan({ width, height, orchestrator, others, events, now, hotMs }) {
  const idx = new Map(others.map((a, i) => [a, i]));
  // Peer pairs, most recent last; only the last MAX_LANES keep a lane.
  const peers = [];
  for (const e of events) {
    if (e.from === orchestrator || e.to === orchestrator || e.from === e.to || !idx.has(e.from) || !idx.has(e.to)) continue;
    const k = key(e.from, e.to), j = peers.indexOf(k);
    if (j >= 0) peers.splice(j, 1);
    peers.push(k);
  }
  const lanes = peers.slice(-MAX_LANES);

  const n = others.length;
  // Compact nodes when the full-size column would not fit the panel's height.
  const roomy = COS_H + 2 * PAD + 16 + n * (NODE_H + NODE_GAP) <= height;
  const NH = roomy ? NODE_H : COMPACT_H, GAP = roomy ? NODE_GAP : COMPACT_GAP;
  const tx = PAD + TRUNK_DX, x0 = tx + STUB;
  const laneW = lanes.length ? LANE_PAD * 2 + (lanes.length - 1) * LANE_GAP : 0;
  const x1 = Math.max(x0 + 120, width - PAD - laneW);
  const cos = { x: PAD, y: PAD, w: Math.max(160, width - 2 * PAD), h: COS_H };
  const top0 = cos.y + cos.h + 16;
  const boxes = others.map((_, i) => ({ x: x0, y: top0 + i * (NH + GAP), w: x1 - x0, h: NH }));
  const mid = (i) => boxes[i].y + NH / 2;
  const laneX = (k) => x1 + LANE_PAD + k * LANE_GAP;
  const cosPts = (i) => [{ x: tx, y: cos.y + cos.h }, { x: tx, y: mid(i) }, { x: x0, y: mid(i) }];

  // Points from sender to receiver, or null when there is no line between them.
  const route = (from, to) => {
    if (from === to) return null;
    if (from === orchestrator && idx.has(to)) return cosPts(idx.get(to));
    if (to === orchestrator && idx.has(from)) return cosPts(idx.get(from)).reverse();
    if (!idx.has(from) || !idx.has(to)) return null;
    const k = lanes.indexOf(key(from, to));
    if (k < 0) return null;
    const X = laneX(k), ya = mid(idx.get(from)), yb = mid(idx.get(to));
    return [{ x: x1, y: ya }, { x: X, y: ya }, { x: X, y: yb }, { x: x1, y: yb }];
  };

  const lines = [];
  if (n) {
    lines.push([{ x: tx, y: cos.y + cos.h }, { x: tx, y: mid(n - 1) }]);
    boxes.forEach((_, i) => lines.push([{ x: tx, y: mid(i) }, { x: x0, y: mid(i) }]));
  }
  for (const k of lanes) { const [a, b] = k.split("|"); lines.push(route(a, b)); }

  // Hot edges: the latest send on each edge within hotMs, in its direction (sender to receiver).
  const hot = new Map();
  for (const e of events) {
    if (now - e.ts > hotMs) continue;
    const pts = route(e.from, e.to);
    if (pts) hot.set(key(e.from, e.to), pts);
  }

  return {
    cos, boxes, compact: !roomy, wide: width >= 520, lines, hot: [...hot.values()], route,
    height: (n ? boxes[n - 1].y + NH : cos.y + cos.h) + PAD,
  };
}
