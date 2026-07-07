// Pilot — drives ONE puppet from ONE hand through the full attach ritual (waiting → steadying →
// attaching → running) plus the post-attach "settle ramp" that kills the seizure. This is the same
// ritual `engine.ts` runs per-slot for the two-player game, but factored out for the single-puppet
// `/characters` tryout. NOTE: the game's Stage still has its own copy of this state machine — the two
// intentionally share the logic but not the code YET (Stage is deployed and hand-tuned; duplicating
// here keeps this change from touching it). Unifying Stage onto Pilot is a clean follow-up.
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import { stageX, stageY, stageScale } from "./control.ts";
import type { Landmark } from "./hands.ts";
import {
  FINGERTIPS, FLOOR_TOP, WORLD_VIEW_HEIGHT,
  reposePuppet, attachStringForSlot, detachAllStrings, stillParts, driveStrings,
  setDamping, DEFAULT_ANGULAR_DAMPING, type Puppet,
} from "./puppet.ts";

// ---- finger→world mapping band (mirrors engine.ts) — the per-axis SPAN comes from stageScale so the
// camera aspect is honored (FIT); only the vertical CENTER is fixed here ----
const VERT_CENTER = WORLD_VIEW_HEIGHT / 2;
const POS_MIN_CUTOFF = 5.0;
const POS_BETA = 0.01;

// ---- ritual constants ----
// No hold-still dwell: the moment the hand is present and not moving fast, attaching begins (the attach
// itself is the "hold" — movement during it resets). STEADY_MARGIN gates that "not moving fast" check.
const STEADY_MARGIN = 0.5;
const ATTACH_STRING_MS = 200;
const ATTACH_MARGIN = 0.8;
const GRACE_MS = 500;
const ATTACH_ORDER = [2, 0, 4, 1, 3]; // keystone (middle) first, then hands, then feet
const SETTLE_MS = 700;
const SETTLE_LINEAR_DAMPING = 5;
const SETTLE_ANGULAR_DAMPING = 8;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

// Unity SmoothDamp — velocity-continuous smoothing so a jumping target eases without a whip.
function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, dt: number): [number, number] {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  const newVel = (vel - omega * temp) * exp;
  return [target + (change + temp) * exp, newVel];
}

type Pt = { x: number; y: number };
const copyPts = (dst: Pt[], src: Pt[]): void => { for (let i = 0; i < dst.length; i++) { dst[i].x = src[i].x; dst[i].y = src[i].y; } };
const maxPtDist = (a: Pt[], b: Pt[]): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y); if (d > m) m = d; }
  return m;
};

export type PilotPhase = "waiting" | "attaching" | "running";

// Live tunables the page owns (worldWidth changes on resize) — read every frame.
export interface PilotCfg {
  worldWidth: number;
  cameraAspect: number;       // live camera frame aspect (hands.cameraAspect) → aspect-correct FIT map
  playMargin: number;
  swingRange: number;
  smoothTime: number;
  drag: number;               // post-settle LINEAR damping on the parts (swing/pendulum drag)
  angularDrag?: number;       // post-settle ANGULAR damping (limb wobble/spin); defaults to DEFAULT_ANGULAR_DAMPING
  // Soft goal-drive string tunables (read every frame by driveStrings).
  stiffness: number;
  damping: number;
  forceCap: number;
}

