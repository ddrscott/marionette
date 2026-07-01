// Pilot — drives ONE puppet from ONE hand through the full attach ritual (waiting → steadying →
// attaching → running) plus the post-attach "settle ramp" that kills the seizure. This is the same
// ritual `engine.ts` runs per-slot for the two-player game, but factored out for the single-puppet
// `/characters` tryout. NOTE: the game's Stage still has its own copy of this state machine — the two
// intentionally share the logic but not the code YET (Stage is deployed and hand-tuned; duplicating
// here keeps this change from touching it). Unifying Stage onto Pilot is a clean follow-up.
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import { stageX, stageY } from "./control.ts";
import type { Landmark } from "./hands.ts";
import {
  FINGERTIPS, FLOOR_TOP, WORLD_VIEW_HEIGHT,
  reposePuppet, attachStringForSlot, detachAllStrings, stillStrings, stillParts,
  setDamping, setStringFriction, DEFAULT_ANGULAR_DAMPING, type Puppet,
} from "./puppet.ts";

// ---- finger→world mapping band (mirrors engine.ts) ----
const VERT_CENTER = WORLD_VIEW_HEIGHT / 2;
const VERT_SPAN = WORLD_VIEW_HEIGHT;
const POS_MIN_CUTOFF = 5.0;
const POS_BETA = 0.01;

// ---- ritual constants (mirror engine.ts so the tryout feels identical to the game) ----
const HOLD_MS = 700;
const STEADY_MARGIN = 0.5;
const ATTACH_STRING_MS = 200;
const ATTACH_MARGIN = 0.8;
const GRACE_MS = 500;
const ATTACH_ORDER = [2, 0, 4, 1, 3]; // keystone (middle) first, then hands, then feet
const SETTLE_MS = 700;
const SETTLE_LINEAR_DAMPING = 5;
const SETTLE_ANGULAR_DAMPING = 8;
const SETTLE_FRICTION = 40;
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

export type PilotPhase = "waiting" | "steadying" | "attaching" | "running";

// Live tunables the page owns (worldWidth changes on resize) — read every frame.
export interface PilotCfg {
  worldWidth: number;
  playMargin: number;
  swingRange: number;
  smoothTime: number;
  drag: number;
  friction: number;
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
  private steadyT0 = 0;
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

  // Fraction of the hold complete (drives the prompt bar). 1 while strings are snapping on.
  steadyProgress(now: number): number {
    if (this.phase === "steadying") return Math.min(1, (now - this.steadyT0) / HOLD_MS);
    return this.phase === "attaching" ? 1 : 0;
  }

  // Feed this frame's landmarks (null = hand not detected). Fills `pos` from the puppet's own binding.
  feed(landmarks: Landmark[] | null, now: number): void {
    this.present = !!landmarks;
    if (!landmarks) { this.primed = false; return; }
    for (let j = 0; j < FINGERTIPS.length; j++) {
      const lm = landmarks[FINGERTIPS[j]];
      const fx = this.ffx[j].filter(stageX(lm, this.cfg.playMargin), now);
      const fy = this.ffy[j].filter(stageY(lm, this.cfg.playMargin), now);
      this.pos[j].x = fx * this.cfg.worldWidth * this.cfg.swingRange;
      this.pos[j].y = Math.max(FLOOR_TOP, VERT_CENTER + fy * VERT_SPAN * this.cfg.swingRange);
    }
  }

  update(now: number, dt: number): void {
    const p = this.puppet;
    if (this.present) this.lastPresentT = now;
    const absent = now - this.lastPresentT > GRACE_MS;

    switch (this.phase) {
      case "waiting":
        reposePuppet(p, p.homeTorso);
        if (this.present) { copyPts(this.steadyAnchor, this.pos); this.steadyT0 = now; this.phase = "steadying"; }
        break;

      case "steadying":
        reposePuppet(p, p.homeTorso);
        if (absent) { this.phase = "waiting"; break; }
        if (!this.present) break;
        if (maxPtDist(this.pos, this.steadyAnchor) > STEADY_MARGIN) { copyPts(this.steadyAnchor, this.pos); this.steadyT0 = now; }
        else if (now - this.steadyT0 >= HOLD_MS) this.beginAttach(now);
        break;

      case "attaching":
        if (absent || (this.present && maxPtDist(this.pos, this.captured) > ATTACH_MARGIN)) { this.reset(); break; }
        reposePuppet(p, this.attachTorso);
        for (const s of p.strings) s.control.setNextKinematicTranslation({ x: this.captured[s.slot].x, y: this.captured[s.slot].y, z: 0 });
        {
          const due = Math.min(ATTACH_ORDER.length, Math.floor((now - this.attachT0) / ATTACH_STRING_MS) + 1);
          while (this.attached < due) {
            const sSlot = ATTACH_ORDER[this.attached];
            attachStringForSlot(this.RAPIER, this.world, p, sSlot, this.captured[sSlot], p.binding[sSlot]);
            this.onAttach?.(this.attached);
            this.attached++;
          }
        }
        stillStrings(p); // calm the chains each frame so they don't build swing energy while pinned
        if (this.attached >= ATTACH_ORDER.length && now - this.attachT0 >= ATTACH_ORDER.length * ATTACH_STRING_MS) {
          stillParts(p);
          stillStrings(p);
          setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
          setStringFriction(p, SETTLE_FRICTION);
          this.settleT0 = now;
          this.primed = false;
          this.phase = "running";
        }
        break;

      case "running":
        if (absent) { this.reset(); break; }
        this.applySettle(now);
        if (this.present) { this.smoothControls(dt); this.drive(); }
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
    const t = (now - this.settleT0) / SETTLE_MS;
    if (t >= 1) {
      setDamping(this.puppet, this.cfg.drag, DEFAULT_ANGULAR_DAMPING);
      setStringFriction(this.puppet, this.cfg.friction);
      this.settleT0 = -1;
      return;
    }
    const k = easeOut(1 - t);
    setDamping(
      this.puppet,
      this.cfg.drag + (SETTLE_LINEAR_DAMPING - this.cfg.drag) * k,
      DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k,
    );
    setStringFriction(this.puppet, this.cfg.friction + (SETTLE_FRICTION - this.cfg.friction) * k);
  }

  // Cut all strings and return to the waiting/prompt state at the neutral home pose.
  reset(): void {
    detachAllStrings(this.world, this.puppet);
    reposePuppet(this.puppet, this.puppet.homeTorso);
    setDamping(this.puppet, this.cfg.drag, DEFAULT_ANGULAR_DAMPING);
    this.phase = "waiting";
    this.attached = 0;
    this.settleT0 = -1;
    this.primed = false;
  }
}
