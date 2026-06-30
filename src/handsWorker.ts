// Detection Web Worker: runs MediaPipe HandLandmarker OFF the render thread (§5). It
// owns the (heavy) @mediapipe/tasks-vision import + the GPU inference; the main thread
// (hands.ts) only ships it camera frames and reads back landmarks.
//
// CRITICAL: this MUST be emitted as a CLASSIC (non-module) worker. MediaPipe's wasm
// loader calls `importScripts()` internally, which DOES NOT EXIST in module workers —
// a module worker dies at init with "ModuleFactory not set". The prior offload attempt
// used `{ type: "module" }` and hit exactly that (reverted, commit be33381). Two things
// keep this classic: hands.ts spawns it with `{ type: "classic" }`, AND vite.config.ts
// sets `worker.format = "iife"` so the BUILT worker chunk is an IIFE, not ESM. Vite
// inlines the `@mediapipe/tasks-vision` import below into that single classic bundle, so
// at runtime the worker is classic and MediaPipe's internal importScripts works.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { WorkerInbound, WorkerOutbound, WorkerHand } from "./handsProtocol.ts";

// SAME CDN WASM + model paths as the original main-thread init — keeps Vite config zero
// (no asset-copy plugin) and the GPU delegate + numHands:2 identical.
const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// The project tsconfig uses the DOM lib (for the main thread), so the worker globals are
// typed for Window here. We post through the typed protocol via one narrow cast, so every
// outbound payload is fully typed (no `any` holes).
const post = (msg: WorkerOutbound): void => (postMessage as (m: WorkerOutbound) => void)(msg);

let landmarker: HandLandmarker | null = null;

// Build the landmarker once, up front; signal the main thread when it's ready (or failed).
(async (): Promise<void> => {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2, // two players, one camera — each detected hand drives its own puppet
    });
    post({ type: "ready" });
  } catch (e) {
    post({ type: "error", message: String(e) });
  }
})();

addEventListener("message", (ev: MessageEvent): void => {
  const msg = ev.data as WorkerInbound;
  if (msg.type !== "frame") return;
  const { bmp, t } = msg;
  if (!landmarker) { bmp.close(); return; } // not ready yet — drop the frame, free the bitmap
  try {
    const res = landmarker.detectForVideo(bmp, t);
    const handed = res.handedness ?? res.handednesses ?? [];
    const hands: WorkerHand[] = res.landmarks.map((landmarks, i) => ({
      landmarks,
      handedness: handed[i]?.[0]?.categoryName ?? "Right",
    }));
    post({ type: "result", hands, t });
  } catch (e) {
    post({ type: "error", message: String(e) });
  } finally {
    bmp.close(); // release the transferred frame every time (no leak)
  }
});
