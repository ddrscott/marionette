# Anatomically-correct pose targets + lower leg sockets

## Problem
On `/pose`, a target silhouette can place a limb (the legs especially) where the real puppet's
limb can NEVER reach, so the pose is unmatchable ("the leg is not attached to the correct
location; the puppet can never match the space"). The silhouette is built from free per-part
CENTER offsets that ignore the puppet's real joint (socket) geometry, so a silhouette limb floats
detached from where the actual limb roots on the torso.

Root cause (pose.ts):
- `BUILTINS` are hand-authored per-part CENTER offsets from the root; `builtinPose` turns each into
  a node `{x,y,angle}` where `angle = radialAngle(offset)` — the limb's DIRECTION is derived from
  its center offset, but nothing ties the limb's SOCKET END to the torso's socket point.
- `silParts()` (pose.ts ~182) draws silhouette part i straight at the node `{x,y,angle}` with the
  puppet's real `half`/`rad` (enlarged). So if an authored center + angle implies a socket-end that
  isn't at the torso socket, the outline limb is anatomically wrong and physically unreachable.

The real rig (addPuppet): a limb hangs from a spherical joint — torso-local socket anchor ↔
limb-local anchor near the limb's top. Current anchors:
- arms: torso `(±0.3, +0.3)` ↔ arm-local `(0, +0.4)`, arm half 0.4
- legs: torso `(±0.15, -0.5)` ↔ leg-local `(0, +0.45)`, leg half 0.45
A real limb can only ROTATE about its socket; its socket end is pinned. The target must respect that.

## Two changes

### 1. Make pose targets anatomically anchored (reachable by construction)
Redefine poses so each limb is placed by its socket, not a free center:
- A pose = torso node (position + rotation) + a per-limb ANGLE (the direction the limb points from
  its socket). (The existing `rot` whole-figure turn still applies on top.)
- `silParts()` computes each limb's center so its LIMB-LOCAL socket anchor lands exactly on the
  torso's SOCKET WORLD point for that limb, then extends the capsule outward along the limb angle:
  `center = socketWorld − R(limbAngle)·(limbLocalAnchor)`, `node.angle = limbAngle`.
- Use the rig's REAL socket anchors + limb-local anchors + half-lengths (read from the puppet, or a
  single shared source) so the outline is always anatomically consistent with THIS puppet — if the
  rig changes, the targets follow. Don't hardcode a second copy that can drift.
Result: every target limb roots where the real limb roots, so the puppet can always reach it
(subject only to marionette physics, which the earlier calm-tuning already helps).
- Re-express STAR / CHEER / KICK / SIDE-L / SIDE-R / LEAN / TUMBLE in the new angle form so they
  look the same but are now reachable. Keep the `C` capture flow working (captured poses read the
  real transforms, so they're already anatomical — just make BUILTINS match that standard).

### 2. Attach humanoid legs slightly lower
In `addPuppet` (puppet.ts ~319-322) the leg spherical joints socket at torso-local `y: -0.5` (the
torso bottom). Lower them a touch (e.g. `y: -0.6`) so the legs hang from lower on the body, and
adjust the legs' initial `torsoCY - 0.95` spawn so the joint rest length stays consistent (no
pre-stretched joint at spawn). Humanoid rig (`addPuppet`) only — the `buildRig` roster keeps its
per-rig anchors.

## Acceptance criteria
- On `/pose`, EVERY built-in pose's outline is anatomically consistent with the puppet: each limb's
  socket end coincides with the puppet's actual socket, so the silhouette reads as the same body and
  the puppet can physically nestle into it (legs land where legs can go — the reported bug is gone).
- Humanoid legs visibly attach slightly lower on the torso than before.
- Pose-match still works (position + optional orientation tolerance; N/C/[/]/A/R hotkeys).
- Rotated poses (SIDE-L/R, LEAN, TUMBLE) stay anatomically correct after the rework.
- `npm run build` clean; `tools/soft-string.ts` guard still PASS (UPDATE its hardcoded `SOCKETS`
  leg anchor from `y:-0.50` to the new value so the rip/seizure metric stays valid).

## Relevant files
- `src/pose.ts` — `BUILTINS`, `builtinPose`, `silParts` (~182), `PLACE`, `radialAngle`.
- `src/draw.ts` — `PoseSilPart` shape + how the silhouette capsules are drawn.
- `src/puppet.ts` — `addPuppet` leg sockets (~319-322) and arm/leg socket + limb-local anchors;
  consider exposing per-limb socket anchors so pose.ts can read them (single source of truth).
- `tools/soft-string.ts` — `SOCKETS` constant (hardcodes the leg torso-anchor `y:-0.50`); update if
  the leg socket moves.

## Constraints
- Strings stay force-driven; don't touch the soft-string goal-drive, collision groups, or the
  attach ritual beyond what's needed.
- Don't regress the anti-seizure behavior (re-run the guard after moving the leg socket).
- `/characters` roster rigs (`buildRig`) are out of scope for the leg-lower change (per-rig data).
