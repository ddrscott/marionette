// ---- direct hand -> cross drive (pure geometry, NO MediaPipe import) ----
// This module is deliberately dependency-free so it can be imported and exercised headlessly in
// Node (the cross's position + roll are now MEASURED from real landmarks, so they get a real test).
// The cross is a rigid "+": two hand landmarks define its horizontal bar; the bar's CENTER is the
// midpoint of the two points and its ROLL is the angle of the line between them. Both replace the
// old synthesized (hand-shape proxy) roll entirely.

export interface Pt { x: number; y: number; }
// Minimal landmark shape — just what the drive needs. MediaPipe's NormalizedLandmark is assignable.
export interface DriveLandmark { x: number; y: number; z?: number; }

export type DriveMode = "extremes" | "fixed";
export interface DriveConfig {
  mode: DriveMode;
  left: number;  // fixed-mode: index of the left bar end. (also the extremes fallback)
  right: number; // fixed-mode: index of the right bar end.
}

// Data-driven binding config — the customization seam for a future in-app point-picker.
//   "extremes" (default): each frame, pick the landmarks with min / max stage-x. Auto-adapts to
//     hand orientation and maximizes the bar spread. Geometry stays continuous across an
//     extreme-point identity switch because min/max *position* is continuous (smooth the derived
//     center/angle, not the landmark identity).
//   "fixed": use the `left`/`right` indices below. Default fixed pair = index-MCP(5) / pinky-MCP(17)
//     — the knuckle row: a stable, curl-proof span.
export const DRIVE: DriveConfig = { mode: "extremes", left: 5, right: 17 };

// Stage space matches main.ts's translation mapping: x is MIRRORED (selfie; +x = screen-right) and
// y points UP. Only the two driving points are converted; the caller scales/offsets into world.
export const stageX = (lm: DriveLandmark): number => 0.5 - lm.x;
export const stageY = (lm: DriveLandmark): number => 0.5 - lm.y;

// Return the two stage-space bar ends. `left` is the screen-left end (min stage-x), `right` the
// screen-right end (max stage-x) — guaranteeing right.x >= left.x, so the roll denominator below
// never flips sign (no atan2 wrap from the x term).
export function controlDrive(lm: DriveLandmark[], config: DriveConfig = DRIVE): { left: Pt; right: Pt } {
  let li = config.left;
  let ri = config.right;
  if (config.mode === "extremes") {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < lm.length; i++) {
      const sx = stageX(lm[i]);
      if (sx < minX) { minX = sx; li = i; }
      if (sx > maxX) { maxX = sx; ri = i; }
    }
  } else if (stageX(lm[ri]) < stageX(lm[li])) {
    // fixed mode: keep left = screen-left regardless of which configured index is currently lower.
    [li, ri] = [ri, li];
  }
  return {
    left:  { x: stageX(lm[li]), y: stageY(lm[li]) },
    right: { x: stageX(lm[ri]), y: stageY(lm[ri]) },
  };
}

// Stage-space midpoint of the two bar ends -> the cross center (before world scaling).
export function controlCenter(left: Pt, right: Pt): Pt {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

// Bar roll: 0 when the bar is level. Positive when the LEFT end is higher than the right (hand
// rotated counter-clockwise in screen space). Callers negate to drive the in-plane Z body rotation
// (see main.ts) so the rendered "+" leans the same way the hand does.
export function rollAngleOf(left: Pt, right: Pt): number {
  return Math.atan2(left.y - right.y, right.x - left.x);
}
