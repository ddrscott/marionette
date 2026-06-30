import { defineConfig } from "vite";

// CLASSIC worker, by design. MediaPipe's wasm loader calls `importScripts()`, which only
// exists in a classic (non-module) worker — a module worker dies at init with
// "ModuleFactory not set" (the bug that reverted the prior offload attempt, commit be33381).
//
// `worker.format = "iife"` makes Vite emit the BUILT worker chunk (`handsWorker`) as a
// self-executing IIFE — a classic script, NOT an ES module with top-level import/export.
// This pairs with the dev-mode spawn `new Worker(url, { type: "classic" })` in hands.ts so
// the worker is classic in BOTH dev and the production bundle. Vite inlines the
// `@mediapipe/tasks-vision` import into that single IIFE chunk (IIFE workers can't be
// code-split, which is fine here — the worker has no shared chunks).
export default defineConfig({
  worker: {
    format: "iife",
  },
});
