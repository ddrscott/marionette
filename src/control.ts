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
