# Letterbox /game to 16:10 + full UI readability pass

## Problem
The **canvas-drawn** UI text is unreadable — especially the "raise a hand" / "hold still…" prompt
labels and the 1–5 finger/control-point numbers. Root cause: those are drawn on the `<canvas>` at
**fixed pixel sizes** (`ctx.font = "11px…"` / `"12px…"`, disc radius `8`), so they don't scale with
the canvas. (The earlier `clamp()` pass only scaled the DOM HUD, not canvas text.) On a big display
the canvas is high-res but the labels stay ~11px = tiny.

## Decisions (from the user — do NOT relitigate)
- **Letterbox the /game stage to a fixed 16:10 aspect**, reference **1280×800**. The play area is a
  centred 16:10 box; the leftover on other window shapes is filled with the page background (letter-/
  pillar-box bars). This makes composition + sizing deterministic.
- **Full UI readability pass** — canvas text AND the DOM HUD, all comfortably readable at 1280×800.

## Approach

### 1. Letterbox the game stage to 16:10 (mostly CSS)
- Make `body.game #stage` a centred box sized to the largest 16:10 that fits the viewport, with the
  page bg showing as bars around it, e.g.:
  ```css
  body.game { display: grid; place-items: center; height: 100vh; background: var(--bg); }
  body.game #stage {
    position: relative;
    width:  min(100vw, calc(100vh * 16 / 10));
    height: min(100vh, calc(100vw * 10 / 16));
  }
  ```
  Everything already lives INSIDE `#stage` (canvas, `#hud`, `#camBox`, mute button, `#recordEntry`,
  boot), so they all align to the play box automatically; the bars are just the body bg.
- The renderer already sizes the canvas from `clientWidth/clientHeight` and `scale = height /
  WORLD_VIEW_HEIGHT (12)`. With a 16:10 box, `worldWidth` becomes a DETERMINISTIC `12 * 16/10 = 19.2`
  units (quarters at ±4.8, wall at 0, etc. all fixed) — no renderer change needed beyond it picking up
  the box size on resize. Confirm `renderer.resize()` still fires on the box resizing.

### 2. Canvas text in WORLD UNITS (the actual readability fix — `src/draw.ts`)
Size every canvas-drawn glyph relative to `this.scale` (px per world unit) instead of fixed px, so it
scales with the canvas and reads the same at any resolution:
- `drawPrompt` label ("raise a hand" / "hold still…") — font ≈ a world-unit fraction × `this.scale`
  (tune so it's clearly readable at 1280×800; the hand outline is already sized off `h`).
- `drawFingerPoints` — the coloured dots' radius and the 1–5 number font in world units.
- `drawPuppet` control discs — the disc radius (`8`) and the 1–5 number font in world units.
- The progress bar under the prompt + the "REC"/streak text if any is canvas-drawn (most HUD is DOM).
Pick sizes that read well at the 1280×800 reference (world height = 12 → scale ≈ 800/12 ≈ 67 px/unit,
so e.g. a 0.4-unit label ≈ 27px). Applies to BOTH `/game` and `/harness` (shared renderer) — good.

### 3. DOM HUD sized to the STAGE BOX (not the raw viewport)
The HUD font `clamp()`s currently use `vmin` (viewport). Once letterboxed, the box can be smaller than
the viewport, so viewport-`vmin` drifts from the box. Size the HUD relative to the **stage box** —
e.g. make `#stage` a container (`container-type: size`) and switch the HUD `clamp()` terms from `vmin`
to **`cqmin`** (container-query units), or set a `--stage` CSS var from JS on resize. Sweep the
announcer, sub-label, timer, player names, power bars, pips, streak/record, and the record-entry so
all read comfortably at 1280×800 within the box.

## Acceptance Criteria
- [ ] `/game` renders as a centred 16:10 stage with the page bg as letterbox bars on non-16:10 windows.
- [ ] The canvas "raise a hand" / "hold still…" labels and the 1–5 numbers are clearly readable and
      scale with the canvas (not fixed px). Confirmed at ~1280×800 and larger.
- [ ] The DOM HUD stays proportional to the stage box after letterboxing (no over/under-sized text).
- [ ] `/harness` still works (it isn't letterboxed, but the canvas text is now world-sized there too).
- [ ] `npx tsc --noEmit` + `npm run build` clean.

## Relevant files
- `src/draw.ts` — canvas text/disc sizing in world units (`this.scale`); `renderer.resize()`.
- `src/style.css` — the 16:10 letterbox for `body.game #stage`; HUD `clamp()` terms → box-relative
  (`cqmin`/container query) ; the rotate-gate/mute/cam already inside `#stage`.
- `game/index.html` — only if a wrapper is needed (probably not; `#stage` is already the box).
- `src/engine.ts` — no logic change expected (worldWidth just becomes deterministic).

## Constraints
- Keep the anime-fighter theme, the duotone colours, the center wall / quarters / attach ritual, the
  audio + mute button, and the portrait-lock. No emojis. Don't regress the harness.
- Colour/size is unverifiable in CI beyond build/types — have the user (or a browser-agent screenshot
  pass across a few window sizes: 1280×800, 2560×1440, an ultrawide) confirm readability + letterbox.
