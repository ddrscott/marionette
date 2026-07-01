// Shared, dependency-FREE contract between the main thread (`hands.ts`) and the
// detection Web Worker (`handsWorker.ts`). Importing this from the main side pulls in
// ZERO @mediapipe code, so the inference library lives only in the worker bundle — the
// whole point of the offload (§5: detection off the render thread).

// One hand-landmark point. Structurally identical to MediaPipe's `NormalizedLandmark`
// (x,y are normalized [0,1]; z is relative depth; visibility is the model's confidence),
// which is exactly what the worker posts back via structured clone.
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number; // model confidence — present on image landmarks, absent on world landmarks
}

// One detected hand: its 21 IMAGE landmarks (x,y normalized, for on-screen position) PLUS its 21
// WORLD landmarks (metric, in meters, origin at the hand centre — a true 3D skeleton that's invariant
// to camera projection/rotation, used for the finger-to-thumb pinch), the handedness `categoryName`
// ("Left"/"Right"), and `score` (how confident MediaPipe is in this hand — used to reject shaky frames).
// NOTE: the handedness label is read from the UNMIRRORED camera image — main.ts still applies
// HANDEDNESS_LABEL_IS_MIRRORED before picking the no-crossing binding (unchanged).
export interface WorkerHand {
  landmarks: Landmark[];
  world: Landmark[];
  handedness: string;
  score: number;
}

// main -> worker. The ImageBitmap is TRANSFERRED (zero-copy); `t` is the (monotonically
// increasing) timestamp MediaPipe's VIDEO mode needs.
export type WorkerInbound =
  | { type: "frame"; bmp: ImageBitmap; t: number };

// worker -> main. `ready` fires once the HandLandmarker is built; `result` carries one
// detection (0/1/2 hands) tagged with the frame's `t`; `error` reports an init/detect failure.
export type WorkerOutbound =
  | { type: "ready" }
  | { type: "result"; hands: WorkerHand[]; t: number }
  | { type: "error"; message: string };

// The MediaPipe hand skeleton (21 landmarks). Mirrors `HandLandmarker.HAND_CONNECTIONS`,
// hardcoded here so the camera overlay (draw.ts) can draw connections WITHOUT the main
// bundle importing @mediapipe/tasks-vision. The hand topology is fixed by the model, so
// this constant is stable.
export const HAND_CONNECTIONS: ReadonlyArray<{ start: number; end: number }> = [
  // thumb
  { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 4 },
  // index
  { start: 0, end: 5 }, { start: 5, end: 6 }, { start: 6, end: 7 }, { start: 7, end: 8 },
  // middle
  { start: 5, end: 9 }, { start: 9, end: 10 }, { start: 10, end: 11 }, { start: 11, end: 12 },
  // ring
  { start: 9, end: 13 }, { start: 13, end: 14 }, { start: 14, end: 15 }, { start: 15, end: 16 },
  // pinky
  { start: 13, end: 17 }, { start: 0, end: 17 }, { start: 17, end: 18 }, { start: 18, end: 19 }, { start: 19, end: 20 },
];
