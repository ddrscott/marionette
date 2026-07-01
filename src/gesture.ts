// Finger-gun cursor for the hands-only initials entry: the INDEX fingertip is the pointer, the THUMB
// is the trigger — thumb extended = aiming, thumb tucked in (like firing a gun) = "fire"/select. Lets
// a winner claim a record on a kiosk with no keyboard.
import type { Landmark } from "./hands.ts";

export interface HandPointer {
  x: number;         // index fingertip, mirrored-normalized [0,1] (matches the selfie preview): +x = screen-right
  y: number;         // [0,1], top = 0
  thumbOpen: number; // thumb openness: |thumbTip - indexMCP| / hand-scale. High = extended, low = tucked.
}

// Landmarks: 0 wrist, 4 thumb-tip, 5 index-MCP, 8 index-tip, 9 middle-MCP.
export function handPointer(lm: Landmark[]): HandPointer {
  const wrist = lm[0], mcp9 = lm[9], indexMcp = lm[5], thumbTip = lm[4], indexTip = lm[8];
  const scale = Math.hypot(mcp9.x - wrist.x, mcp9.y - wrist.y) || 1e-3; // hand size, for scale-invariance
  const thumbOpen = Math.hypot(thumbTip.x - indexMcp.x, thumbTip.y - indexMcp.y) / scale;
  return { x: 1 - indexTip.x, y: indexTip.y, thumbOpen };
}

// Closed FIST detector (for the /characters "hover + fist to pick" select gesture). A curled finger
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
