# Work Queue

- [x] Fix double finger-numbers during attach + connect strings to the moving fingertips — the attach freezes each string's control at the CAPTURED pose while `drawFingerPoints` draws the LIVE fingertips, so two numbered 1..5 sets separate as the hand drifts and strings anchor to stale points; drive controls to the live fingertips during attach (keep the reset-on-move gate) and draw exactly ONE numbered set per phase; all attach scenes (`pilot.ts` /pose+/characters AND `engine.ts` /game), strings stay force-driven, no seizure regression — see [attach-double-numbers.md](attach-double-numbers.md)

- [x] Anatomically-correct pose targets + lower leg sockets — `/pose` silhouettes place limbs (esp. legs) from free per-part CENTER offsets that ignore the rig's real socket geometry, so a target limb floats where the puppet can never reach; redefine poses by per-limb ANGLE + torso pose and compute each silhouette limb so its socket end sits on the puppet's actual socket (anatomically consistent, always reachable); ALSO attach humanoid legs slightly lower (addPuppet leg socket y:-0.5 → lower); update soft-string SOCKETS guard, no seizure regression — see [pose-anatomical-targets.md](pose-anatomical-targets.md)

- [x] Puppets collide with each other (no passthrough) — replace the single shared `PUPPET_GROUP` (both players + weapons in one group, mask=floor only) with per-player collision groups so the two `/game` puppets can't pass through one another; bodies + weapons collide with the OPPONENT, self-collision stays OFF (no limb jam / seizure regression), strings still cut legitimately, `/characters` + `/pose` unaffected — see [puppet-collision.md](puppet-collision.md)

- [x] Pose scene supports portrait orientation — drop the "Rotate to landscape" lock on `/pose` and reflow the play area to fit the screen's aspect (taller/narrower in portrait, puppet + silhouette scale to fit); `/pose` only, other scenes unchanged, pose mechanics + soft-string physics preserved — see [pose-portrait.md](pose-portrait.md)

