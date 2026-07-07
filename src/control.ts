// ---- landmark -> stage-space mapping (pure, no MediaPipe import) ----
// Stage space matches the renderer: x is MIRRORED (selfie; +x = screen-right) and y points UP.
// Each fingertip is mapped through these into a control-point world position (see main.ts).

export interface StageLandmark { x: number; y: number; z?: number; }

// Play-area margin `m` (fraction inset per side, default 0 = no inset): the central (1 - 2m) of the
// camera maps to the FULL canvas, so the play-area edge reaches the canvas edge and the outer margin
// band overshoots OFFSCREEN. Dividing the centered coord by (1 - 2m) is the rescale; m = 0 → divide by
// 1 → exactly the old behavior. Cheap (one divide per fingertip per axis). The slider clamps m to keep
// (1 - 2m) > 0; we Math.max-guard the divisor here too so a stray m can never blow up the mapping.
export const stageX = (lm: StageLandmark, m = 0): number => (0.5 - lm.x) / Math.max(0.02, 1 - 2 * m);
export const stageY = (lm: StageLandmark, m = 0): number => (0.5 - lm.y) / Math.max(0.02, 1 - 2 * m);

// ---- aspect-correct FIT scale — the ONE mapping shared by the puppet finger→world path in
// engine.ts (Stage) and pilot.ts (Pilot), so the two never diverge (DRY) ----
// The normalized landmark field is a CAMERA-shaped rectangle (e.g. 480p = 640×480 = 4:3), but the
// play area's aspect is the CANVAS aspect. Scaling X by the canvas-derived `worldWidth` while Y stays
// a fixed view height stretches the two axes by unrelated factors, so a diagonal hand move is not a
// proportional diagonal on screen — and in a tall/narrow (portrait) viewport parts of the target
// space become impossible to reach. This returns ONE uniform world-units-per-camera-unit scale for
// BOTH axes, derived from the camera's aspect ratio:
//   FIT (default) — the WHOLE camera field maps inside the play area (letterbox; nothing unreachable).
//   The uniform scale is the tighter of the two axes. In a LANDSCAPE play area (a 4:3 camera is less
//   wide than a 16:10 canvas) it's height-limited, so `scaleY === viewHeight` and a ~16:10 canvas maps
//   its Y exactly as before while X is corrected from the canvas-stretched value down to aspect-true.
// Pass `cameraAspect <= 0` (or omit) for the LEGACY anisotropic mapping (scaleX = worldWidth, scaleY =
// viewHeight) — used by the 16:10-locked /game so its tuned feel stays byte-identical.
export interface StageScale { scaleX: number; scaleY: number; }
export function stageScale(worldWidth: number, viewHeight: number, cameraAspect = 0): StageScale {
  if (cameraAspect > 0) {
    const scaleY = Math.min(viewHeight, worldWidth / cameraAspect);
    return { scaleX: scaleY * cameraAspect, scaleY };
  }
  return { scaleX: worldWidth, scaleY: viewHeight };
}
