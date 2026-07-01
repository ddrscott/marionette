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

// PINCH detector — the finger-to-thumb "click". Uses MediaPipe's 3D WORLD landmarks (metric, meters),
// NOT the 2D image projection: in 2D, rotating the hand collapses the thumb→finger gap and false-fires
// a pinch even when nothing touches. In true 3D that gap stays real, so rotation no longer reads as a
// pinch. Distance is thumb tip (4) to the index (8) or middle (12) tip — the natural pinch fingers,
// fewer false positives than all four — normalized by 3D hand scale (wrist→middle-MCP) for size
// invariance. Open hand keeps the ratio ≳ 0.7, a real pinch ≲ 0.3.
const PINCH_TIPS = [8, 12];
const dist3 = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function isPinch(world: Landmark[]): boolean {
  const thumb = world[4];
  const scale = dist3(world[9], world[0]) || 1e-3;
  for (const t of PINCH_TIPS) if (dist3(world[t], thumb) / scale < 0.45) return true;
  return false;
}
