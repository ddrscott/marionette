# Pose scene: support portrait orientation (reflow to fit)

## Problem
The `/pose` scene forces landscape. `pose/index.html` shows a "Rotate to landscape"
portrait-lock overlay on touch devices held in portrait (`.rg-*` markup around line 23–26),
and the scene is built around the fixed 16:10 landscape play area (ref 1280×800) that the
rest of the app letterboxes to. On a phone held upright the user is blocked and told to
rotate. Phone orientation should not matter for `/pose` — it must be playable in portrait.

## Expected outcome
- The "Rotate to landscape" portrait-lock overlay no longer appears on `/pose` (remove it,
  or scope it so it never blocks the pose scene). Verify in portrait on a touch device /
  narrow viewport that the scene is interactive, not covered by the rotate prompt.
- **Reflow to fit** (chosen behavior): the play area adapts to the screen's actual aspect
  ratio rather than staying a fixed 16:10 box. In portrait the world is taller/narrower and
  fills the phone; the puppet + chalk-outline silhouette scale so the full pose is visible
  and reachable. The existing fit-on-mount / ResizeObserver path that re-derives world units
  from canvas size should drive this — extend it so portrait aspects are first-class, not
  letterboxed into a landscape box.
- Camera preview and any HUD/timer stay on-screen and usable in portrait (the camera preview
  is draggable + clamped/safe-area aware via the shared `dragCam` helper — make sure its
  clamp still keeps it visible when the viewport is portrait).

## Relevant files
- `pose/index.html` — the portrait-lock overlay (`.rg-title` "Rotate to landscape", ~line 23–26)
  and page layout/CSS.
- `src/pose.ts` — scene setup, canvas (`scene`), fit/resize handling, `PLACE`/world framing,
  camera overlay, dragCam integration.
- `src/draw.ts` — `Renderer` (world→canvas mapping / letterbox); check how the 16:10 play area
  and world scale are derived so reflow can key off the real canvas aspect.
- `src/dragCam.ts` — camera-preview clamp (must stay valid in portrait).
- Compare with how `/game` letterboxes to 16:10 (readability-16x10 work) — this task
  intentionally diverges for `/pose` only. Do NOT change `/game` framing.

## Constraints
- Scope to `/pose` only. Leave `/game`, `/characters`, `/keyboard` orientation behavior
  unchanged.
- Preserve pose-scene mechanics: raise-to-come-alive Pilot ritual, silhouette nestle +
  hold-to-lock, timer, and the N / C / [ / ] / A / R hotkeys.
- Keep world coordinates consistent enough that the built-in poses (STAR/CHEER/KICK) and
  captured poses remain reachable after reflow — if PLACE / scale changes with aspect, the
  puppet and silhouette must scale together so a pose that fit in landscape still fits in
  portrait.
- Keep the soft goal-drive string physics and anti-seizure invariants intact (no physics
  changes needed for this task).
- Verify in a narrow (portrait) viewport as well as landscape.
