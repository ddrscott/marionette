# Recolor to a duotone (teal + rust) theme — kill the rainbow

## Problem
The current palette is scattered and juvenile: 5 rainbow finger colors (red/yellow/green/blue/purple),
green arms + blue legs + white torso on the puppet, magenta/cyan HUD, green UI accent. It reads "for
kids." Commit the whole app to ONE mature theme and stick to it.

## Decisions (from the user — do NOT relitigate)
- **Theme: duotone — muted teal + burnt rust**, on near-monochrome charcoal/bone grays. Just those
  two hues (plus neutrals) across the ENTIRE UI. No rainbow, no green/magenta/cyan.
- **Per-player team color:** each player's 5 strings/control-dots/overlay rings take THAT player's
  team color; the fingers are told apart by the **1–5 number labels**, not by hue.

## Palette (concrete — use these as the theme tokens; tune within the family if needed)
- `--rust: #c46a45` — **Player 1 (left)** / warm. (keeps the existing warm-left / cool-right split)
- `--teal: #4fb0aa` — **Player 2 (right)** / cool. Also the single **UI accent** (replaces the green).
- Neutrals (mostly keep): `--bg #0d0d0f`, panel `#141418`, `--line #26262c`, `--fg #e8e8e8`,
  `--dim #7a7a82`. Puppet bone/off-white `#d8d4cc`.
- Map the existing vars: `--p1: var(--rust)`, `--p2: var(--teal)`, and **`--accent: var(--teal)`**
  (currently `#39d98a` green — repoint everywhere it's used: pips, links, home headings/glows,
  home-link hover, etc.).
- Bars: left fill a rust gradient (e.g. `#e0895a → var(--rust)`), right a teal gradient
  (`#7ad0c8 → var(--teal)`) — replace the current gold→pink / cyan→blue literals; the glows already
  reference `--p1`/`--p2`.
- Low-time timer urgency: use an **intensified rust** (warm = danger), not a new red hue, to stay
  duotone. (Currently `#ff4655`.)

## What to change
- `src/style.css` — the `:root` tokens (above), the game HUD (`.pbar .fill` gradients, `.timer.low`,
  pips, glows, announcer glow), the landing (`.home h1` glow, `.home-links a b`), the harness accents.
  Sweep for any hard-coded green/magenta/cyan/gold and move them onto the two theme hues + neutrals.
- `src/draw.ts` — **`FINGER_COLORS` (the 5-color rainbow) is the core offender.** It's used for
  strings, control-point discs, the camera-overlay fingertip rings, and the calibration points — for
  BOTH players via `s.slot`. Rework so color comes from the PLAYER/TEAM, not the finger slot:
  - `drawPuppet(rig)` — color strings + control discs by the puppet's team (left puppet `xOffset < 0`
    = P1 rust; right = P2 teal), keeping the `1–5` number on each disc for finger identity.
  - `drawFingerPoints(pts)` — called per slot during calibration; pass/derive the team color.
  - `drawHands(...)` overlay — each hand maps to a slot (0 = left, 1 = right); ring its fingertips in
    that team's color (still numbered 1–5). Thread a per-hand color through instead of `FINGER_COLORS`.
- `src/puppet.ts` — the limb colors (`torso #e8e8e8`, arms `#39d98a` green, legs `#5b8cff` blue). Make
  the puppet body **neutral bone/gray** (torso `#d8d4cc`, limbs a muted gray like `#9a968e`) so the
  team color is carried by the **strings** — OR tint each puppet its team color if that reads better
  in a fight. Recommend: neutral body + team-colored strings/dots (cleanest duotone); if it looks
  flat, lightly tint the limbs toward the team hue. Use judgment; keep both puppets clearly
  distinguishable as rust vs teal.
- Update the harness note/legend text that references the old per-finger colors ("matching colours",
  the finger list) to reflect team-color + numbers.

## Acceptance Criteria
- [ ] The entire app (landing, `/harness`, `/game`) uses ONLY teal + rust + neutral grays/bone — no
      green, magenta, cyan, or 5-color rainbow anywhere.
- [ ] Player 1 = rust, Player 2 = teal, consistently: strings, control dots, overlay rings, HUD bars,
      pips, and (if tinted) the puppet body.
- [ ] Fingers remain distinguishable via the 1–5 number labels; nothing relies on per-finger hue.
- [ ] `--accent` and all former-green UI (pips-on, links, headings) are teal; contrast/legibility on
      the dark bg is preserved.
- [ ] `npx tsc --noEmit` + `npm run build` clean. README palette note updated if it lists colors.

## Constraints
- No emojis. Keep good contrast on `--bg`. Apply consistently across all three pages.
- Don't break the finger→string mapping legibility (the numbers now carry it), the anime-fighter HUD
  layout, the attach ritual, or the cut mechanic.
- Colour is unverifiable in CI beyond build/types — have the user eyeball it (a browser-agent
  screenshot pass is ideal).
