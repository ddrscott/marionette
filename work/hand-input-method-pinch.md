# Extract a HandInputMethod class (finger→thumb pinch) + smooth the UI cursor

## Problem
Two issues with the camera-input UI (the on-screen hand keyboard and the shared cursor):

1. **The UI cursor is jittery.** The game path smooths hand input (OneEuro on the raw landmark +
   `smoothDamp` at `smoothTime = 0.01`), but the UI cursor (`HandCursor.read()` in
   `src/handCursor.ts`) uses the RAW palm centroid with **no smoothing**, so it shakes. It should
   carry the same **0.01 damping** to steady it.
2. **The "close/select" detection is too strict.** Selection is currently a full **fist** —
   `isFist` needs ≥3 of 4 fingers curled (`src/gesture.ts:10`). That's a big, deliberate gesture.
   A light **finger-to-thumb pinch** is a faster, lower-effort select.

Beyond fixing those, the user wants to seed a **reusable gesture system**: a `HandInputMethod`
utility that detects **which fingers are touching the thumb**. The keyboard should treat **any
finger→thumb touch as a selection**. This is intended to grow (more gestures later) and to be
reused **in-game as a battle mechanic for special moves** (e.g. index+thumb = move A, pinky+thumb =
move B) — that game wiring is FUTURE work, not part of this task.

## Decisions (from the user — do NOT relitigate)
- **Replace fist with pinch in the keyboard.** Any fingertip touching the thumb tip = select/press.
  Retire `isFist` as the keyboard's press gesture (the pinch replaces it — do not keep both).
- **Keep the 0.01 damping on the UI cursor.** Smooth the cursor position so it doesn't jitter,
  matching the game's `smoothTime = 0.01` feel.
- **Scope = extract the class + wire the keyboard only.** Build `HandInputMethod`, add cursor
  damping, make the keyboard select on pinch. Design the class so game special-moves and additional
  gestures can consume it later, but do NOT map/implement battle moves or a full move vocabulary in
  this task — leave that as documented follow-up.

## What to build

### `HandInputMethod` utility class (new — likely `src/handInput.ts`)
- Input: one hand's `Landmark[]` (+ `now` for edge/debounce timing). Pure-ish, no MediaPipe import
  (mirror the style of `gesture.ts` / `control.ts`).
- Detects, per finger, whether its **tip is touching the thumb tip**. Landmarks: thumb tip = `4`;
  finger tips = index `8`, middle `12`, ring `16`, pinky `20`.
- **Normalize the touch threshold by hand size** so it's distance/scale invariant — e.g. divide the
  tip-to-thumb distance by a stable hand-span reference such as `dist(wrist[0], middleMCP[9])`.
  Touch when the normalized distance < a tuned threshold (the fix for "too strict": pick a threshold
  that reliably fires on a natural pinch without false positives on a relaxed open hand).
- Expose: which fingers are currently touching (per-finger boolean/set), and **debounced rising
  edges** ("a pinch just happened this finger") — reuse the cooldown pattern from `HandCursor`
  (`cooldownMs ?? 350`, `lastClickT`) so one pinch = one select, no repeats.
- Shape the API so a consumer can ask both "any finger touching thumb?" (the keyboard's select) and
  "which finger(s)?" (future per-finger moves). Keep it a small, documented, reusable primitive.

### Wire it into the keyboard
- `HandKeyboard.update` (`src/handkeyboard.ts:74`) currently presses on `cs.clicked` (the fist edge
  from `HandCursor`). Switch the PRESS trigger to the `HandInputMethod` **any-finger→thumb pinch
  edge**. The cursor POSITION still comes from `HandCursor` (palm centroid); only the click source
  changes. `pushChar` / hit-testing stay as-is.
- The keyboard should keep working from a physical keyboard too (`pushChar` path unchanged).

### Add 0.01 damping to the UI cursor
- Smooth the cursor x/y inside `HandCursor` (so every UI scene that uses it benefits), using the same
  approach as the game — reuse `smoothDamp` (see `engine.ts:51` / `pilot.ts:37`) at
  `smoothTime = 0.01`, or a `OneEuro` filter (`src/oneEuro.ts`, `POS_MIN_CUTOFF`/`POS_BETA`).
  `HandCursor.read` already takes `now`, so a time-aware filter fits. Keep the palm-centroid choice
  (it's stable under a curl) — damping is additive smoothing, not a landmark change.
- Note: because select is now a light pinch (not a fist), the palm centroid barely moves at the
  moment of selection — good, the cursor won't jump on press. Confirm the pinch doesn't drag the
  cursor off the intended key.

## Acceptance Criteria
- [ ] A `HandInputMethod` class exists (its own module), detects which fingers touch the thumb
      (hand-size-normalized threshold), and exposes debounced per-finger pinch edges + an
      "any finger touching" query. Documented for reuse.
- [ ] The hand keyboard selects/presses a key on **any finger→thumb pinch** (fist no longer
      required); pressing feels responsive and is not "too strict."
- [ ] The UI cursor is visibly **smoother** (0.01 damping), no raw jitter; it still lands on the key
      it points at and doesn't lurch when the pinch fires.
- [ ] One pinch = one select (debounced); holding the pinch doesn't machine-gun keys.
- [ ] Physical-keyboard input to the same buffer still works; `/keyboard` test bed and `/game`
      initials entry (maxLen 3) both still work.
- [ ] `npx tsc --noEmit` + `npm run build` clean. No emojis in UI.

## Future work (document, do NOT build here)
- Game battle mechanic: map specific finger→thumb combos to special moves, consuming
  `HandInputMethod`. Add a small gesture→action map when that lands.
- Broader gesture vocabulary + rolling the pinch-select into the other UI scenes (fighter picker,
  etc., which currently use the shared `isFist` click via `HandCursor`).

## Relevant Files
- `src/gesture.ts` — `isFist` (the current too-strict select); leave it (still the game/cursor
  click for other scenes) but the keyboard stops using it for press.
- `src/handInput.ts` — NEW: the `HandInputMethod` class.
- `src/handCursor.ts` — add 0.01 cursor damping; still supplies cursor POSITION.
- `src/handkeyboard.ts` — swap the press trigger to the pinch edge (`update`, line 74/93).
- `src/oneEuro.ts` / `smoothDamp` in `engine.ts:51` & `pilot.ts:37` — smoothing to reuse.
- `src/keyboard.ts` — `/keyboard` test bed wiring (verify still works).
- `README.md` — document the camera-input model change (pinch-to-select + the new class).

## Constraints
- Reuse the existing smoothing primitives (`smoothDamp` / `OneEuro`); don't invent a new filter.
- Keep `HandInputMethod` a small, pure, reusable primitive (same spirit as `gesture.ts`) so the game
  can consume it later — no keyboard/DOM coupling inside the class.
- Don't regress the other scenes that still use `HandCursor` + `isFist` (only the keyboard's PRESS
  source changes; the cursor damping is a safe, shared improvement).
- Tune the pinch threshold to be forgiving (fix "too strict") without false-firing on an open hand;
  normalize by hand size so camera distance doesn't matter.
- Vite + TS; no new deps; no emojis.
