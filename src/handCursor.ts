// The shared camera-input primitive for every UI scene: an OPEN hand points, a CLOSED fist clicks.
// The pointer is the PALM CENTROID (wrist + the four MCP knuckles) — those landmarks barely move as
// the fingers curl, so the cursor stays put at the exact moment you close to click (unlike a
// fingertip, which swings inward). Positions are normalized [0,1], selfie-mirrored, and margin-mapped
// so the hand's central range reaches the FULL visible area (same idea as the game's play-area margin
// — you don't have to jam your hand into the corner of the camera to hit an edge control).
import type { Landmark } from "./hands.ts";
import { isFist, isPinch } from "./gesture.ts";
import { OneEuro } from "./oneEuro.ts";

// Which gesture counts as the "click": a closed fist, or a finger-to-thumb pinch. Both keep the palm
// centroid (the pointer) stable while triggering, so the cursor doesn't jump at the moment of click.
export type ClickGesture = "fist" | "pinch";

// One frame of hand input: IMAGE landmarks drive the on-screen position (2D is what we want for
// pointing); WORLD landmarks (metric 3D) drive the pinch (rotation-invariant); `score` is the
// per-hand detection confidence used to reject shaky frames. world/score are optional so a fist-only
// caller can pass just `{ landmarks }`.
export interface HandInput { landmarks: Landmark[]; world?: Landmark[]; score?: number; }

// Fraction inset per side: the inner (1-2m) of the frame maps LINEARLY onto the full [0,1] screen, so
// a bigger margin = more gain (less hand travel to reach an edge). Consumers map this straight onto
// the whole screen — the on-screen keyboard/cards are a sub-region of it, so they already need less
// than full reach. The central 50% of the camera frame spans the full browser width (m = 0.25): a
// webcam's FOV is wide, so mapping most of it (the old 70–80%) forced an arm-sweep to reach edge keys
// (see the mobile "reach for A" complaint). At 50% a comfortable wrist-scale motion covers the whole
// keyboard; the applied filter keeps the extra gain from reading as jitter. Tune HERE, both axes.
export const DEFAULT_CURSOR_MARGIN = 0.25;

// Reject a click when MediaPipe's per-hand confidence is below this — shaky/ambiguous frames are where
// false pinches come from. Shared so every click gesture (cursor click + the keyboard's pinky-delete)
// uses one bar.
export const CLICK_MIN_CONFIDENCE = 0.8;

const PALM = [0, 5, 9, 13, 17]; // wrist + index/middle/ring/pinky MCPs — a stable palm centre under a fist
const remap = (v: number, m: number): number => Math.min(1, Math.max(0, (v - m) / Math.max(1e-3, 1 - 2 * m)));

// The pointer's raw source: the palm centroid in normalized IMAGE coords [0,1] (un-mirrored, no margin).
// Exported so diagnostics can read the hand's true frame position — e.g. how close it is to an edge.
export function palmCentroid(lm: Landmark[]): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const i of PALM) { sx += lm[i].x; sy += lm[i].y; }
  return { x: sx / PALM.length, y: sy / PALM.length };
}

// The full cursor mapping (selfie-mirror x + margin remap), pre-smoothing. HandCursor.read consumes
// this and so can a diagnostic overlay, so both produce the SAME on-screen position — one code path.
export function mapCursor(lm: Landmark[], margin: number): { x: number; y: number } {
  const c = palmCentroid(lm);
  return { x: remap(1 - c.x, margin), y: remap(c.y, margin) };
}

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
  private click: ClickGesture;
  private minConfidence: number;
  private prevClosed = false;
  private closeT0 = 0;
  private lastClickT = -1e9;
  // One-Euro smoothing for the POSITION only (x and y independently). Smooths hard when the hand is
  // still, stays low-latency when it moves — the pointer-correct tradeoff. Applied to the final mapped
  // normalized coords, NOT to the click detection (which stays on this frame's raw landmarks so
  // pressing feels instant). Defaults are more smoothing than the game's snappy puppet path (5.0),
  // which is what a UI cursor wants; override per-instance if a scene needs different feel.
  private readonly fx: OneEuro;
  private readonly fy: OneEuro;

  constructor(opts: { margin?: number; cooldownMs?: number; click?: ClickGesture; minConfidence?: number; minCutoff?: number; beta?: number } = {}) {
    this.margin = opts.margin ?? DEFAULT_CURSOR_MARGIN;
    this.cooldownMs = opts.cooldownMs ?? 350; // min gap between clicks (prevents a double on one close)
    this.click = opts.click ?? "fist";
    // Gates only the click, never the cursor position (which stays visible).
    this.minConfidence = opts.minConfidence ?? CLICK_MIN_CONFIDENCE;
    // Reuse the validated One-Euro defaults (minCutoff 1.5, beta 0.01) as the pointer starting point.
    this.fx = new OneEuro(opts.minCutoff ?? 1.5, opts.beta ?? 0.01);
    this.fy = new OneEuro(opts.minCutoff ?? 1.5, opts.beta ?? 0.01);
  }

  // Read one hand's input for this frame (null = no hand detected).
  read(hand: HandInput | null, now: number): CursorState {
    // No hand: clear the smoothing state so a re-acquired hand snaps to its true spot instead of
    // gliding from the last seen position.
    if (!hand) { this.prevClosed = false; this.fx.reset(); this.fy.reset(); return { present: false, x: 0.5, y: 0.5, closed: false, clicked: false, heldMs: 0 }; }
    const lm = hand.landmarks;
    // Map first (shared mirror + margin remap), then One-Euro the two final scalars (never the landmarks).
    const m = mapCursor(lm, this.margin);
    const x = this.fx.filter(m.x, now);
    const y = this.fy.filter(m.y, now);
    // confidence gate + gesture: pinch uses the 3D world skeleton (rotation-invariant); fist the 2D image.
    const confident = hand.score === undefined || hand.score >= this.minConfidence;
    const closed = confident && (this.click === "pinch" ? isPinch(hand.world ?? lm) : isFist(lm));
    let clicked = false;
    if (closed && !this.prevClosed) {
      this.closeT0 = now;
      if (now - this.lastClickT > this.cooldownMs) { clicked = true; this.lastClickT = now; }
    }
    this.prevClosed = closed;
    return { present: true, x, y, closed, clicked, heldMs: closed ? now - this.closeT0 : 0 };
  }
}
