# Camera→screen mapping must preserve the camera's aspect ratio

## Problem

Hand→play coordinate mapping feels wrong when the viewport aspect isn't the tuned ~16:10 landscape.
Repro: desktop browser, open devtools, set the viewport to a portrait mobile size — the camera→screen
mapping goes off and **some finger positions feel impossible to reach**, and left/right vs up/down motion
is no longer proportional.

**Root cause (suspected):** the mapping scales the two axes by unrelated factors, and one of them depends
on the *canvas* aspect while the other is fixed — the *camera's* aspect ratio is never accounted for.

- X: in `Stage.readFingerPositions` (`src/engine.ts`) and `Pilot.feed` (`src/pilot.ts`),
  `x = fx * renderer.worldWidth * swingRange`, where `worldWidth = canvas.width / scale` and
  `scale = canvas.height / WORLD_VIEW_HEIGHT`. So the horizontal scale tracks the **canvas** aspect.
- Y: `y = VERT_CENTER + fy * VERT_SPAN * swingRange` with `VERT_SPAN = WORLD_VIEW_HEIGHT = 12` — a
  **fixed** vertical scale.

The normalized landmark space (`stageX`/`stageY` in `src/control.ts`, ∈ ~[-0.5,0.5]) is a *camera*-shaped
field (e.g. 640×480 = 4:3), but it's stretched non-uniformly onto a canvas-aspect-dependent world. So a
diagonal hand move doesn't produce a proportional diagonal on screen, and the anisotropy gets worse as the
viewport aspect diverges from the camera's — in a tall/narrow (portrait) canvas `worldWidth` shrinks, X
compresses while Y stays 12 units, and parts of the reachable/target space become impossible to hit.

## Expected outcome

A single **uniform** world-units-per-camera-unit scale applied to BOTH axes, derived from the **camera's
aspect ratio**, so relative hand motion (left/right, up/down, diagonal) is proportional on screen **at any
viewport aspect** — landscape desktop and portrait mobile alike. No finger/target position should be
unreachable, and the self-view overlay must agree with where a hand actually maps in play.

## Scope — battle stays 16:10-locked; everything else flexes (per the user)

Only **battle mode (`/game`)** requires the fixed 16:10 aspect. It already **letterboxes the viewport to
16:10** (readability-16x10 work), so its play area is 16:10 regardless of the window — its tuned mapping is
**preserved unchanged** and needs no aspect-correct rescale. All the OTHER scenes — `/pose`, `/characters`,
`/harness`, `/keyboard` — are **flexible**: their canvas takes the viewport's actual aspect (incl. portrait),
so THEY are where the anisotropy bug lives and where the aspect-correct uniform camera scale must apply.

## Fit vs fill (open decision — default: FIT)

Preserving aspect means the camera field and the viewport won't match shape, so one of:
- **FIT (recommended default):** size the uniform scale so the ENTIRE camera field maps inside the play
  area (letterbox — some screen margins have no play mapping). Reachable region == the self-view exactly;
  nothing is unreachable, but you can't drive into the letterboxed edges. Directly fixes "impossible points".
- **FILL:** size the scale so the play area covers the whole viewport (camera's extreme edges crop
  offscreen). Every screen corner is reachable, but outer camera edges overshoot.
Pick in the harness by feel; default to FIT if unsure.

## Acceptance criteria

- On the **flexible** scenes (`/pose`, `/characters`, `/harness`, `/keyboard`), in a portrait viewport
  (devtools mobile) AND landscape desktop, a given hand motion covers a proportional on-screen distance in
  x and y (uniform sensitivity, aspect-correct) — verify by moving a fingertip in a square/circle and
  confirming it isn't stretched into an ellipse. No unreachable finger positions.
- The live hand overlay (`drawHands` self-view) and the play mapping agree on where a hand lands.
- **`/game` is left 16:10-locked and unchanged** — it letterboxes to 16:10 as today; its tuned mapping/feel
  must map **identically** (ideally the code path for battle is untouched).

## Relevant files

- `src/control.ts` — `stageX`/`stageY` (normalized landmark→stage; selfie-mirror + play-margin). Likely
  where the aspect-correct scale should be centralized.
- `src/engine.ts` — `Stage.readFingerPositions` (the `worldWidth`/`VERT_SPAN` asymmetry) + `Renderer`
  `scale`/`worldWidth` derivation.
- `src/pilot.ts` — `Pilot.feed` duplicates the same mapping (used by `/pose`, `/characters`). Keep DRY —
  factor the shared aspect-correct mapping rather than fixing two copies divergently.
- `src/handCursor.ts` — `mapCursor`/`palmCentroid` (the UI-cursor mapping for `/keyboard` and `/pose`
  controls) has the same latent issue; align it.
- `src/hands.ts` — source of the camera dimensions / `QualityTier` (e.g. 480p = 640×480) to get the true
  camera aspect ratio to feed the scale.
- `src/draw.ts` — `drawHands` overlay (already mirrors X); keep it consistent with the new mapping.

## Constraints

- Keep the selfie-mirror, the play-area margin (`playMargin`), and the per-player half-clamp (`clampHalf`).
- DRY: one shared aspect-correct mapping consumed by both `Stage` and `Pilot`.
- Don't touch the tuned 16:10 `/game` mapping — battle stays letterboxed to 16:10 and unchanged; the
  aspect-correct rescale is only for the flexible scenes.
- Verify with a headless/analytic check where possible (compute the mapping for a few viewport aspects and
  assert x/y sensitivity is equal), plus a live webcam pass in a portrait devtools viewport.
