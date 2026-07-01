# Fullscreen button on /game

## Problem
No way to go fullscreen. The game is a full-window 16:10 letterboxed experience; a fullscreen toggle
lets players fill the whole display (great for a fighter, and for hiding browser chrome on a big TV).

## What to build
- A small **fullscreen toggle button** in the game HUD, next to the existing mute button (bottom
  corner of `#stage`). Uses the **Fullscreen API**: `document.documentElement.requestFullscreen()` to
  enter, `document.exitFullscreen()` to leave; toggle based on `document.fullscreenElement`.
- Swap the icon on `fullscreenchange`: **Lucide `maximize`** when windowed → **Lucide `minimize`**
  when fullscreen (inline SVG, same pattern as the mute button's `volume` icons — NO emoji).
- Wire it in `src/game.ts` alongside the mute setup; add the button markup to `game/index.html` and
  styles to `src/style.css` mirroring `.mute-btn`.
- Handle the promise rejection from `requestFullscreen()` gracefully (some contexts deny it).

## Acceptance Criteria
- [ ] A fullscreen button on `/game` toggles the browser into/out of fullscreen and its icon reflects
      the current state (maximize/minimize), staying in sync if the user exits via Esc.
- [ ] Placed with the mute button, on-theme (teal/rust), pointer-events work over the HUD overlay.
- [ ] `npx tsc --noEmit` + `npm run build` clean. Doesn't disturb the mute button, HUD, or letterbox.

## Constraints
- No emoji (Lucide icons only). Keep the anime/duotone theme. Runtime-only verifiable — note the user
  should confirm the toggle + icon in a browser.
