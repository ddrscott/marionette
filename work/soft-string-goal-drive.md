# Soft goal-drive strings (capped-force) — parts can never be pulled off the puppet

## Problem

Under the current rig, marionette limbs can be **yanked out of their sockets and flail**. Repro: attach
with the fingers held in a *tight radius* around the puppet (so the strings are captured short), then open
the hand wide — the strings violently rip the limbs off the body and flail them around unrealistically.

**Root cause:** each string couples the fingertip to the limb through a chain of **rigid** links plus a
hard `JointData.rope` max-distance joint (`attachStringForSlot` in `src/puppet.ts`). A rigid joint delivers
*whatever force it takes* to satisfy its constraint — unbounded — so a far/fast fingertip hands the limb an
unlimited pull. The limb then tears at its weakest hard joint: the internal spherical (ball) joint pinning
it to the torso. Flipping *which* end is rigid does NOT help — any fully-rigid rope transmits an unbounded
yank. For the pull to be safe, the coupling itself must be **force-limited**.

## Approach — Option A (decided with the user)

Replace the rigid finger→limb coupling with a **capped, damped spring force** that drags the limb toward
the fingertip GOAL:

- The fingertip is a **goal point**, not a rigid pin. Each frame, apply a force to the limb (or the string
  top that carries it) toward the goal: `F = clamp( k*(goal - pos) - c*vel , Fcap )`.
- Because the force is **capped below the strength of the body's internal ball joints** (which stay hard),
  the limb can *never* be pulled out of its socket — parts stay welded to the puppet, guaranteed.
- The string is **drawn** as a light line/catenary from the fingertip to the limb (it "points at the
  fingertip" every frame), replacing the heavy 20-link physics chain as the load path.

The user explicitly accepted the trade: the **heavy drapey physics-rope look goes away** in exchange for a
rock-solid no-rip feel. The old model (rigid chain + parallel rope joint) is what's being replaced.

### Why not the alternatives
- *"Flip the rope to disconnect the finger joint instead of the puppet joint"* — doesn't work: the rigid
  chain is itself the rigid finger→limb link, so any rigid rope rips regardless of which end is pinned.
- *Stretchy/compliant chain (Option B)* — keeps a rope-ish drape but reintroduces the springy rubberband/
  jitter that the rigid rope joint was specifically added to kill (`rope-joint-tension.md`). Rejected.

## Scope

**Everywhere** — the shared rig, so `/game`, `/characters`, `/harness`, and `/pose` all use soft goal-drive.
The two drive paths that must both change: `Stage` in `src/engine.ts` (game/harness) and `Pilot` in
`src/pilot.ts` (characters/pose). They intentionally duplicate the attach/drive logic today.

## Acceptance criteria

- Attaching with fingers in a tight radius and then opening the hand wide **never** pulls a limb off the
  body — limbs follow the fingertips smoothly and lag gently at the force cap instead of tearing loose.
- A limb's max displacement from its torso socket stays **bounded** under an extreme/fast fingertip move
  (verify headlessly — see below), whereas the current rigid model lets it blow past.
- The string still visually originates at the fingertip and points toward it each frame.
- Spring stiffness / damping / force-cap are exposed as **live harness sliders** (`/harness`) for tuning,
  following the existing slider pattern (`wireSliders` in `src/harness.ts` + `harness/index.html`).
- No regression to the attach ritual or the anti-seizure work: bringing a puppet alive still settles
  cleanly (no spasm) — re-check with `tools/attach-stability.ts` / `tools/attach-seizure` metrics.

## Relevant files

- `src/puppet.ts` — `attachStringForSlot`, `buildChain`, `PuppetString`, the `JointData.rope` joint,
  `severRope`, `cutStringAtSeg`/`cutAllIntact`/`detachAllStrings`/`detachString`. This is where the string
  model changes (drop/rework the rigid chain + rope joint; add the capped-spring drive helper).
- `src/engine.ts` — `Stage.drivePuppet` / the rAF loop (apply the goal force per string each frame) + new
  tunables (stiffness/damping/cap) with setters/getters mirroring `setWeight`/`setDrag`.
- `src/pilot.ts` — `Pilot.drive` / `update` running branch (same per-frame goal force).
- `src/draw.ts` — `Renderer.drawPuppet` string rendering (draw the string as a light line/catenary
  fingertip→limb; the physics chain may no longer exist to trace).
- `src/harness.ts` + `harness/index.html` — add the tuning sliders.

## Constraints / invariants to preserve

- **Cut/detach paths still work.** Cutting the head/keystone string and cutting a weapon-arm string
  (`src/cut.ts`) must still release/disarm correctly. Whatever replaces the rope joint must be torn down on
  every cut/detach path (the current load-bearing rule: a "cut" string that keeps its hold still suspends
  the part — see `severRope` and the extensive comments in `puppet.ts`).
- **Weapons ride on the limb bodies** (`armPuppet` compound colliders) — unaffected, but confirm mass
  changes (armed limbs are ~8× heavier) don't need a higher force cap to hold up.
- **Attach ritual + settle ramp** (`ATTACH_ORDER`, `stillStrings`, `SETTLE_*`) must still bring puppets
  alive without a seizure.
- Keep it **DRY** across `engine.ts` and `pilot.ts` — factor the per-frame goal force into one shared
  helper in `puppet.ts` rather than duplicating the math.

## Verification

- **Headless (primary):** add a `tools/soft-string.ts` (mirror `tools/rope-joint.ts`) that attaches a
  puppet, drives a fingertip goal far/fast, and asserts each limb's distance from its torso socket stays
  under a bound (and compares against the old rigid build ripping past it). Run via the esbuild+node line
  in the tool header.
- **Harness:** dial stiffness/damping/cap live; confirm limbs follow without ripping and the puppet holds
  itself up (doesn't sag to the floor) at the chosen cap.
- **Feel (needs webcam):** `/pose` and `/game` — tight-radius attach then open the hand; limbs must drag,
  not tear off.
