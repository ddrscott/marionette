# Fit the canvas on mount (no manual resize needed)

## Problem
On first load you have to nudge the browser window before the contents fit the layout. The canvas is
sized once at construction, before the layout has fully settled, so it renders at the wrong size until
a `resize` event re-measures it.

## Root cause
`Renderer` (src/draw.ts) sets `canvas.width/height` from `clientWidth/clientHeight` **once in its
constructor**, which `Stage.create` calls before `$("boot").remove()` and before the layout has
settled — the letterbox `#stage { width: min(100vw, 100vh*16/10) }` sizing, `container-type: size`,
and async web-font loading can all shift the box after that first measurement. Worse, the puppet
QUARTER offset (`Math.max(PUPPET_X_OFFSET, renderer.worldWidth / 4)` in `Stage.create`) is derived
from that same possibly-wrong `worldWidth`, so the puppets can spawn at the wrong x too. A window
resize fires `onResize()` → `renderer.resize()` and everything snaps correct.

## Fix
1. **ResizeObserver on the stage/canvas** — observe the scene canvas (or `#stage`) and call
   `renderer.resize()` + `sizeOverlay()` whenever its size changes. This automatically catches the
   post-mount layout settle (and any later change), so no manual window resize is ever needed. Keep
   the existing `window` `resize` listener too (or rely solely on the observer).
2. **Re-measure after mount** (belt-and-suspenders): also call `resize()` once on the next
   `requestAnimationFrame` after `boot` is removed, and on `document.fonts.ready`.
3. **Re-derive the puppet quarters on a worldWidth change** — when `worldWidth` changes meaningfully,
   recompute `offset = max(PUPPET_X_OFFSET, worldWidth/4)` and reposition each puppet's home so it
   still sits on the screen quarter. Only reposition puppets that are in the `waiting` state (don't
   yank a live, attached puppet mid-fight); update `homeTorso.x` and `xOffset`. (If simplest, just fix
   the initial mis-measure so the create-time `worldWidth` is already correct — then the offset is
   right from the start and only the canvas needs the observer.)
4. Apply across pages: the engine covers `/game` + `/harness`; `/keyboard` (`src/keyboard.ts`) has its
   own `sizeOverlay()` for the cam preview + a DOM/CSS grid — make sure its overlay is sized after
   mount too (a ResizeObserver or a post-mount re-size), though the CSS grid itself should already
   fit.

## Acceptance Criteria
- [ ] `/game`, `/harness`, `/keyboard` render correctly on FIRST load with no manual window resize.
- [ ] Resizing the window (and the letterbox recomputing) still keeps everything fitting.
- [ ] Puppets sit on the screen quarters from the first frame (not only after a resize).
- [ ] `npx tsc --noEmit` + `npm run build` clean. No regression to the letterbox, HUD, or the loop.

## Relevant files
- `src/draw.ts` — `Renderer.resize()` / `worldWidth`.
- `src/engine.ts` — `Stage.create` (Renderer construction + the quarter `offset`), `onResize` /
  `sizeOverlay`; add the ResizeObserver + optional puppet re-quartering.
- `src/keyboard.ts` — its `sizeOverlay` for the cam overlay.

## Constraints
- Don't reposition a running/attached puppet on resize (only waiting ones). Keep 60fps (the observer
  fires on size change, not per frame). No emoji. Runtime-only verifiable — note a browser check
  (load fresh at a few window sizes without resizing).
