# Virtual keyboard: mouse-click + screen-tap input

## Problem
The on-screen keyboard (`HandKeyboard`) can only be driven by the hand cursor (pinch/fist) or a
physical keyboard. It should ALSO respond to plain **mouse clicks and touch taps** on the keys — the
obvious fallback when there's no camera/hand, and expected behavior for anything that looks like a
tappable button. This applies wherever the keyboard mounts: the `/keyboard` test bed and `/game`
record-initials entry.

## How it works today (read before coding)
`src/handkeyboard.ts` builds a DOM cell per key in `buildLayer()` (line 72) — the cells already exist
as real elements and are hit-tested by rectangle for the hand cursor. The press ROUTING currently
lives INLINE in `update()` (lines 138–142):
```
const key = LAYOUTS[this.layer][hit.r][hit.c];
if (isToggle(key)) this.setLayer(this.layer === 0 ? 1 : 0); // ?123 ⇄ ABC
else this.pushChar(key === "SPACE" ? " " : key);            // SPACE → " "; DEL/OK/char
```
So the special-key semantics (layer toggle, SPACE→space, DEL/OK) are only in the hand path. A naive
`pointerdown → pushChar(label)` would type "?123"/"SPACE" literally and break the toggle.

## Implementation notes
- **Extract the press routing into one shared method** (DRY), e.g. `private pressKey(r, c)` (or
  `pressCell(cell)`) that does exactly the toggle / SPACE / `pushChar` logic above. Call it from BOTH
  the hand path in `update()` (replace the inline block) and the new pointer handler.
- **Wire `pointerdown` on each cell in `buildLayer()`** (cells are rebuilt on every layer toggle, so
  attach the listener there). `pointerdown` covers mouse + touch + pen and avoids the ~300ms click
  delay, so taps feel instant. In the handler: `e.preventDefault()` (stop text-selection / double
  fire / mobile zoom), look up that cell's `(r, c)`, and call `pressKey`.
- **Affordance + feedback.** Add `cursor: pointer` and `user-select: none` to `.re-cell`
  (`src/style.css:202`), and a brief pressed state on tap — reuse the existing `.on` highlight (flash
  it on the tapped cell) or a `.re-cell:active` style — so a click/tap reads as a press like the hand
  highlight does.
- **Coexist with the hand cursor.** Mouse/touch and hand input must both work; a pointer tap must not
  disturb the hand cursor dot or its hit-testing. The floating cursor element is the grid's last
  child and can keep `pointer-events: none` so it never eats a tap.
- **Consistency with the click sound.** The pending keyboard-click-sound task fires in `pushChar`, so
  pointer-driven char/DEL/OK presses will click for free; the layer toggle goes through `setLayer`
  (not `pushChar`) so it stays silent — acceptable. If you want the toggle to click too, route the
  sound inside the shared `pressKey` instead. (Don't block on this task; just don't regress it.)

## Acceptance Criteria
- [ ] Clicking a key with the mouse, or tapping it on a touchscreen, presses it — letters, digits,
      symbols, SPACE (→ space), DEL (backspace), OK (submit), and the ?123/ABC toggle (switches
      layer, does NOT type its label).
- [ ] Works on `/keyboard` and in `/game` initials entry (component-level change, both mounts).
- [ ] The press routing is shared by the hand and pointer paths (no duplicated toggle/SPACE/DEL
      logic).
- [ ] A tap/click gives visible pressed feedback and does not select text, zoom, or double-fire on
      touch; keys show a pointer cursor.
- [ ] Hand-cursor input and physical-keyboard input still work unchanged and coexist with pointer
      input.
- [ ] `npx tsc --noEmit` + `npm run build` clean; no emojis; no new deps.

## Relevant Files
- `src/handkeyboard.ts` — extract `pressKey(r,c)`; call it from `update()` (138–142) and from a new
  `pointerdown` listener added per cell in `buildLayer()` (72).
- `src/style.css` — `.re-cell` (202): add `cursor: pointer`, `user-select: none`, and a
  pressed/`:active` feedback state.
- `src/keyboard.ts`, `src/game.ts` — mounts to sanity-check (no change expected).

## Constraints
- One shared press path for hand + pointer + physical (DRY) — don't fork the special-key semantics.
- Use `pointerdown` (mouse + touch + pen), prevent default to dodge the click delay / double events /
  text selection.
- Don't regress hand-cursor input, the layer toggle, pinky-pinch DELETE, or the pending click sound.
- Vite + TS; no new deps; no emojis.
