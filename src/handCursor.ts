// The shared camera-input primitive for every UI scene: an OPEN hand points, a CLOSED fist clicks.
// The pointer is the PALM CENTROID (wrist + the four MCP knuckles) — those landmarks barely move as
// the fingers curl, so the cursor stays put at the exact moment you close to click (unlike a
// fingertip, which swings inward). Positions are normalized [0,1], selfie-mirrored, and margin-mapped
// so the hand's central range reaches the FULL visible area (same idea as the game's play-area margin
// — you don't have to jam your hand into the corner of the camera to hit an edge control).
import type { Landmark } from "./hands.ts";
import { isFist } from "./gesture.ts";

export const DEFAULT_CURSOR_MARGIN = 0.12; // fraction inset per side; the inner (1-2m) maps to [0,1]

const PALM = [0, 5, 9, 13, 17]; // wrist + index/middle/ring/pinky MCPs — a stable palm centre under a fist
const remap = (v: number, m: number): number => Math.min(1, Math.max(0, (v - m) / Math.max(1e-3, 1 - 2 * m)));

export interface CursorState {
  present: boolean;
  x: number; y: number; // normalized [0,1], selfie-mirrored (+x = screen-right, +y = down), margin-applied
  closed: boolean;      // fist held THIS frame
  clicked: boolean;     // open->closed rising edge this frame (debounced by cooldown) — the "click"
  heldMs: number;       // how long the fist has been continuously closed (for hold-to-confirm UIs)
}

export class HandCursor {
  margin: number;
  private cooldownMs: number;
  private prevClosed = false;
  private closeT0 = 0;
  private lastClickT = -1e9;

  constructor(opts: { margin?: number; cooldownMs?: number } = {}) {
    this.margin = opts.margin ?? DEFAULT_CURSOR_MARGIN;
    this.cooldownMs = opts.cooldownMs ?? 350; // min gap between clicks (prevents a double on one close)
  }

  // Read one hand's landmarks for this frame (null = no hand detected).
  read(lm: Landmark[] | null, now: number): CursorState {
    if (!lm) { this.prevClosed = false; return { present: false, x: 0.5, y: 0.5, closed: false, clicked: false, heldMs: 0 }; }
    let sx = 0, sy = 0;
    for (const i of PALM) { sx += lm[i].x; sy += lm[i].y; }
    sx /= PALM.length; sy /= PALM.length;
    const x = remap(1 - sx, this.margin); // mirror x to match the selfie preview
    const y = remap(sy, this.margin);
    const closed = isFist(lm);
    let clicked = false;
    if (closed && !this.prevClosed) {
      this.closeT0 = now;
      if (now - this.lastClickT > this.cooldownMs) { clicked = true; this.lastClickT = now; }
    }
    this.prevClosed = closed;
    return { present: true, x, y, closed, clicked, heldMs: closed ? now - this.closeT0 : 0 };
  }
}
