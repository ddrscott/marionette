# Make the camera preview draggable (free placement, persisted)

## Problem
The camera preview (`#camBox`) is pinned by CSS and can cover HUD/controls or sit where the user
doesn't want it. Let the user **drag it anywhere** on screen (mouse + touch), keep it on-screen, and
**remember** where they put it across reloads. (The request came in as "draggable to any of the 4
corners"; the user then chose **free placement** — drop it anywhere, not just corner-snap. The
corners are naturally reachable; no snapping required.)

## Current layout (read before coding)
`#camBox` wraps `#cam` (mirrored video) + `#camOverlay` (landmark canvas, `pointer-events: none`).
It's `position: absolute` and positioned by CSS:
- Default (`src/style.css:33`): `right: 12px; bottom: 12px;` 220×165.
- `/game` (`style.css:160`) and `/characters` (`style.css:242`): `right:auto; left:50%; bottom:10px;
  transform: translateX(-50%);` 150×112, opacity .5.
The markup appears in `game/index.html`, `characters/index.html`, `keyboard/index.html` (and
`harness/index.html`). Camera device/quality prefs already persist under the `handbattle.cam.*`
localStorage namespace (e.g. `game.ts:18-19`).

## Decisions (from the user — do NOT relitigate)
- **Scope = all camera scenes:** `/game`, `/characters`, `/keyboard`. (`harness` is a dev tool —
  optional; wire it too only if it's free via the shared helper.)
- **Free placement, persisted:** drag to any position; save it and restore on reload.

## Implementation notes
- **Shared helper (DRY), not per-scene copies.** Add e.g. `src/dragCam.ts` exporting
  `makeCamDraggable(box: HTMLElement, key = "handbattle.cam.pos")` and call it from `game.ts`,
  `characters.ts`, `keyboard.ts` (and optionally `harness.ts`) after the DOM exists.
- **Pointer Events for mouse + touch.** Use `pointerdown`/`pointermove`/`pointerup` on `#camBox`
  with `setPointerCapture`; set CSS `touch-action: none` on `#camBox` so a drag doesn't scroll/
  pan the page on mobile. Add `cursor: grab` / `grabbing` affordance.
- **Switch to top/left px on drag.** When a saved/dragged position is applied, set inline
  `left`/`top` in px and CLEAR the scene defaults that fight it: `right='auto'; bottom='auto';
  transform='none'`. Otherwise the `/game` `translateX(-50%)` center rule will offset it.
- **Clamp fully on-screen, always.** Clamp the box's top-left so the whole box (use its measured
  `getBoundingClientRect()` size — sizes differ per scene) stays inside the viewport, honoring the
  mobile safe-area (the fullscreen bottom bar) via `env(safe-area-inset-*)` or an equivalent margin.
  Re-clamp on `resize`/orientation change so it can never end up off-screen or under a notch.
- **Persist as a normalized anchor**, not raw px: store the top-left as a fraction of viewport
  (`fx = left/vw`, `fy = top/vh`) under `handbattle.cam.pos`. That survives window resizes and the
  different box sizes across scenes; clamp after restoring. One shared key = one "camera position"
  preference across scenes (acceptable; clamp handles size differences).
- **Don't break gameplay/overlay.** The drag is a pointer interaction separate from hand tracking
  (which reads the webcam, not pointer events), so it won't trigger game clicks — but verify a drag
  that starts on `#camBox` doesn't also fire a stage click. Keep `#camOverlay` at `inset:0` inside
  `#camBox` so landmarks stay aligned after the move. Preserve the mirrored video + opacity.

## Acceptance Criteria
- [ ] On `/game`, `/characters`, and `/keyboard`, the camera preview can be dragged to any position
      with BOTH mouse and touch; a grab cursor signals it's draggable.
- [ ] The box always stays fully on-screen (clamped), including under the mobile safe-area/bottom
      bar; resizing or rotating the window keeps it on-screen.
- [ ] The chosen position **persists across reloads** (localStorage `handbattle.cam.pos`) and is
      restored on load; it works despite the different default box sizes/positions per scene.
- [ ] Dragging the preview does not scroll the page (touch) or trigger gameplay input; the landmark
      overlay stays aligned to the video after moving; mirror + opacity preserved.
- [ ] One shared drag helper used by all scenes (no per-scene duplication).
- [ ] `npx tsc --noEmit` + `npm run build` clean; no emojis.

## Relevant Files
- `src/dragCam.ts` — NEW shared helper (`makeCamDraggable`).
- `src/game.ts`, `src/characters.ts`, `src/keyboard.ts` — mount the helper on `#camBox` (optionally
  `src/harness.ts`).
- `src/style.css` — `#camBox` (33), `body.game #camBox` (160), `body.chars #camBox` (242): add
  `touch-action: none` + `cursor: grab`; ensure inline top/left can override the defaults.
- `game/index.html`, `characters/index.html`, `keyboard/index.html` — `#camBox` markup (no change
  expected; verify ids).

## Constraints
- Free placement (no forced corner snap), but ALWAYS clamp on-screen — never let it be dragged off
  or under the notch/safe-area.
- Reuse the `handbattle.cam.*` localStorage namespace; store a normalized anchor, not raw px.
- Don't regress hand-input, the mirrored preview, overlay alignment, or the `/game` fullscreen +
  safe-area layout.
- Shared helper (DRY); Vite + TS; no new deps; no emojis.
