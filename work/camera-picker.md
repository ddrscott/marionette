# Camera source + quality pickers (persisted sidebar dropdowns)

## Problem
The camera is currently hardcoded: `hands.ts` calls `getUserMedia({ video: { width: 640, height: 480 } })`
with no device selection. Users with multiple cameras (built-in + external webcam, virtual cams,
capture cards) can't choose a source, and can't trade detection speed for image sharpness. Add a
camera **source** picker and a **quality** picker so other sources and resolutions can be used.

## Decisions (from the user — do NOT relitigate)
- **Placement:** two `<select>` dropdowns in the controls **sidebar** (`<aside>`), alongside the
  existing sliders — one for camera device, one for quality.
- **Persistence:** remember both selections in **localStorage** and re-apply on reload.
- **Quality = fixed preset tiers** (NOT device-capability enumeration, NOT an FPS selector):
  - `480p` → 640×480 — **default** (fastest detection; matches today's behavior)
  - `720p` → 1280×720
  - `1080p` → 1920×1080
  Label them so it's clear higher = sharper but heavier detection.

## Acceptance Criteria
- [ ] Sidebar has a **Camera** `<select>` listing available video input devices (by `label`; fall
      back to "Camera N" when labels are empty pre-permission) and a **Quality** `<select>` with the
      three preset tiers above (480p default).
- [ ] Selecting a different camera or quality **re-acquires** the stream live (stop old tracks,
      `getUserMedia` with the new `deviceId` + resolution, swap `video.srcObject`) without a page
      reload and without breaking the detection worker (the worker reads frames off the same
      `<video>`; just keep feeding it — no worker restart needed).
- [ ] Device labels populate after permission is granted (labels are empty/anonymous until the first
      successful `getUserMedia`). Enumerate via `navigator.mediaDevices.enumerateDevices()`, filter
      `kind === "videoinput"`, and **refresh the list after** the initial permission grant.
- [ ] Both selections persist in `localStorage` and are re-applied on next load. If the saved
      `deviceId` is no longer present, fall back to the default device gracefully (no crash).
- [ ] Resolution is requested as a **preference**, not a hard constraint (use `width`/`height` ideals
      or catch OverconstrainedError and retry) so a camera that can't do the chosen tier still works.
- [ ] Handle hot-plug reasonably: listen for `navigator.mediaDevices.ondevicechange` to refresh the
      device dropdown (re-acquire only if the active device vanished — optional but preferred).
- [ ] README updated (camera/quality pickers; localStorage keys; default 480p rationale = detection speed).

## Relevant Files
- `src/hands.ts` — owns the camera (`Hands.create` does `getUserMedia` + `video.play()`). Refactor so
  the stream can be (re)acquired with a chosen `deviceId` + resolution, and old tracks stopped. The
  detection worker pumps frames from the same `<video>` element via `pump()` — keep that intact; only
  the underlying `srcObject` changes. Expose methods like `listCameras()`, `setCamera(deviceId)`,
  `setQuality(tier)` (or a combined `useSource({deviceId, tier})`).
- `src/main.ts` — wire the two `<select>` elements (read saved values from localStorage on boot,
  apply, persist on change). Mirror the existing slider-wiring pattern (`$("id").oninput = …`).
- `index.html` — add the two `<select>` rows in `<aside>` (match the existing `.row`/`<label>` markup).
- `README.md` — document the feature.

## Constraints
- 2D canvas; **no emojis** in the UI (use text labels / Lucide icons if any icon is needed).
- Don't break the off-thread detection worker, two-player handedness, floor clamp, finger bindings,
  string friction, or the new control **smoothing** (smoothdamp). The `<video>` element id stays `cam`.
- Re-acquiring a stream must **stop the previous tracks** (`stream.getTracks().forEach(t => t.stop())`)
  to avoid leaking the camera / "camera in use" errors.
- Keep `video` attributes (`autoplay playsinline muted`) and the `await video.play()` flow.
- Runtime/webcam behavior is **UNVERIFIABLE headlessly** — only build/types are provable here. State
  this in the report and tell the user to test device switching + quality in Chrome.
- Don't add a DOM `id` that shadows a library global (the `dbg` footgun from before).
