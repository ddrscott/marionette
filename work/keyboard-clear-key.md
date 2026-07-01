# CLEAR key — reset the current entry on the hand keyboard

## Problem
There's no fast way to wipe what you've typed and start the current entry over — you have to DEL
one char at a time. Add a **CLEAR** key to the on-screen keyboard that clears the whole current
entry in one press. On the `/keyboard` "Air Keyboard for Germaphobes" mini-game it should also
**restart the current phrase** cleanly.

## Decisions (from the user — do NOT relitigate)
- **On-screen key, hand-reachable.** A CLEAR key IN the keyboard grid (like DEL/OK), so it's
  pressable by air-pinch, mouse click, or tap — true to the no-touch theme. Present on BOTH layers
  (letters + symbols).
- **Full restart in the mini-game.** Pressing CLEAR clears the typed text AND resets the round to
  `ready` so the timer restarts — a clean redo of the **SAME** phrase (NOT "next phrase", which picks
  a new one). Since the hand is still present after the pinch, `gameUpdate` re-arms `running` and the
  clock effectively restarts from 0 immediately.

## Implementation notes (read the current code first)
- **Layout (`src/handkeyboard.ts`).** Add `"CLEAR"` to the bottom row of BOTH `LETTERS` and `SYMBOLS`
  (currently `["SPACE", "OK"]`) — e.g. `["SPACE", "CLEAR", "OK"]`. Mark it a control key in `isCtrl`
  (so it gets the `re-ctrl` style) — it is NOT a toggle and NOT a character.
- **Route it through the ONE shared press path (DRY).** Presses already funnel through `pushChar`
  (hand press, mouse/tap pointerdown, and physical typing all call it). Add a branch:
  `else if (ch === "CLEAR") { this.buf = ""; this.onClear?.(); }` — clears the buffer and fires an
  optional callback. Add `onClear?: () => void` to `HandKeyboardOpts` and store it. Do NOT special-
  case CLEAR in the pointer/hand paths separately; the existing `pressKey`→`pushChar` flow covers all
  three input methods. (`sfx.key()` already fires at the top of `pushChar`, so CLEAR clicks too.)
- **Wire the mini-game (`src/keyboard.ts`).** Pass `onClear` to the `HandKeyboard` that does a
  **restart of the current phrase**: keep `prompt` unchanged, set `phase = "ready"`, `startMs = 0`,
  reset the timer display to `0.0s`, clear `result`, hide the Next button, and re-render the prompt.
  (`pushChar` already emptied `kb.buf` before `onClear` runs, so don't re-pick a phrase — that's what
  the existing `newRound()` does; add a separate `restartRound()` or param that KEEPS the phrase.)
  Optional nicety: map a physical key (e.g. `Escape`) to `kb.pushChar("CLEAR")` in the keydown handler.
- **`/game` initials entry (`src/game.ts`).** The layouts are shared, so CLEAR appears there too.
  With no `onClear` passed, CLEAR just empties the (maxLen-3) initials buffer — harmless and useful.
  Verify it doesn't break the initials flow.

## Acceptance Criteria
- [ ] A CLEAR key shows in the on-screen keyboard on BOTH layers and is pressable by hand-pinch,
      mouse click, and tap.
- [ ] Pressing CLEAR empties the current typed entry in one press (all input methods).
- [ ] On `/keyboard`, CLEAR restarts the CURRENT phrase: same prompt, timer reset to `0.0s` and
      re-running once a hand is present, Next/result cleared — distinct from "next phrase" (new prompt).
- [ ] On `/game` initials entry, CLEAR empties the buffer without error.
- [ ] CLEAR routes through the single `pushChar` path (no duplicated per-input handling); DEL/OK/
      SPACE/`?123`/`ABC`, the x/y pinch, the click sound, and mouse/tap all still work.
- [ ] `npx tsc --noEmit` + `npm run build` clean; no emojis (use `re-ctrl` styling / Lucide if an icon
      is ever wanted).

## Relevant Files
- `src/handkeyboard.ts` — `LETTERS`/`SYMBOLS` bottom row, `isCtrl`, `pushChar` (add CLEAR branch),
  `HandKeyboardOpts.onClear` + store it.
- `src/keyboard.ts` — pass `onClear` → `restartRound()` (keep phrase, reset timer/phase/UI); optional
  Esc mapping.
- `src/game.ts` — verify initials entry with the new key.
- `src/style.css` — CLEAR reuses `.re-cell.re-ctrl`; adjust the bottom-row widths if needed.
- `README.md` — note the CLEAR key in the `/keyboard` section.

## Constraints
- Keep it DRY — CLEAR flows through `pushChar` + an `onClear` hook; no scene-specific input forks.
- Reset KEEPS the current phrase (redo), it does NOT advance to a new one.
- Don't regress DEL/OK/toggle/SPACE, the x/y-only pinch, pinky-delete, the click sound, or mouse/tap.
- Vite + TS; no new deps; no emojis.
