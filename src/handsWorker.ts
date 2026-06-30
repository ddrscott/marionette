// Detection Web Worker: runs MediaPipe HandLandmarker OFF the render thread (§5). It owns
// the (heavy) GPU inference; the main thread (hands.ts) only ships it camera frames and
// reads back landmarks.
//
// THIS FILE HAS NO ESM `import` (only `import type`, which is erased). That is LOAD-BEARING:
//   - This worker is spawned `{ type: "classic" }` because MediaPipe's wasm loader calls
//     `importScripts()`, which DOES NOT EXIST in a module worker — a module worker dies at
//     init with "ModuleFactory not set" (the bug that reverted the first attempt, be33381).
//   - But a CLASSIC worker also cannot execute an ESM `import`. Vite bundles the import away
//     in the production BUILD, yet its DEV server serves the worker with the `import` still
//     in it — so a real `import` makes the worker silently never start in dev (boot hangs).
// So instead of importing @mediapipe, we pull its CommonJS bundle at RUNTIME via
// `importScripts` (the classic-worker primitive), shimming `exports`/`module` so the CJS
// bundle attaches its API to an object we can read.
//
// EVERYTHING BELOW LIVES IN AN IIFE. `importScripts` evaluates the vendored bundle in the
// worker's GLOBAL scope, and that minified bundle declares its own top-level identifiers
// (`g`, etc.). In the production build Vite already wraps this worker in an IIFE, but in dev
// it serves a FLAT classic script — so any top-level `const`/`let` here would be a global
// lexical binding that COLLIDES with the bundle's globals ("Identifier 'g' has already been
// declared"). The IIFE keeps our identifiers out of the global lexical scope entirely.
import type { Landmark, WorkerInbound, WorkerOutbound, WorkerHand } from "./handsProtocol.ts";

// Minimal structural types for the two MediaPipe classes we use (so we import NO @mediapipe types).
interface HandResult {
  landmarks: Landmark[][];
  handedness?: { categoryName: string }[][];
  handednesses?: { categoryName: string }[][];
}
interface HandLandmarkerLike { detectForVideo(image: ImageBitmap, ts: number): HandResult; }
interface VisionApi {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  HandLandmarker: { createFromOptions(fileset: unknown, opts: unknown): Promise<HandLandmarkerLike> };
}

(function (): void {
  // The MediaPipe CommonJS bundle is VENDORED locally (public/vendor/…) and loaded same-origin.
  // We can't importScripts it from jsdelivr: that CDN serves `.cjs` with MIME `application/node`,
  // which the browser refuses to execute under strict MIME checking. Served from our own origin
  // as a `.js`, it's `text/javascript` and importScripts runs it — in dev and the build alike.
  const VISION_CJS = "/vendor/mediapipe-tasks-vision-0.10.35.js";
  // The WASM fileset still streams from the CDN — those are `.js`/`.wasm` (correct MIME), and the
  // classic-worker glue loader importScripts them fine.
  const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
  const MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

  // The worker global, typed for the classic-script bits the DOM lib doesn't surface here.
  const g = self as unknown as {
    importScripts: (...urls: string[]) => void;
    module?: { exports: Record<string, unknown> };
    exports?: Record<string, unknown>;
  };

  const post = (msg: WorkerOutbound): void => (postMessage as (m: WorkerOutbound) => void)(msg);

  // CJS shim: the bundle does `exports.HandLandmarker = ...` and NEVER reassigns module.exports,
  // so one shared object behind both globals captures the whole API. `module`/`exports` MUST be
  // real globals on `self` (the bundle resolves them as free variables); only OUR own bindings
  // stay IIFE-scoped. importScripts runs the CJS synchronously.
  let vision: VisionApi;
  try {
    g.module = { exports: {} };
    g.exports = g.module.exports;
    g.importScripts(VISION_CJS);
    vision = g.module.exports as unknown as VisionApi;
    console.log("[handsWorker] vision bundle loaded; exports:", Object.keys(g.module.exports));
    if (!vision.FilesetResolver || !vision.HandLandmarker) {
      throw new Error("vision bundle loaded but FilesetResolver/HandLandmarker missing from exports");
    }
  } catch (e) {
    post({ type: "error", message: `vision load failed: ${String(e)}` });
    throw e;
  }

  let landmarker: HandLandmarkerLike | null = null;

  // Build the landmarker once, up front; signal the main thread when it's ready (or failed). The
  // GPU delegate works on the main thread but can fail inside a worker (no GL context), so we try
  // GPU and fall back to CPU — CPU inference in the worker still never janks the render loop.
  (async (): Promise<void> => {
    try {
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      // Fetch the model in-worker and pass it as a BUFFER (the official MediaPipe worker pattern)
      // rather than `modelAssetPath`. This surfaces a model-download failure explicitly here,
      // instead of it failing opaquely deep inside createFromOptions.
      const modelResp = await fetch(MODEL_PATH);
      if (!modelResp.ok) throw new Error(`model fetch failed: ${modelResp.status} ${modelResp.statusText}`);
      const modelArrayBuffer = await modelResp.arrayBuffer();
      console.log("[handsWorker] model fetched:", modelArrayBuffer.byteLength, "bytes");

      const build = (delegate: "GPU" | "CPU"): Promise<HandLandmarkerLike> =>
        vision.HandLandmarker.createFromOptions(fileset, {
          // fresh Uint8Array view per attempt so a first try can't leave the buffer detached
          baseOptions: { modelAssetBuffer: new Uint8Array(modelArrayBuffer), delegate },
          runningMode: "VIDEO",
          numHands: 2, // two players, one camera — each detected hand drives its own puppet
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        landmarker = await build("GPU");
        console.log("[handsWorker] landmarker ready (GPU)");
        post({ type: "ready" });
      } catch (gpuErr) {
        console.warn("[handsWorker] GPU delegate failed, retrying on CPU:", String(gpuErr));
        landmarker = await build("CPU");
        console.log("[handsWorker] landmarker ready (CPU)");
        post({ type: "ready" });
      }
    } catch (e) {
      post({ type: "error", message: `init failed: ${String(e)}` });
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
})();