export class Pilot {
  phase: PilotPhase = "waiting";
  present = false;
  readonly pos: Pt[] = FINGERTIPS.map(() => ({ x: 0, y: 0 }));  // live filtered fingertip world positions
  private readonly ctrl: Pt[] = FINGERTIPS.map(() => ({ x: 0, y: 0 }));
  private readonly cvx = FINGERTIPS.map(() => 0);
  private readonly cvy = FINGERTIPS.map(() => 0);
  private primed = false;
  private readonly ffx = FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA));
  private readonly ffy = FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA));

  private steadyAnchor: Pt[] = FINGERTIPS.map(() => ({ x: 0, y: 0 }));
  private captured: Pt[] = FINGERTIPS.map(() => ({ x: 0, y: 0 }));
  private attachTorso: Pt = { x: 0, y: 0 };
  private attachT0 = 0;
  private attached = 0;
  private lastPresentT = -1e9;
  private settleT0 = -1;

  onAttach?: (stringIndex: number) => void;

  constructor(
    private readonly RAPIER: typeof RAPIER_NS,
    private readonly world: RAPIER_NS.World,
    private readonly puppet: Puppet,
    private readonly cfg: PilotCfg,
  ) {}

  // Fraction of the attach complete (drives the prompt bar) — grows as the strings snap on.
  steadyProgress(now: number): number {
    if (this.phase === "attaching") return Math.min(1, (now - this.attachT0) / (ATTACH_ORDER.length * ATTACH_STRING_MS));
    return this.phase === "running" ? 1 : 0;
  }

  // Feed this frame's landmarks (null = hand not detected). Fills `pos` from the puppet's own binding.
  feed(landmarks: Landmark[] | null, now: number): void {
    this.present = !!landmarks;
    if (!landmarks) { this.primed = false; return; }
    // One uniform world-units-per-camera-unit scale for BOTH axes (FIT), derived from the camera's
    // aspect ratio, so a hand move is proportional on screen at any viewport aspect (portrait too).
    const { scaleX, scaleY } = stageScale(this.cfg.worldWidth, WORLD_VIEW_HEIGHT, this.cfg.cameraAspect);
    for (let j = 0; j < FINGERTIPS.length; j++) {
      const lm = landmarks[FINGERTIPS[j]];
      const fx = this.ffx[j].filter(stageX(lm, this.cfg.playMargin), now);
      const fy = this.ffy[j].filter(stageY(lm, this.cfg.playMargin), now);
      this.pos[j].x = fx * scaleX * this.cfg.swingRange;
      this.pos[j].y = Math.max(FLOOR_TOP, VERT_CENTER + fy * scaleY * this.cfg.swingRange);
    }
  }

  update(now: number, dt: number): void {
    const p = this.puppet;
    if (this.present) this.lastPresentT = now;
    const absent = now - this.lastPresentT > GRACE_MS;

    switch (this.phase) {
      case "waiting":
        // No hold-still dwell — the puppet idles at home, and the moment the hand is present AND not
        // moving fast (within STEADY_MARGIN of last frame) we go straight to attaching. A fast-moving
        // hand just re-anchors and keeps waiting; movement DURING the attach resets it (below). So the
        // player only "holds" once — during the attach — instead of a steady-hold and then the attach.
        reposePuppet(p, p.homeTorso);
        if (!this.present) break;
        if (maxPtDist(this.pos, this.steadyAnchor) > STEADY_MARGIN) { copyPts(this.steadyAnchor, this.pos); break; }
        this.beginAttach(now);
        break;

      case "attaching":
        if (absent || (this.present && maxPtDist(this.pos, this.captured) > ATTACH_MARGIN)) { this.reset(); break; }
        reposePuppet(p, this.attachTorso);
        // Drive each attached string's control to the LIVE fingertip (not the frozen capture) so the
        // strings visibly track the moving fingers as they snap on. `captured` stays the reference for
        // the reset-on-move gate above; it no longer pins the controls. nominalLen is still captured at
        // the held pose inside attachStringForSlot, so the anti-seizure handoff force is unchanged.
        for (const s of p.strings) s.control.setNextKinematicTranslation({ x: this.pos[s.slot].x, y: this.pos[s.slot].y, z: 0 });
        {
          const due = Math.min(ATTACH_ORDER.length, Math.floor((now - this.attachT0) / ATTACH_STRING_MS) + 1);
          while (this.attached < due) {
            const sSlot = ATTACH_ORDER[this.attached];
            attachStringForSlot(this.RAPIER, this.world, p, sSlot, this.captured[sSlot], p.binding[sSlot]);
            this.onAttach?.(this.attached);
            this.attached++;
          }
        }
        if (this.attached >= ATTACH_ORDER.length && now - this.attachT0 >= ATTACH_ORDER.length * ATTACH_STRING_MS) {
          stillParts(p); // hand over at rest — strings captured at the held pose carry ~0 force, no spasm
          setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
          this.settleT0 = now;
          this.primed = false;
          this.phase = "running";
        }
        break;

      case "running":
        if (absent) { this.reset(); break; }
        this.applySettle(now);
        if (this.present) { this.smoothControls(dt); this.drive(); }
        driveStrings(p, this.cfg.stiffness, this.cfg.damping, this.cfg.forceCap, dt); // the capped goal force
        break;
    }
  }

  private smoothControls(dt: number): void {
    for (let j = 0; j < FINGERTIPS.length; j++) {
      if (!this.primed) { this.ctrl[j].x = this.pos[j].x; this.ctrl[j].y = this.pos[j].y; this.cvx[j] = 0; this.cvy[j] = 0; }
      else {
        [this.ctrl[j].x, this.cvx[j]] = smoothDamp(this.ctrl[j].x, this.pos[j].x, this.cvx[j], this.cfg.smoothTime, dt);
        [this.ctrl[j].y, this.cvy[j]] = smoothDamp(this.ctrl[j].y, this.pos[j].y, this.cvy[j], this.cfg.smoothTime, dt);
      }
    }
    this.primed = true;
  }

  private drive(): void {
    for (const s of this.puppet.strings) {
      const c = this.ctrl[s.slot];
      s.control.setNextKinematicTranslation({ x: c.x, y: c.y, z: 0 });
    }
  }

  private beginAttach(now: number): void {
    const p = this.puppet;
    copyPts(this.captured, this.pos);
    this.attachT0 = now;
    this.attached = 0;
    this.settleT0 = -1;
    // Center the KEYSTONE part (whatever the middle finger, slot 2, drives) under that fingertip so its
    // string hangs straight and the rest fan evenly — works for any rig (root need not be "torso").
    const keystoneTarget = p.binding[2].target;
    const keyPart = p.parts.find((pt) => pt.body === p.partByTarget[keystoneTarget]);
    const rootX = this.captured[2].x - (keyPart ? keyPart.neutral.x : 0);
    this.attachTorso = { x: rootX, y: p.homeTorso.y };
    reposePuppet(p, this.attachTorso);
    this.phase = "attaching";
  }

  private applySettle(now: number): void {
    if (this.settleT0 < 0) return;
    const angDrag = this.cfg.angularDrag ?? DEFAULT_ANGULAR_DAMPING;
    const t = (now - this.settleT0) / SETTLE_MS;
    if (t >= 1) {
      setDamping(this.puppet, this.cfg.drag, angDrag);
      this.settleT0 = -1;
      return;
    }
    const k = easeOut(1 - t);
    setDamping(
      this.puppet,
      this.cfg.drag + (SETTLE_LINEAR_DAMPING - this.cfg.drag) * k,
      angDrag + (SETTLE_ANGULAR_DAMPING - angDrag) * k,
    );
  }

  // Cut all strings and return to the waiting/prompt state at the neutral home pose.
  reset(): void {
    detachAllStrings(this.puppet);
    reposePuppet(this.puppet, this.puppet.homeTorso);
    setDamping(this.puppet, this.cfg.drag, this.cfg.angularDrag ?? DEFAULT_ANGULAR_DAMPING);
    this.phase = "waiting";
    this.attached = 0;
    this.settleT0 = -1;
    this.primed = false;
  }
}