- [x] Soft goal-drive strings (capped-force) so limbs can never be pulled off the puppet — replace the rigid finger→limb chain + `JointData.rope` with a capped, damped spring force dragging each limb toward its fingertip GOAL (force cap below the body's ball-joint strength = no rip), string drawn as a light line pointing at the fingertip; everywhere (`engine.ts` + `pilot.ts`), harness sliders for stiffness/damping/cap, cut/detach + anti-seizure invariants preserved — see [soft-string-goal-drive.md](soft-string-goal-drive.md)

- [x] Rope joint carries string tension — add one `JointData.rope(nominalLen)` control→part per string in parallel with the visual chain (kills stretch, lets solver iterations + segment mass + string friction come down); MUST be severed on every cut/detach path or cuts stop releasing parts — see [rope-joint-tension.md](rope-joint-tension.md)

- [x] Add a CLEAR key to the hand keyboard — on-screen key (both layers, hand/mouse/tap) that empties the current entry via the shared pushChar + an onClear hook; on /keyboard it restarts the current phrase (clear text + reset timer, same prompt) — see [keyboard-clear-key.md](keyboard-clear-key.md)

- [x] Debug overlay on /keyboard — live finger→thumb distance ratios (vs 0.45 threshold) + confidence score (vs 0.9 gate) + hand edge-position, to diagnose left-edge gesture dropoff; reuse gesture.ts math (DRY), diagnostic-only — see [keyboard-debug-overlay.md](keyboard-debug-overlay.md)

- [x] Make the camera preview draggable (mouse + touch) on /game, /characters, /keyboard — free placement, clamped on-screen (safe-area aware), persisted via localStorage; shared helper, not per-scene — see [draggable-camera.md](draggable-camera.md)

- [x] Play a click sound (public/assets/kb-click.wav) on every accepted keyboard key — both hand presses and physical typing, triggered in HandKeyboard.pushChar; add a sample player to sound.ts (shared bus/mute), unlock audio on /keyboard — see [keyboard-click-sound.md](keyboard-click-sound.md)

- [x] Virtual keyboard responds to mouse clicks + screen taps — pointerdown on each key routed through a shared press path (toggle/SPACE/DEL/OK), pressed-state feedback, coexists with hand + physical input — see [keyboard-mouse-touch.md](keyboard-mouse-touch.md)

- [x] Smooth the UI cursor with the existing One-Euro filter (src/oneEuro.ts) — HandCursor returns the raw palm centroid (incl. jittery landmark 9) with no smoothing; apply OneEuro to x/y, reset on hand loss, don't add click latency — see [cursor-one-euro.md](cursor-one-euro.md)

- [x] Add numbers, symbols & spacebar to the hand keyboard — mobile-style ?123/ABC layer toggle (letters ⇄ curated symbols), wide spacebar on both layers, physical-keyboard parity — see [keyboard-numbers-symbols.md](keyboard-numbers-symbols.md)

- [~] ~~Near-straight strings at attach — normalize the capture to a reference relaxed-hand pose so the real chains are near-taut (small give) at attach, killing the dead-zone slack; not a render fix — see [attach-slack-taut.md](attach-slack-taut.md)~~ (Rejected on headless evidence: the current build — STRING_SLACK 1.0, chain length = captured chord — ALREADY settles near-taut, chord/nominalLen ≈ 1.000 (min 0.996), even when the control eases from a wide held pose into a bunched "relaxed" pose after attach (the exact mechanism the brief blamed). There is no baked-in physics slack for a reference-pose normalization to remove. A full sweep of the prescribed normalization (0.1–0.6) gave ZERO tautness gain and REGRESSED the protected anti-seizure work — post-release peak part speed 1.6→4.5 u/s, settled 0.14→0.42 u/s, transient spasms 3→29+/60. Shipping it would violate this task's own acceptance criteria ("no seizure regression", "near-taut WITH fix and slack WITHOUT"). Evidence + regression guard: `tools/attach-tautness.ts`. The reported visual slack is not reproducible headlessly — needs a live webcam session on /game and /characters to confirm it still exists (may be a mapping / live-hand-motion effect, or already fixed by the prior migration off the ×1.04/×1.18 loose-rope model) before changing the physics.)

- [x] Redesign the 10 characters to be radically distinct (orientation, limb count, body size, limb length — kill the biped sameness; keep ≥5 cuttable strings) — see [distinct-rigs.md](distinct-rigs.md)

- [x] Control bar can pitch/roll/yaw to match hand orientation (physical via strings, ortho-simulated) — see [control-bar-pitch.md](control-bar-pitch.md)
- [x] Taut center string; loose limb strings as bezier curves — see [loose-string-beziers.md](loose-string-beziers.md)
- [x] Direct hand→cross mapping (2 measured points) + cut control-path latency — see [direct-cross-mapping.md](direct-cross-mapping.md)
- [x] Make the strings heavier (read as chains, not floaty thread) — see [heavier-strings.md](heavier-strings.md)
- [x] Strings collide with the floor, still pass through the puppet — see [strings-hit-floor.md](strings-hit-floor.md)
- [x] Two players from one camera (handedness-correct, no string crossing) — see [two-player-handedness.md](two-player-handedness.md)
- [x] Finger control points can't go below the floor (top/left/right free) — see [clamp-fingers-floor.md](clamp-fingers-floor.md)
- [x] Camera source + quality pickers (persisted sidebar dropdowns) — see [camera-picker.md](camera-picker.md)
- [x] Play-area margin (inset camera→play, overshoot offscreen; sidebar slider, default 10%, all sides) — see [play-area-margin.md](play-area-margin.md)
- [x] Game audio — procedural WebAudio SFX (slice/clash/etc.) + adaptive music (port false-alarms-web) — see [game-audio.md](game-audio.md)
- [x] Fix attach "seizure" — puppet spasms for seconds after strings attach before settling — see [attach-seizure.md](attach-seizure.md)
- [x] Recolor to a duotone (teal + rust) theme — kill the rainbow; per-player team colors — see [color-theme.md](color-theme.md)
- [x] Keep the hand-outline prompts up through ATTACHING (users move too soon when they vanish) — see [prompt-through-attach.md](prompt-through-attach.md)
- [x] Letterbox /game to 16:10 (ref 1280×800) + full readability pass (canvas text in world units) — see [readability-16x10.md](readability-16x10.md)
- [x] Fullscreen button on /game (Fullscreen API toggle, Lucide maximize/minimize icon, corner) — see [fullscreen-button.md](fullscreen-button.md)
- [x] Fit the canvas on mount (no manual resize needed) — ResizeObserver + re-derive puppet quarters — see [fit-on-mount.md](fit-on-mount.md)
- [x] Off-thread hand detection — CLASSIC web worker, async/best-effort (profiled: detection = 24.6ms) — see [hands-web-worker.md](hands-web-worker.md)
