# Puppet Roster — 10 Rigs

Design doc. Ten distinct, exaggerated marionette fighters across genres (Tekken-flavored
+ three animals). Each is a **bespoke body** driven by the **same 5 finger-strings** the engine
already gives us. Concepts only — no code yet. Mark this up and we'll build from it.

---

## The rig contract (what every puppet must obey)

Grounded in `src/puppet.ts` as it stands today, so these are buildable, not fantasy:

- **Parts** are capsules: `{ halfLength, radius, density, color }`, 2.5D plane-locked (x/y move,
  z-rotation only), CCD on. A "limb" can be **one capsule or a chain of capsules** (telescoping
  mech arm, insect leg, robe hem) joined by spherical joints — the engine already does arbitrary
  chains.
- **Internal joints** are spherical impulse joints with body-local anchors (`spherical()`), same
  as the current torso→limb hinges. Some are marked **cuttable** (sever mid-fight → the piece
  falls off in two halves, like the strings already do via `cutStringAtSeg`).
- **Exactly 5 external strings.** The five fingertips are the control points, in a **fixed slot
  order**: `0 thumb · 1 index · 2 middle · 3 ring · 4 pinky`. Each rig maps its 5 slots to 5 anchor
  points on its body (`FingerBind → target part + body-local anchor`).
- **The middle finger (slot 2) is the keystone.** It carries the longest center string and today
  drives the head/torso — the load-bearing line. Keeping middle=keystone across rigs means the
  same muscle memory (middle finger = "hold the body up") transfers between characters. A couple
  of rigs deliberately break this for flavor (Inversa, Ursine) — called out where they do.
