# Game audio — procedural WebAudio SFX + adaptive music

## Goal
Give `/game` amazing, punchy audio: **slicing** (a string is cut), **clashing** (the two puppets'
limbs collide), and **background music** — plus the rest of the fighter's audio moments. All
**procedurally synthesized** with the WebAudio API (no audio assets, no deps), in the style of the
reference project.

## Decisions (from the user — do NOT relitigate)
- **Procedural WebAudio synth**, not sampled files. Oscillators + noise bursts for SFX, a chiptune
  scheduler for music. Zero assets, zero deps — matches this project's no-asset philosophy.
- **Full fighter audio coverage** (below), including music, not just slice/clash.

## Reference — LEARN FROM (don't copy blindly; it's vanilla JS, we're Vite + TS ESM)
`~/code/false-alarms-web/public/js/sound.js` and `.../music.js`:
- **sound.js**: one shared `AudioContext` + a master `GainNode` bus (SFX + music both hang off it so
  one mute kills all). `unlock()` creates/resumes the ctx on a user gesture. `blip(freq,dur,type,vol,
  slide)` = an oscillator with an exponential gain envelope + optional pitch slide. `noise(dur,vol,
  freq)` = a decaying white-noise buffer through a lowpass. A `throttled(key,windowMs,fn)` helper
  guards rapid/continuous triggers. An `sfx` object maps named events to little synth recipes
  (layered blips/noise). Port this shape to `src/sound.ts`.
- **music.js**: an adaptive chiptune engine — a "song" = step patterns (16-step bars) + layers
  (bass/arp/lead/drums) run by a **lookahead scheduler**; a COMBAT song escalates with intensity
  (instruments fade in, tempo climbs) and a calmer MENU song for non-combat screens; both share the
  same bus. Port/adapt to `src/music.ts`. (You can simplify the pattern authoring, but keep the
  lookahead-scheduler + two-track menu/combat structure.)

## Events to wire (in the /game layer — engine.ts / match.ts / cut.ts / game.ts)
- **slice** — a string is cut (`cutStringAtSeg` in cut.ts). Sharp downward "shff"/slice: a short
  filtered noise burst + a quick descending blip. This is the money SFX — make it satisfying.
- **clash** — the two puppets' LIMBS collide. NOTE: the puppets currently do NOT physically collide
  (collision groups: each puppet is group 0, collides only with the floor group 1 — they pass through
  each other). So "run into each other" needs **proximity/collision detection** between the two
  puppets' limb capsules — mirror the approach in `cut.ts` (limb tip positions), or enable
  puppet↔puppet collisions and read contact events. A metallic clang (a couple of detuned blips +
  a noise tick), throttled so a sustained overlap doesn't machine-gun.
- **attach** — each string snaps on during the ritual (`attachStringForSlot`, fires 5× over ~1s per
  puppet): a short pluck/whoosh, rising per string index for a satisfying build.
- **K.O.** — a puppet is killed (match `dead` / `roundWinner`): a big hit + downward sweep.
- **round stingers** — on the announcer text changing: "ROUND N" chime, "FIGHT!" hit, "TIME"/"K.O."
  stingers, and a **win fanfare** at matchEnd.
- **low-time beeps** — during `fight` when `timeLeft <= 10`, a per-second tick (throttled), rising
  urgency.

## Music
- **Menu/prematch track** during `prematch` / `roundStart` / `roundEnd` / `matchEnd` — calmer, fixed
  intensity.
- **Fight track** during `fight` — more intense; ideally **adaptive** (intensity rises as total
  strings drop / near time-out). Crossfade between the two on phase change (share the master bus).
- A **mute** toggle (e.g. an on-screen speaker button and/or the `M` key), driving the master gain.

## Audio unlock (browser autoplay policy)
WebAudio can't start without a user gesture, and this game is hands-only (webcam ≠ an audio gesture).
Add an explicit unlock: a "click / press to start" affordance on the game page (or unlock on the
first `click`/`keydown`/`pointerdown`), then `ctx.resume()`. State this clearly; music should start
only after unlock.

## Architecture
- `src/sound.ts` — the SFX synth (shared AudioContext + master bus, `blip`/`noise`/`throttled`, an
  `sfx` map, `unlock()`, `setMuted()`), exported for the game.
- `src/music.ts` — the music engine (menu + fight songs, lookahead scheduler), sharing the bus from
  sound.ts. Start/stop/transition API driven by match phase.
- Wire triggers where the events happen. Prefer small **hooks/callbacks on the engine** (e.g. an
  `onCut`, `onAttach` callback, or a lightweight event the game subscribes to) rather than the game
  polling — but a poll of `slotStates`/`intactCount`/`match.phase` deltas in `stage.onFrame` is an
  acceptable simpler route if cleaner. Keep audio scheduling OFF the render-critical path (its own
  timers / the lookahead scheduler), so it never costs the 60fps.

## Acceptance Criteria
- [ ] `src/sound.ts` + `src/music.ts` (procedural, no assets, no new deps). One shared AudioContext +
      master gain; mute kills everything.
- [ ] Slice + clash SFX fire on the real game events (string cut; the two puppets' limbs colliding),
      throttled so they can't machine-gun. Clash detection added (proximity or enabled collisions).
- [ ] Attach, K.O., round/FIGHT/TIME stingers, win fanfare, and low-time beeps all wired to the match
      FSM / cut events.
- [ ] Menu vs fight music, crossfading on phase change; adaptive fight intensity is a bonus.
- [ ] Audio unlock on a user gesture (documented); nothing plays before unlock. Mute toggle works.
- [ ] `npx tsc --noEmit` + `npm run build` clean. `/harness` is UNAFFECTED (audio is game-only).
- [ ] README updated (audio: procedural WebAudio, the sound.ts/music.ts modules, the unlock + mute).

## Constraints
- Vite + **TypeScript ESM** (the reference is vanilla JS in `public/js` — adapt, don't drop files in
  as-is). No emojis in UI (use a Lucide icon for the mute button if one is shown). No new npm deps.
- Don't regress the game FSM, the cut-at-joint mechanic, the attach ritual, fps, or the harness.
- Runtime/audio is **unverifiable headlessly** — only build/types are provable here. Say so; the user
  tests the actual sound in Chrome.
