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

// PINCH detector — the finger-to-thumb "click": the thumb tip (4) touching ANY fingertip
// (index/middle/ring/pinky). Distance is normalized by hand scale (wrist→middle-MCP) so it's
// invariant to hand size/distance; the palm centroid barely moves during a pinch, so the cursor
// stays put at the moment of click. An open/relaxed hand keeps thumb↔fingertip ≳ 0.6, a pinch ≲ 0.3.
export function isPinch(lm: Landmark[]): boolean {
  const thumb = lm[4], wrist = lm[0], mcp9 = lm[9];
  const scale = Math.hypot(mcp9.x - wrist.x, mcp9.y - wrist.y) || 1e-3;
  for (const t of FIST_TIPS) if (Math.hypot(lm[t].x - thumb.x, lm[t].y - thumb.y) / scale < 0.45) return true;
  return false;
}