- **Handedness mirror.** Symmetric rigs get their off-hand binding for free via `mirrorBinding()`.
  Asymmetric rigs (Nightshade's scarf, the animals) need an explicit L/R map — noted per rig.

### Stat axes (for balance / Tekken-style archetypes)

| Axis | Driven by | Meaning |
|---|---|---|
| **WEIGHT** | part density × size | how hard it is to shove / how much string tension |
| **REACH** | limb chain length | how far its slicing limb sweeps |
| **STABILITY** | CG height + base width | how many strings it can lose before it topples |
| **SPEED** | inverse of weight + string count on light limbs | how snappy it follows the hand |
| **KEYSTONE** | which cut = instant collapse | the string an opponent races to sever |

Archetypes used below: **Grappler** (heavy, short reach, brutal), **Rushdown** (light, fast, fragile),
**Zoner** (long reach, keeps distance), **Tank** (won't fall), **Technical** (weird control, high skill).

---

## The 10

### 1. THE JACKHAMMER — *pro wrestling* · Grappler
Barrel-chested luchador. **Cinderblock fists** on medium arms, a keg torso, stubby tree-trunk legs.
Top-and-front-heavy: the mass lives in the fists.

- **Parts:** huge torso (r≈0.35, dense), oversized fist-capsules on each arm (short thick), stubby legs.
- **Joints:** torso→arm, torso→leg (all standard). Fists are part of the arm capsule (not cuttable off).
- **Strings:** `2 middle→torso` (keystone) · `0 thumb→L.fist` `4 pinky→R.fist` (the wrecking balls) ·
  `1 index→L.leg` `3 ring→R.leg`.
- **Feel:** the heavy fists swing like wrecking balls on their strings — enormous clobbering slices,
  but sluggish to aim. Grab-and-slam energy.
- **Keystone / weakness:** cut an **arm** string and a dead-weight fist drops — massive power loss,
  and the sudden imbalance can topple him. High WEIGHT, low SPEED, mid STABILITY.

### 2. THE IRON FIST — *traditional karate* · Zoner
Lean, tall, ramrod-straight. **Long thin limbs**, small tight head, balanced mass. The "default hero"
but stretched and precise.

- **Parts:** tall slim torso, long thin arms + legs (the longest simple limbs in the roster).
- **Joints:** standard 4-limb hinges.
- **Strings:** the classic binding — `2 middle→torso` · `0 thumb→L.arm` `4 pinky→R.arm` ·
  `1 index→L.leg` `3 ring→R.leg`.
- **Feel:** **reach.** Longest arms/legs → can slice an opponent's strings from across the arena
  before they close. Clean, readable, fast to aim.
- **Keystone / weakness:** balanced (no single fragile string), but **light** — easy to shove off
  balance and topple once a limb string is gone. High REACH + SPEED, low WEIGHT.

### 3. NIGHTSHADE — *ninja / assassin* · Technical
**Asymmetric.** One real arm; the other side is a long **trailing scarf** — a whip-thin multi-segment
appendage instead of a second arm. Whip-thin body, low profile.

- **Parts:** slim torso, one thin arm, a **scarf = 4-capsule chain** (light, floppy), two thin legs.
- **Joints:** torso→arm, torso→scarf-root, then scarf link chain (all spherical); torso→legs.
- **Strings:** `2 middle→torso` · `0 thumb→arm` · `4 pinky→scarf tip` (whip control) ·
  `1 index→L.leg` `3 ring→R.leg`. **Needs an explicit L/R binding** (asymmetric).
- **Feel:** the scarf is a **whip** — extra reach, hard for an opponent to grab, snaps across to
  slice. Slack the pinky and the scarf goes limp/low → the puppet reads as a thin sliver (stealthy).
- **Keystone / weakness:** the scarf tip string is the whole gimmick — cut it and Nightshade loses
  its range weapon and becomes a one-armed stub. High skill to whip well.

### 4. THE FURNACE — *mech / sci-fi* · Tank
Boxy plated automaton. **Telescoping arms** built from two capsules each (upper + fore), heavy plate
torso, blocky legs. Slowest, heaviest thing in the roster.

- **Parts:** big box torso (very dense), each arm = **2-capsule chain** (shoulder→elbow→hand),
  blocky legs.
- **Joints:** torso→upperArm→foreArm (elbow is **cuttable** — sever it and the forearm clangs off
  in two pieces), torso→legs.
- **Strings:** `2 middle→torso` · `0 thumb→L.foreArm` `4 pinky→R.foreArm` (drives the whole
  telescoping arm) · `1 index→L.leg` `3 ring→R.leg`.
- **Feel:** heaviest puppet — huge inertia, slow to follow the hand, but the arms carry crushing
  momentum. Runs its strings under high tension (heavy parts pull hard).
- **Keystone / weakness:** high tension = a cut is **catastrophic** — losing the torso string drops
  a very heavy body straight to the floor. Max WEIGHT, min SPEED, high STABILITY until it isn't.

### 5. INVERSA — *capoeira / breaker* · Technical (inverted control)
Acrobat that fights **upside-down**. The **legs are the heavy weapons up top**; light arms below.
Breaks the middle=torso convention on purpose.

- **Parts:** compact torso, **powerful thick legs** (the mass), light thin arms.
- **Joints:** standard, but proportions inverted (legs heavier than arms).
- **Strings (inverted):** `2 middle→hips/torso` (still keystone, but low) · `1 index→L.leg`
  `3 ring→R.leg` carry the **heavy kicking legs up high** · `0 thumb→L.arm` `4 pinky→R.arm` are the
  light "hands" that plant on the ground. Naturally hangs into handstands/cartwheels.
- **Feel:** the weapon is the **kick** — the leg strings sweep big arcs overhead. Fights inverted, so
  its hitboxes come from unexpected angles. High skill: your fingers do the opposite of every other
  puppet.
- **Keystone / weakness:** cut a **leg** string here (not an arm) to disarm it — the legs are the
  offense. Confusing to pilot, rewarding when mastered.

### 6. THE MOUNTAIN — *sumo* · Tank
A **wall.** Enormous low belly (a huge, moderate-density torso), tiny head, thick stubby limbs,
center of mass almost on the floor. Nearly impossible to topple.

- **Parts:** gigantic wide low torso (biggest single part), tiny head nub, short thick arms + legs.
- **Joints:** standard, short.
- **Strings:** `2 middle→torso` · `0 thumb→L.arm` `4 pinky→R.arm` · `1 index→L.leg` `3 ring→R.leg`.
- **Feel:** immovable — soaks shoves, holds the center opening in the wall, slaps with heavy short
  arms. The defensive anchor of the roster.
- **Keystone / weakness:** so low-CG it **stays standing even after losing strings** — you have to
  strip it down and out-position it rather than topple it. Max STABILITY + WEIGHT, min REACH + SPEED.
  Watch balance: may need a tuning nerf so it isn't oppressive.

### 7. THE WIDOW — *occult / mystic* · Zoner
Ethereal sorceress. Instead of legs, a wide **robe skirt** — a fan of hanging chain "hem" segments —
that drapes and sweeps. Low density → she **drifts** rather than falls.

- **Parts:** slim torso, thin long arms, and a **skirt = 3–5 light hem capsules** fanned below the
  torso (no legs).
- **Joints:** torso→arms, torso→each hem strand (spherical fan).
- **Strings:** `2 middle→torso` · `0 thumb→L.arm` `4 pinky→R.arm` · `1 index→skirt-left-hem`
  `3 ring→skirt-right-hem` (sweep the robe). **Explicit binding** (no legs).
- **Feel:** floaty and hard to read — the low-density body hangs and drifts; the skirt hem can
  **drape over an opponent's strings** and foul their control. A zoner that controls space with cloth.
- **Keystone / weakness:** light and floaty means it's **easy to knock around** once the torso
  string is threatened; the skirt is defense/utility, not a topple risk.

### 8. THE JOEY — *boxing kangaroo (animal)* · Rushdown
Marsupial brawler. **Massive muscular hind legs + a thick heavy tail** used as a tripod counterweight;
tiny boxing-glove arms up front; forward-leaning torso. Springy.

- **Parts:** forward-leaning torso, two **big dense hind legs**, a **heavy tail** (2-capsule chain),
  small glove arms (short).
- **Joints:** torso→hind legs, torso→tail-root→tail-tip, torso→arms.
- **Strings (5th appendage = tail):** `2 middle→torso` · `1 index→L.hindleg` `3 ring→R.hindleg`
  (the kick power) · `0 thumb→tail` (the stabilizing tripod) · `4 pinky→both glove arms` (a light
  jab bar, or just the dominant glove). **Explicit binding.**
- **Feel:** the tail-tripod makes it **stable AND springy** — it plants on legs+tail then launches
  big kick-slashes; the gloves patter quick jabs. Aggressive, mobile.
- **Keystone / weakness:** cut the **tail** and the tripod collapses — it loses its stable base and
  its kicks send it tumbling. A fun non-torso keystone.

### 9. THE URSINE — *bear (animal)* · Grappler / Tank
**Quadruped.** Big round torso, big head, four stubby legs, no upright arms. Heavy, wide, low —
fights on all fours and charges. Breaks middle=torso: here **middle drives the head**.

- **Parts:** big round torso, big head, four short thick legs (front pair + hind pair).
- **Joints:** head→torso, torso→each of 4 legs; **head is the anchor** (front of the body).
- **Strings:** `2 middle→head` (keystone, front) · `0 thumb→L.frontpaw` `4 pinky→R.frontpaw` ·
  `1 index→L.hindpaw` `3 ring→R.hindpaw`. The torso hangs off head+paws. **Explicit binding.**
- **Feel:** a **quadruped tank** — four contact points make it very hard to flip; it lumbers and
  body-checks. Distinct silhouette: no arms, pure beast.
- **Keystone / weakness:** cut the **head** string and the front end drops and plows into the floor;
  otherwise you must strip multiple paws to fell it. Max STABILITY, low SPEED.

### 10. THE REAPER — *praying mantis (animal / insect)* · Zoner
Tall, creepy, alien. Thin thorax, small head, and **two raptorial scythe forearms** — bladed limbs
that are *thematically the best at cutting strings.* Spindly multi-jointed legs. Top-heavy, unstable.

- **Parts:** tall thin thorax, small head, two **scythe arms** (each a 2-capsule bent blade), two
  **spindly legs** (2-capsule chains); front two legs rigid to the thorax for a stance.
- **Joints:** thorax→head, thorax→scythe-upper→scythe-blade (the blade capsule is the cutter),
  thorax→leg chains.
- **Strings:** `2 middle→thorax` (keystone) · `0 thumb→L.scythe-blade` `4 pinky→R.scythe-blade`
  (the weapons) · `1 index→L.leg` `3 ring→R.leg`. **Explicit binding.**
- **Feel:** the scythes are **the definitive slicing tool** — long bent blades that hook and sever
  strings better than any fist. But it's tall and top-heavy: easy to overbalance and topple. Glass
  cannon zoner.
- **Keystone / weakness:** losing a **scythe** string neuters its offense; and its high CG means one
  bad swing overbalances it into the floor. High REACH, low STABILITY.

---

## Roster at a glance

| # | Name | Genre | Archetype | Distinct silhouette | 5th-string twist | Keystone cut |
|---|---|---|---|---|---|---|
| 1 | Jackhammer | pro wrestling | Grappler | barrel + wrecking-ball fists | — | arm (dead fist) |
| 2 | Iron Fist | karate | Zoner | lean, long-limbed | — | (balanced) |
| 3 | Nightshade | ninja | Technical | one arm + whip scarf | scarf whip | scarf |
| 4 | Furnace | mech | Tank | boxy, telescoping arms | cuttable elbows | torso |
| 5 | Inversa | capoeira | Technical | inverted, legs-up | control flipped | leg |
| 6 | Mountain | sumo | Tank | low wall / belly | — | (won't topple) |
| 7 | Widow | mystic | Zoner | robe skirt, no legs | cloth hem fan | torso |
| 8 | Joey | kangaroo | Rushdown | tail tripod + hind legs | tail as 5th limb | tail |
| 9 | Ursine | bear | Grappler | quadruped, no arms | middle→head | head |
| 10 | Reaper | mantis | Zoner | tall, scythe blades | bladed cutters | scythe |

Spread check: 7 genres across humans (wrestling, karate, ninja, mech, capoeira, sumo, mystic) + 3
animals (kangaroo, bear, mantis). Ten distinct silhouettes, ten distinct mass distributions, and a
mix of keystone locations so opponents can't rely on one "cut the middle" strategy.

---

## What we'd generalize in code to ship these

The current `addPuppet()` hardcodes one humanoid. To make rigs data-driven (minimal, additive):

1. **`TargetName` → arbitrary part ids per rig.** Today it's a fixed union
   (`torso|lArm|rArm|lLeg|rLeg`). Make it a `string` id space defined by each rig. `partByTarget`
   becomes `Record<string, RigidBody>`.
2. **A `RigDef` describing parts, joints, and binding:**
   ```ts
   interface PartDef  { id: string; x: number; y: number; half: number; rad: number;
                        density: number; color: string; }
   interface JointDef { a: string; aAnchor: Vec2; b: string; bAnchor: Vec2; cuttable?: boolean; }
   interface RigDef   { name: string; parts: PartDef[]; joints: JointDef[];
                        binding: FingerBind[]; /* targets part ids */ mirror?: FingerBind[]; }
   ```
   `buildRig(RAPIER, world, xOffset, def)` replaces the hardcoded torso/arm/leg block; everything
   downstream (controls, strings, attach ritual, cut, neutral pose) already keys off `parts` +
   `partByTarget` + `binding`, so it carries over unchanged.
3. **Multi-segment limbs** are just extra parts + extra `JointDef`s — no new engine capability.
4. **Cuttable internal joints** (Furnace elbow) — one small helper: `severInternalJoint()`
   mirroring `cutStringAtSeg` but on a body joint.
5. **Asymmetric bindings** (Nightshade, animals) provide an explicit `mirror` binding instead of
   the auto `mirrorBinding()`.
6. **Balance stats** (`{ weight, reach, stability, speed }`) can ride on `RigDef` for tuning +
   a character-select screen later.

Nothing here changes the 5-finger control model, the attach ritual, the cut mechanic, the wall, or
the match FSM — it's all additive.

## Suggested build order (when you say go)

1. Land the `RigDef` refactor by re-expressing **today's humanoid** as data (proves the schema,
   zero visible change) — call it **Iron Fist (#2)** since it *is* the current rig, stretched.
2. Add **Jackhammer (#1)** and **Mountain (#6)** next — same topology, only proportions/mass differ.
   Cheap, and they prove WEIGHT/STABILITY read differently in a fight.
3. Then the topology-changers: **Furnace (#4, chained arms + cuttable elbow)**, **Joey (#8, tail)**,
   **Ursine (#9, quadruped)**, **Reaper (#10, scythes)**.
4. Finish with the control/utility oddballs: **Nightshade (#3, whip)**, **Inversa (#5, inverted)**,
   **Widow (#7, skirt)**.
5. Character-select screen (reuse the hand-input picker) once ≥3 rigs exist.
