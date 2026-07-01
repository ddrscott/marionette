// Hand gesture primitives. The app's universal camera-input model is "open hand points, closed fist
// clicks" (see handCursor.ts, which builds the pointer + click on top of isFist).
import type { Landmark } from "./hands.ts";

// Closed FIST detector — the universal "click" across every scene (pick a fighter, press a key). A curled finger
// pulls its TIP closer to the wrist than its PIP knuckle; a fist is ≥3 of the four fingers curled.
// The thumb is ignored (it tucks unreliably), which keeps this robust to hand orientation.
const FIST_TIPS = [8, 12, 16, 20];
const FIST_PIPS = [6, 10, 14, 18];
export function isFist(lm: Landmark[]): boolean {
  const wrist = lm[0];
  const d = (i: number) => Math.hypot(lm[i].x - wrist.x, lm[i].y - wrist.y);
  let curled = 0;
  for (let k = 0; k < FIST_TIPS.length; k++) if (d(FIST_TIPS[k]) < d(FIST_PIPS[k])) curled++;
  return curled >= 3;
}

// PINCH detection — the finger-to-thumb "click". Uses ONLY the in-plane (x,y) gap of MediaPipe's world
// landmarks — the z axis is deliberately DROPPED. MediaPipe INFERS depth from a single 2D camera, and
// that guess is unreliable and biased by where the hand sits in the frame: measured live on /keyboard, a
// held pinky pinch keeps a small, stable x/y gap at every hand position, while z balloons ~linearly
// toward the frame edges (Δz/s ran 0.03 centred → 0.83 near the edge on a hand that was still touching),
// wrecking a full 3D distance. x and y are near-direct image observations, so the in-plane gap is the
// robust signal. Normalized by in-plane hand scale (wrist→middle-MCP) for size invariance: a real pinch
// sits well under the threshold at any position (~0.04–0.13 in testing), a non-pinched finger far above
// it (~0.35–0.85).
// TRADEOFF: dropping z re-admits one edge case — a hand rotated so the pinch axis points along the
// camera's depth (tips apart in z but aligned in x/y) can read as a pinch. Rare for a front-facing
// keyboard; add a palm-orientation gate if it ever shows up.
// PINCH_THRESHOLD / PINCH_TIPS are exported so the /keyboard debug overlay thresholds against the SAME
// number the detector does — no drift between what's shown and what fires a click.
export const PINCH_THRESHOLD = 0.25;
export const PINCH_TIPS = [8, 12, 16, 20]; // index, middle, ring, pinky fingertips
const dist2 = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y); // in-plane only — z is an unreliable inferred guess

// The ONE place the pinch ratio is computed: each fingertip's in-plane (x,y) distance to the thumb,
// normalized by in-plane hand scale (wrist→middle-MCP). pinchedFinger/isPinch consume this, and so does
// the debug overlay, so the displayed ratios are exactly the ones detection thresholds — DRY, single
// source of truth.
export function fingerThumbRatios(world: Landmark[]): { tip: number; ratio: number }[] {
  const thumb = world[4];
  const scale = dist2(world[9], world[0]) || 1e-3;
  return PINCH_TIPS.map((tip) => ({ tip, ratio: dist2(world[tip], thumb) / scale }));
}

// Which fingertip (8/12/16/20) is currently pinched to the thumb in 3D — the CLOSEST wins, so the
// gestures stay mutually exclusive — or -1 if none. Lets callers map different fingers to different
// actions (index/middle = press, pinky = delete).
export function pinchedFinger(world: Landmark[]): number {
  let best = -1, bestD = PINCH_THRESHOLD;
  for (const { tip, ratio } of fingerThumbRatios(world)) if (ratio < bestD) { bestD = ratio; best = tip; }
  return best;
}

// The primary "click" pinch = the index (8) or middle (12) tip to the thumb (the natural pinch fingers).
export function isPinch(world: Landmark[]): boolean {
  const f = pinchedFinger(world);
  return f === 8 || f === 12;
}
