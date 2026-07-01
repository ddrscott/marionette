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

// PINCH detection — the finger-to-thumb "click". Uses MediaPipe's 3D WORLD landmarks (metric, meters),
// NOT the 2D image projection: in 2D, rotating the hand collapses the thumb→finger gap and false-fires
// a pinch even when nothing touches. In true 3D that gap stays real, so rotation no longer reads as a
// pinch. Distance is normalized by 3D hand scale (wrist→middle-MCP) for size invariance. Open hand
// keeps the ratio ≳ 0.7, a real pinch ≲ 0.3.
// The pinch bar: a fingertip counts as pinched when its size-normalized 3D distance to the thumb is
// below this. Exported so diagnostics (the /keyboard debug overlay) show the SAME number the detector
// thresholds against — no drift between what's displayed and what fires a click.
export const PINCH_THRESHOLD = 0.45;
export const PINCH_TIPS = [8, 12, 16, 20]; // index, middle, ring, pinky fingertips
const dist3 = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// The ONE place the pinch ratio is computed: each fingertip's 3D distance to the thumb, normalized by
// hand scale (wrist→middle-MCP). pinchedFinger/isPinch consume this, and so does the debug overlay, so
// the displayed ratios are exactly the ones detection thresholds — DRY, single source of truth.
export function fingerThumbRatios(world: Landmark[]): { tip: number; ratio: number }[] {
  const thumb = world[4];
  const scale = dist3(world[9], world[0]) || 1e-3;
  return PINCH_TIPS.map((tip) => ({ tip, ratio: dist3(world[tip], thumb) / scale }));
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
