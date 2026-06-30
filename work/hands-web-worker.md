# Off-thread hand detection — CLASSIC Web Worker, async/best-effort (no jank)

## Problem (confirmed by profiling)
`detectForVideo` runs SYNCHRONOUSLY on the main thread. A Chrome profile shows `vision_wasm_internal`
inference taking **~24.6 ms** per call (and it's WASM/CPU time — the GPU delegate may be falling back
to CPU). With `numHands:2` at camera rate that blocks the render thread and caps fps well below 60.
Move detection off-thread so the render/physics loop NEVER waits on inference.

## A prior attempt failed — THIS is the fix
The first offload used a `type:"module"` worker and died at init with **"ModuleFactory not set"**:
MediaPipe's wasm loader calls `importScripts()`, which **does not exist in module workers**, so the
Emscripten module factory is never set. (That version was reverted — commit `be33381`.)
**The fix is a CLASSIC (non-module) worker**, where `importScripts` works and MediaPipe's loader runs.

## Async / best-effort design (this is what kills the jank — user asked for exactly this)
- The render+physics loop runs every rAF and **never awaits** detection.
- **One frame in flight**: only post a new frame to the worker when the previous result has returned
  (an `inFlight` guard). If inference is slow, newer frames are simply **dropped, not queued** — so
  detection runs at its own best-effort rate and can never build a backlog or hitch the render.
- The loop always consumes the **latest** result (a frame or two stale is fine); the per-finger One
  Euro smoothing + the puppet's physics inertia absorb the staleness. (This is the §5 decoupled
  design — already in place; the worker just moves the heavy part off-thread.)

## Classic-worker mechanics (the part to get right)
- Make Vite emit the worker as a **classic** script, not an ES module. Two viable routes — use
  whichever builds AND serves cleanly in dev:
  - `new Worker(new URL("./handsWorker.ts", import.meta.url), { type: "classic" })`, and/or
  - set `worker: { format: "iife" }` in a `vite.config.ts`.
  Confirm the emitted worker chunk is an IIFE/classic script (not `export`-ing ESM) and that
  `npm run dev` serves it without a "module worker"/resolve error.
- The worker can still `import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision"` in
  source — Vite inlines it into the classic IIFE bundle, so at runtime the worker is classic and
  MediaPipe's internal `importScripts(wasmLoader)` works. (If a classic Vite worker can't bundle the
  ESM dep, fall back to `importScripts("<CDN vision_bundle that exposes globals>")` — but try the
  bundled-import route first; note in the report which worked.)
- Keep the SAME options: VIDEO mode, `numHands:2`, `delegate:"GPU"` (auto-falls back to CPU; that's
  fine — even CPU inference in the worker no longer janks the render), same CDN WASM + model paths.

## Architecture (unchanged from the reverted attempt except classic-worker + emphasis)
- `src/handsWorker.ts` — builds HandLandmarker once, posts `{type:"ready"}`; on each `{type:"frame", bmp, t}`
  runs detect, posts `{type:"result", hands:[{landmarks, handedness(categoryName)}], t}`, and `bmp.close()`s.
- `src/handsProtocol.ts` — fully-typed inbound/outbound messages (no `any` in payloads) + a hardcoded
  `HAND_CONNECTIONS` so the MAIN bundle never imports `@mediapipe`.
- `src/hands.ts` — main-thread interface: owns camera/getUserMedia, spawns + `await`s the worker
  `ready`, `pump(t)` ships `createImageBitmap(video)` frames (transfer) with the `inFlight` guard +
  currentTime gate, exposes `latest` + `seq`. Keep `HAND_CONNECTIONS`/`Landmark` exports.
- `src/main.ts` — `readHands` calls `hands.pump(now)`, re-assigns only when `hands.seq` changed (else
  holds last hands). Wrist-x assignment, `bindingForHandedness`, `drivePuppet`, overlay, 0/1/2-hand
  handling, hand-LOST — all UNCHANGED. Keep the new string-friction / drag / weight sliders working.

## Acceptance Criteria
- [ ] Detection runs in a **classic** worker; main loop never calls `detectForVideo`. The emitted
      worker is a classic/IIFE script (verify it's not a module worker — that's what broke before).
- [ ] `numHands:2` + per-hand **landmarks AND handedness** survive the round-trip (two-player binding +
      `HANDEDNESS_LABEL_IS_MIRRORED` still work).
- [ ] Async best-effort: one frame in flight, stale frames dropped, render never blocks; 0/1/2 hands ok.
- [ ] `npm run build` clean (Vite bundles the classic worker); `npm run dev` serves the worker chunk
      (HTTP 200, no resolve/module-worker error). Main bundle has ZERO `@mediapipe` refs.
- [ ] README updated (off-thread detection; classic-worker note; the §5 decoupling).

## Runtime-UNVERIFIABLE (be explicit; the prior attempt's bug only showed at runtime)
- The actual fps win, the worker round-trip, MediaPipe-in-worker init, the GPU/CPU delegate, and
  `createImageBitmap`/`getUserMedia` ALL need a real Chrome + webcam. The worker can ONLY prove the
  build/bundle/protocol-types + that the chunk is classic. STATE this; tell the user to test two-hand
  fps in Chrome and watch the console for `[handsWorker]` init errors (esp. another "ModuleFactory not
  set" — which would mean the worker is still emitting as a module).

## Constraints
- CLASSIC worker (the whole point); keep GPU delegate attempt + same CDN paths + `numHands:2`;
  preserve handedness; don't break two-player / floor-clamp / finger bindings / string-friction /
  the heavier-string + floor-collision physics; keep debug overlay default OFF; 2D canvas; no emojis;
  no DOM id shadowing a library global (the `dbg` footgun). Rapier 0.19.3, tasks-vision 0.10.x.
