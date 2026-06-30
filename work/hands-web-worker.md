# Move MediaPipe hand detection into a Web Worker (unblock the render thread)

## Problem
`detectForVideo` runs **synchronously on the main thread** every camera frame. With `numHands: 2`
it's roughly double the per-hand cost and blocks rendering, pinning fps to ~30 (physics is only
~1.5 ms/step, so it's NOT the sim — profiled). PRD §5 flagged this exact move: "Detection blocks the
main thread — fine for spike-1; move to a Web Worker if frame rate suffers." Offload detection so the
physics/render loop never waits on inference.

## Prerequisite
Only worth doing if detection is confirmed the bottleneck: with the debug overlay OFF (now default),
two-hand fps should be ~30 if it's detection (physics is cheap, debug draw is now batched). If fps is
already fine with debug off, note that and keep the change minimal/optional.

## Architecture (suggested)
- **New worker module** `src/handsWorker.ts` (Vite bundles workers via
  `new Worker(new URL("./handsWorker.ts", import.meta.url), { type: "module" })`). It imports
  `@mediapipe/tasks-vision`, creates the `HandLandmarker` (VIDEO mode, `numHands: 2`, GPU delegate,
  same CDN WASM + model paths as `hands.ts` today), and on each posted frame runs `detectForVideo`
  and posts back `{ hands: [{ landmarks, handedness }], t }`.
- **Frame transfer (main → worker):** each new camera frame, main does
  `const bmp = await createImageBitmap(video)` and `worker.postMessage({ bmp, t }, [bmp])` (transfer,
  zero-copy). Worker runs `detectForVideo(bmp, t)` then `bmp.close()`. (createImageBitmap + transfer
  is simple and Chrome-supported; `MediaStreamTrackProcessor`/VideoFrame is a fancier Chrome-only
  alternative — not needed.)
- **Backpressure:** keep at most ONE frame in flight — don't send a new frame until the previous
  result returns (a simple `inFlight` boolean). This keeps latency low and avoids a frame backlog
  building lag. The physics loop keeps using the **latest received** result every frame (the existing
  decoupled §5 design already feeds "last known landmarks" — async fits naturally).
- **`hands.ts` becomes the main-thread interface:** spawn the worker, own the camera/getUserMedia,
  pump frames, receive results, and expose the latest `{ hands }` (landmarks + handedness per hand)
  to `main.ts`. Keep `HAND_CONNECTIONS` exported for the overlay.
- **`main.ts`:** replace the inline `hands.landmarker.detectForVideo(...)` in `readHands` with reading
  the worker's latest result. Everything downstream (per-hand assignment by wrist-x, handedness
  binding via `bindingForHandedness`, the two-player drive) stays the same — it already consumes
  landmarks + a handedness category string.

## Acceptance Criteria
- [ ] Hand detection runs in a Web Worker; the main loop no longer calls `detectForVideo` (no
      synchronous inference on the render thread). With debug off + two hands, fps recovers toward 60
      (USER must confirm on a real webcam — see "unverifiable" below).
- [ ] Still `numHands: 2`; per-hand **landmarks AND handedness** come back from the worker, so the
      two-player binding + `HANDEDNESS_LABEL_IS_MIRRORED` logic still work unchanged.
- [ ] Graceful: worker init/await before the loop starts; 0/1/2 hands handled; one frame in flight
      (no backlog); hand-LOST indicator still works.
- [ ] `npm run build` passes (Vite bundles the worker). No regressions to physics, two-player,
      floor-clamp, or the finger bindings.
- [ ] README updated (detection now off-thread; §5 note resolved).

## Relevant Files
- `src/hands.ts` — split into the worker (`src/handsWorker.ts`) + the main-thread interface.
- `src/main.ts` — consume worker results instead of inline detection.
- `src/draw.ts` — overlay unchanged (still draws the latest landmarks).
- `README.md` — architecture + the §5 worker note.

## Unverifiable headlessly (be honest in the report)
- The actual fps win and worker round-trip latency need a **real browser + webcam** — the worker
  CANNOT verify them; it can only confirm the build/bundle and the message-protocol types. State this
  clearly and tell the user to confirm fps with two hands.
- MediaPipe-in-worker init quirks (CDN WASM in a module worker) may surface only at runtime.

## Constraints
- Keep the GPU delegate + the same CDN WASM/model paths; keep `numHands: 2`.
- Preserve the decoupled loop (physics/render every rAF; detection async at camera rate).
- Don't break two-player, handedness, floor-clamp, or the heavier-string/floor-collision physics.
- Stay on 2D canvas; no emojis. Rapier `@dimforge/rapier3d-compat@0.19.3`; tasks-vision `0.10.x`.
- Avoid the `id="dbg"` class of footgun — no new DOM ids that shadow library globals.
