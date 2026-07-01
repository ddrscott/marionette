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
