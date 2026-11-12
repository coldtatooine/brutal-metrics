// How the Flow tab marks an active agent: the low-poly rainbow border of Metrics/Agents, and the avatar.
// Undecided between two options; switching is this one constant.
//   "A": native. The facet strip slides along each edge with .loop (no timer); the avatar keeps one pose.
//   "B": as Metrics/Agents. Facets step one per 200 ms tick and the avatar cycles its poses;
//        main.js then runs the 200 ms tick timer (needsTick) while an agent is active.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { avatar } from "./avatar.js";

export const MODE = "A";
export const needsTick = MODE === "B";

const RAINBOW = ["#ff4d4d", "#ff9f43", "#ffd93d", "#4ade80", "#38bdf8", "#818cf8", "#c084fc"];
const shade = (hex, k) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
const EDGE = 3;
const facet = (i) => { const b = RAINBOW[i % RAINBOW.length]; return i % 2 ? shade(b, 0.72) : b; };

export function agentAvatar(address, px, status, tick) {
  return avatar(address, px, status, MODE === "A" ? 0 : tick);
}

// Overlay for a w x h box: no size change, takes no clicks. Last child of a relative box.
export function activeEdge(w, h, tick) {
  return MODE === "A" ? slidingEdge(w, h) : steppingEdge(tick);
}

// A: one strip per edge, longer than the edge, sliding one rainbow cycle and back, natively.
const F = 10, SHIFT = F * RAINBOW.length * 2, PERIOD = 2800;
function slidingEdge(w, h) {
  const strip = (len, vertical, reverse) => {
    const count = Math.ceil((len + SHIFT) / F) + 1;
    const facets = Array.from({ length: count }, (_, i) => (vertical ? div().flex_none().w_full().h(F) : div().flex_none().h_full().w(F)).bg(facet(i)));
    const motion = { from: reverse ? -SHIFT : 0, to: reverse ? 0 : -SHIFT, period: PERIOD, easing: "linear" };
    return vertical
      ? v_flex().absolute().left(0).top(0).w(EDGE).h(count * F).children(facets).loop("top", motion)
      : h_flex().absolute().left(0).top(0).h(EDGE).w(count * F).children(facets).loop("left", motion);
  };
  // Each edge is anchored to the overlay's sides (top/right/bottom/left), not placed by w and h, so it
  // lands on the box's real edge whatever its border or the zoom. w and h only size the strips (longer
  // than needed is fine: the edge clips). Top and bottom run the full width, so the corners are covered.
  const across = (el) => el.left(0).right(0).h(EDGE).overflow_hidden();
  const along = (el) => el.top(0).bottom(0).w(EDGE).overflow_hidden();
  return div().absolute().inset_0()
    .child(across(div().absolute().top(0)).child(strip(w + 8, false, false)))
    .child(along(div().absolute().right(0)).child(strip(h + 8, true, false)))
    .child(across(div().absolute().bottom(0)).child(strip(w + 8, false, true)))
    .child(along(div().absolute().left(0)).child(strip(h + 8, true, true)));
}

// B: the Metrics/Agents border, stepping one facet per tick.
const FX = 14, FY = 5;
function steppingEdge(tick) {
  const n = 2 * (FX + FY);
  const at = (p) => facet((((p - tick) % n) + n) % n);
  const hsegs = (count, pos) => Array.from({ length: count }, (_, i) => div().flex_1().h_full().bg(at(pos(i))));
  const vsegs = (count, pos) => Array.from({ length: count }, (_, i) => div().flex_1().w_full().bg(at(pos(i))));
  return div().absolute().inset_0().overflow_hidden()
    .child(v_flex().absolute().inset_0().child(h_flex().w_full().h(EDGE).children(hsegs(FX, (i) => i))))
    .child(h_flex().absolute().inset_0().justify_end().child(v_flex().h_full().w(EDGE).children(vsegs(FY, (i) => FX + i))))
    .child(v_flex().absolute().inset_0().justify_end().child(h_flex().w_full().h(EDGE).children(hsegs(FX, (i) => FX + FY + (FX - 1 - i)))))
    .child(h_flex().absolute().inset_0().child(v_flex().h_full().w(EDGE).children(vsegs(FY, (i) => 2 * FX + FY + (FY - 1 - i)))));
}
