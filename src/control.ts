// ---- landmark -> stage-space mapping (pure, no MediaPipe import) ----
// Stage space matches the renderer: x is MIRRORED (selfie; +x = screen-right) and y points UP.
// Each fingertip is mapped through these into a control-point world position (see main.ts).

export interface StageLandmark { x: number; y: number; z?: number; }

export const stageX = (lm: StageLandmark): number => 0.5 - lm.x;
export const stageY = (lm: StageLandmark): number => 0.5 - lm.y;
