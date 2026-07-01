# Add numbers, symbols & spacebar to the hand keyboard (mobile-style layer toggle)

## Problem
The hand-driven keyboard (`src/handkeyboard.ts`) only has A–Z plus DEL/OK. There's no way to type
**numbers, symbols, or a space**. Add them. Because this keyboard is POINTED at with the palm and
pressed by pinch/fist, target size matters — cramming every key onto one screen shrinks the pinch
targets and hurts accuracy. So use a **mobile-style layer toggle** (letters ⇄ symbols) to keep the
targets large, rather than one dense flat grid.

## Decisions (from the user — do NOT relitigate)
- **Layout = mobile-style layer toggle.** A letters view and a numbers/symbols view, swapped by a
  toggle key (`?123` on the letter layer, `ABC` on the symbol layer). Spacebar + DEL + OK appear on
  BOTH layers. This is the exact layout the user picked:

  Letters view:
  ```
  Q W E R T Y U I O P
   A S D F G H J K L
  ?123  Z X C V B N M  DEL
       [    space    ]  OK
  ```

  Symbols view (`?123`):
  ```
  1 2 3 4 5 6 7 8 9 0
  @ # $ _ & - + ( ) /
  ABC  * " ' : ; ! ?   DEL
       [    space    ]  OK
  ```

- **Symbol set = curated common set** (not the full US layout). The symbols in the layout above
  cover it: `@ # $ _ & - + ( ) / * " ' : ; ! ?`. If a slot is free you MAY also include the other
  common ones `. , = %` — but keep it a comfortable, large-target grid; do not chase completeness.

## Implementation notes (read the current code first)
The keyboard changed since it was first written — build on the CURRENT shape:
- `ROWS` is a hardcoded `string[][]` module const (`handkeyboard.ts:12`); the grid is built ONCE in
  the constructor and a press does `pushChar(ROWS[hit.r][hit.c])` (line 99), hit-testing by real DOM
  rect. You now need **two layouts** and a way to switch the rendered grid (rebuild the rows, or
  render both and toggle visibility + which set is hit-tested). Keep the "key is where it looks"
  rect-based hit-testing.
- **Special (non-character) keys.** Today only `DEL`/`OK` are special (`pushChar`, line 71). Add:
  - `SPACE` → append `" "` (respect `maxLen`). The label is a wide bar; hit-test still works by rect
    since keys are sized by DOM. Give it a wide flex-grow (new `.re-space` class) so it reads as a
    spacebar like the layout above.
  - `?123` / `ABC` → **layer toggle**, NOT a character. The press handler must special-case these
    (switch the active layout) instead of calling `pushChar`. Don't append the label to the buffer.
  - Keep `DEL` (backspace) and `OK` (submit) on both layers, unchanged behavior.
- **Pinky-pinch = DELETE** stays as-is (`handkeyboard.ts:101-108`) and is layer-agnostic (it doesn't
  hit-test a key), so it keeps working on both layers with no change.
- **Physical-keyboard parity.** `pushChar` is also driven by a real keyboard on `/keyboard`
  (`src/keyboard.ts` keydown handler — currently only routes `a-z`, Backspace→DEL, Enter→OK) and
  wherever else HandKeyboard is mounted (`/game` initials, maxLen 3). Extend the physical mapping so
  digits, the curated symbols, and Space also feed `pushChar` (Space→`" "`). Digits/symbols/space
  should type regardless of which on-screen layer is showing (physical input bypasses layers).
- **Styling.** Reuse `.re-cell` / `.re-ctrl` (`src/style.css:196-202`, container-query sized). Add a
  `.re-space` (wide) and style the `?123`/`ABC` toggle like a control key (`re-ctrl`). Keep the
  duotone/teal accent + the `.on` highlight; no emojis (Lucide only if an icon is ever needed).

## Acceptance Criteria
- [ ] The keyboard has a letters layer and a `?123` numbers/symbols layer matching the layouts above;
      a toggle key swaps between them (`?123` ⇄ `ABC`) and toggling does NOT type a character.
- [ ] Digits `0-9` and the curated symbols (`@ # $ _ & - + ( ) / * " ' : ; ! ?`) can be typed by
      pointing + pinch/fist, and appear in the buffer.
- [ ] A working **spacebar** (wide key) on both layers appends a space (respects `maxLen`).
- [ ] DEL (incl. pinky-pinch), OK/submit, and the palm-cursor + pinch/fist press all still work on
      both layers; targets stay comfortably large.
- [ ] Physical keyboard on `/keyboard` also types digits/symbols/space (parity with `pushChar`).
- [ ] `/game` initials entry still works (the extra keys/toggle don't break the maxLen-3 flow).
- [ ] `npx tsc --noEmit` + `npm run build` clean; no emojis in the UI.

## Relevant Files
- `src/handkeyboard.ts` — `ROWS` (→ two layouts + toggle), `pushChar` (SPACE + toggle handling),
  `update`/press (line 99), grid build in the constructor.
- `src/keyboard.ts` — `/keyboard` test bed: extend the physical keydown → `pushChar` mapping.
- `src/game.ts` — the other HandKeyboard mount (initials, maxLen 3) — verify it still works.
- `src/style.css` — `.re-cell` / `.re-ctrl` (196-202); add `.re-space` + toggle-key styling.

## Constraints
- Keep targets LARGE — the layer toggle exists precisely so we don't shrink pinch targets; don't
  collapse both layers into one dense grid.
- Reuse the existing rect-based hit-test and `pushChar` buffer model; don't fork a parallel input path.
- Don't regress the pinch/fist click, pinky-pinch DELETE, or the palm-cursor damping.
- Physical-keyboard input must keep driving the same buffer (DRY — one `pushChar`).
- Vite + TS; no new deps; no emojis (Lucide icons only if ever needed).
