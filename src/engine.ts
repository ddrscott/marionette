// The shared marionette engine. Owns the Rapier world, the two puppets, the renderer, hand
// detection, the per-puppet attach-ritual state machine, and the render/physics loop. Pages
// (`/harness`, `/game`) compose this rather than duplicating it: they create a `Stage`, set
// tunables / wire their own UI, and hook `onFrame` for page-specific logic (e.g. the game's
// string-cutting). The harness exposes every tunable as a dev slider; the game sets defaults and
// builds mechanics on top.
import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import {
  buildWorld, addPuppet, setDamping, setPuppetWeight,
  reposePuppet, attachStringForSlot, detachAllStrings, stillParts, armPuppet, driveStrings,
  FINGERTIPS, bindingForHandedness, PUPPET_X_OFFSET, RIGHT_HAND_BINDING, LEFT_HAND_BINDING,
  DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING, DEFAULT_PUPPET_WEIGHT,
  DEFAULT_STRING_STIFFNESS, DEFAULT_STRING_DAMPING, DEFAULT_STRING_FORCE_CAP,
  WORLD_VIEW_HEIGHT, FLOOR_TOP, WALL_HALF_W, type Puppet, type FingerBind, type TargetName, type WeaponDef,
} from "./puppet.ts";
import { stageX, stageY } from "./control.ts";
import { initHands, type Hands, type Landmark, type QualityTier } from "./hands.ts";
import { Renderer, drawHands, teamColor } from "./draw.ts";

// ---- default gravity (raised to 20 for snappier, weightier motion) ----
export const DEFAULT_GRAVITY = 20;

// finger -> world mapping band (vertical)
const VERT_CENTER = WORLD_VIEW_HEIGHT / 2; // 6
const VERT_SPAN = WORLD_VIEW_HEIGHT;       // 12 -> a fingertip's y spans the whole view height
const POS_MIN_CUTOFF = 5.0; // snappy: detection is low-jitter, so little smoothing is needed
const POS_BETA = 0.01;

// ---- attach ritual constants ----
const HOLD_MS = 700;          // hold still this long (ms) over the prompt to trigger attachment
const STEADY_MARGIN = 0.5;    // world units a fingertip may wander and still count as "holding still"
const ATTACH_STRING_MS = 200; // each string attaches over 0.2s
const ATTACH_MARGIN = 0.8;    // move a fingertip more than this DURING attach -> the attach fails
const GRACE_MS = 500;         // hand absent this long -> detach + back to waiting (rides out brief gaps)
const BIND_TIMEOUT_MS = 800;  // a hand's puppet binding frees this long after its handedness disappears
const ATTACH_ORDER = [2, 0, 4, 1, 3]; // slot order strings snap on: torso(head) first, then hands, feet

// ---- post-attach "settle ramp" ----
// When the puppet is freed at the attaching->running handoff, the heavy chains and freshly-tensioned
// parts can carry residual energy. To stop the "seizure", we hand over at rest (velocities zeroed) and
// then ride out any remainder under MUCH higher damping/friction that eases back to the slider values
// over this window — a brief graceful settle, no change to the attach animation itself.
const SETTLE_MS = 700;               // how long the elevated damping eases back to normal
const SETTLE_LINEAR_DAMPING = 5;     // part linear damping at t=0 (vs ~0.4 normal) -> eases to `drag`
const SETTLE_ANGULAR_DAMPING = 8;    // part angular damping at t=0 (vs 1.0 normal)
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t); // t in [0,1], eased for a smooth relax

// Critically-damped smoothing toward a target (Unity's Mathf.SmoothDamp). Velocity-continuous, so a
// jumping target eases over ~smoothTime without an acceleration step (no kinematic-joint whip).
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

// ---- per-hand state (5 One Euro filters by finger slot, smoothed control positions) ----
export interface HandState {
  ffx: OneEuro[]; ffy: OneEuro[];
  pos: Pt[];   // 5 filtered world positions by finger slot (TARGET, at detection rate)
  ctrl: Pt[];  // 5 SMOOTHED control positions (chase pos every render frame)
  cvx: number[]; cvy: number[];
  primed: boolean;
  binding: FingerBind[];
  present: boolean;
  landmarks: Landmark[] | null;
}
const makeHandState = (): HandState => ({
  ffx: FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA)),
  ffy: FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA)),
  pos: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  ctrl: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  cvx: FINGERTIPS.map(() => 0),
  cvy: FINGERTIPS.map(() => 0),
  primed: false,
  binding: RIGHT_HAND_BINDING,
  present: false,
  landmarks: null,
});

export type Phase = "waiting" | "steadying" | "attaching" | "running";
export interface SlotState {
  phase: Phase;
  steadyAnchor: Pt[];
  steadyT0: number;
  captured: Pt[];
  bind: FingerBind[];
  attachTorso: Pt;
  attachT0: number;
  attached: number;
  lastPresentT: number;
  settleT0: number; // when the post-attach settle ramp started; -1 = not settling
}
const makeSlotState = (): SlotState => ({
  phase: "waiting",
  steadyAnchor: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  steadyT0: 0,
  captured: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  bind: RIGHT_HAND_BINDING,
  attachTorso: { x: 0, y: 0 },
  attachT0: 0,
  attached: 0,
  lastPresentT: -1e9,
  settleT0: -1,
});

export interface StageOpts {
  scene: HTMLCanvasElement;
  video: HTMLVideoElement;
  camOverlay: HTMLCanvasElement;
  gravityY?: number;
  camera?: { deviceId?: string | null; tier?: QualityTier };
}

export class Stage {
  // ---- tunables read every frame (set directly) ----
  swingRange = 1.0;
  playMargin = 0.10;
  gravityY = DEFAULT_GRAVITY;
  smoothTime = 0.01;
  debug = false;
  // Soft goal-drive string tunables — read every frame by driveStrings (no body mutation, so plain
  // fields like swingRange, not setters). stiffness = pull per unit stretch, damping = along-string
  // damping, forceCap = the no-rip cap (keep below the ball-joint strength).
  stringStiffness = DEFAULT_STRING_STIFFNESS;
  stringDamping = DEFAULT_STRING_DAMPING;
  stringForceCap = DEFAULT_STRING_FORCE_CAP;
  // Game rule: clamp each player's fingertips to their own half of the stage (slot 0 = left, x<=0;
  // slot 1 = right, x>=0) so neither can reach across the center line. Off by default (free harness).
  clampHalf = false;
  // ---- tunables that must be APPLIED to existing bodies (use the setters) ----
  private weight = DEFAULT_PUPPET_WEIGHT;
  private drag = DEFAULT_LINEAR_DAMPING;

  readonly handStates: [HandState, HandState] = [makeHandState(), makeHandState()];
  readonly slotStates: [SlotState, SlotState] = [makeSlotState(), makeSlotState()];

  // ---- per-frame HUD state (pages read these in onFrame instead of the engine touching the DOM) ----
  fps = 0;
  handCount = 0;

  // ---- page hook: runs every frame AFTER physics + the engine's own render, so a game can read
  // state, mutate the world (e.g. cut strings), and draw overlays on top. ----
  onFrame?: (now: number, dt: number) => void;

  // ---- page hook: fires each time a string snaps on during the attach ritual (slot, 0-based string
  // index 0..4 in attach order). The game wires this to the rising attach SFX; unused by the harness.
  onAttach?: (slot: 0 | 1, stringIndex: number) => void;

  // Per-slot handedness binding: which hand ("Left"/"Right") drives each puppet. Set on the raise,
  // kept stable so a hand keeps its puppet even after crossing the center line (no swap).
  private slotCat: [string | null, string | null] = [null, null];
  private slotSeenT: [number, number] = [-1e9, -1e9]; // last time each slot's bound hand was seen

  private overlayCtx: CanvasRenderingContext2D;
  private lastSeq = -1;
  private frames = 0;
  private fpsT = performance.now();
  private lastLoopT = performance.now();

  private constructor(
    readonly world: RAPIER.World,
    readonly puppets: Puppet[],
    readonly renderer: Renderer,
    readonly hands: Hands,
    private readonly camOverlay: HTMLCanvasElement,
    gravityY: number,
  ) {
    this.gravityY = gravityY;
    this.overlayCtx = camOverlay.getContext("2d")!;
    for (const p of puppets) setPuppetWeight(p, this.weight);
    addEventListener("resize", () => this.onResize());
    // Fit on mount: the canvas is first sized before the layout has settled (letterbox min() sizing,
    // fonts). A ResizeObserver fires right after the initial layout (and on any later change), so the
    // canvas + puppet quarters snap correct without needing a manual window resize.
    new ResizeObserver(() => this.onResize()).observe(this.renderer.canvas);
  }

  static async create(opts: StageOpts): Promise<Stage> {
    await RAPIER.init();
    const gravityY = opts.gravityY ?? DEFAULT_GRAVITY;
    const world = buildWorld(RAPIER, gravityY);
    const renderer = new Renderer(opts.scene);
    // Place the two puppets (and their hand prompts, which sit at each puppet's x) at the screen
    // QUARTERS for balanced initial spacing, not bunched near center. Derived from the visible world
    // width at load; floored at PUPPET_X_OFFSET so a narrow/portrait window doesn't crowd them.
    const offset = Math.max(PUPPET_X_OFFSET, renderer.worldWidth / 4);
    const puppets = [
      addPuppet(RAPIER, world, -offset, LEFT_HAND_BINDING),
      addPuppet(RAPIER, world, +offset, RIGHT_HAND_BINDING),
    ];
    const hands = await initHands(opts.video, opts.camera ?? {});
    const stage = new Stage(world, puppets, renderer, hands, opts.camOverlay, gravityY);
    stage.sizeOverlay();
    return stage;
  }

  // ---- live setters for the tunables that touch existing bodies ----
  setWeight(w: number): void { this.weight = w; for (const p of this.puppets) setPuppetWeight(p, w); }
  setDrag(d: number): void { this.drag = d; for (const p of this.puppets) setDamping(p, d, DEFAULT_ANGULAR_DAMPING); }
  get weightVal(): number { return this.weight; }
  get dragVal(): number { return this.drag; }

  // ---- weapons ----
  // Arm one puppet with a loadout (stored on the puppet, so rearm() can rebuild dropped blades).
  arm(slot: 0 | 1, weapons: WeaponDef[]): void { armPuppet(RAPIER, this.world, this.puppets[slot], weapons); }
  // Re-apply each puppet's stored loadout — rebuilds any blade a disarm dropped. Called at round start.
  rearm(): void { for (const p of this.puppets) armPuppet(RAPIER, this.world, p, p.loadout); }

  start(): void { requestAnimationFrame(this.loop); }

  private sizeOverlay(): void {
    this.camOverlay.width = this.camOverlay.clientWidth;
    this.camOverlay.height = this.camOverlay.clientHeight;
  }
  private onResize(): void { this.renderer.resize(); this.sizeOverlay(); this.requarter(); }

  // Keep the two puppets on the screen quarters when the visible width changes (after the layout
  // settles post-mount, or a window resize). Only re-home WAITING puppets — never yank a live one.
  private requarter(): void {
    const offset = Math.max(PUPPET_X_OFFSET, this.renderer.worldWidth / 4);
    for (let s = 0 as 0 | 1; s <= 1; s = (s + 1) as 0 | 1) {
      const targetX = s === 0 ? -offset : offset;
      const p = this.puppets[s];
      if (this.slotStates[s].phase === "waiting" && Math.abs(p.homeTorso.x - targetX) > 0.02) {
        p.homeTorso.x = targetX; // the waiting state re-homes the body to homeTorso each frame
        p.xOffset = targetX;     // the prompt outline + team colour read from xOffset
      }
    }
  }

  private readFingerPositions(h: HandState, landmarks: Landmark[], now: number, slot: 0 | 1): void {
    for (let j = 0; j < FINGERTIPS.length; j++) {
      const lm = landmarks[FINGERTIPS[j]];
      const fx = h.ffx[j].filter(stageX(lm, this.playMargin), now);
      const fy = h.ffy[j].filter(stageY(lm, this.playMargin), now);
      let x = fx * this.renderer.worldWidth * this.swingRange;
      // keep each player on their half, and a hair OFF the center wall so a string can't drag a part into it
      if (this.clampHalf) x = slot === 0 ? Math.min(-WALL_HALF_W, x) : Math.max(WALL_HALF_W, x);
      h.pos[j].x = x;
      h.pos[j].y = Math.max(FLOOR_TOP, VERT_CENTER + fy * VERT_SPAN * this.swingRange);
    }
  }

  private readHands(now: number): void {
    this.hands.pump(now);
    if (this.hands.seq === this.lastSeq) return;
    this.lastSeq = this.hands.seq;

    type Det = { landmarks: Landmark[]; cat: string; wristX: number };
    const dets: Det[] = this.hands.latest.map((d) => ({
      landmarks: d.landmarks,
      cat: d.handedness,
      wristX: stageX(d.landmarks[0]),
    }));

    const hs = this.handStates;
    hs[0].present = false; hs[0].landmarks = null;
    hs[1].present = false; hs[1].landmarks = null;

    const assign = (slot: 0 | 1, d: Det) => {
      const h = hs[slot];
      h.present = true;
      h.landmarks = d.landmarks;
      h.binding = bindingForHandedness(d.cat);
      this.readFingerPositions(h, d.landmarks, now, slot);
    };

    // Free a slot's binding once its hand's handedness has been gone a while, so a new raise rebinds it.
    if (now - this.slotSeenT[0] > BIND_TIMEOUT_MS) this.slotCat[0] = null;
    if (now - this.slotSeenT[1] > BIND_TIMEOUT_MS) this.slotCat[1] = null;

    // 1) Maintain identity: a hand drives the slot bound to its HANDEDNESS — even across the center
    //    line — so control never swaps when hands cross (position is no longer used to re-sort).
    const leftover: Det[] = [];
    for (const d of dets) {
      const s: 0 | 1 | null = this.slotCat[0] === d.cat ? 0 : this.slotCat[1] === d.cat ? 1 : null;
      if (s !== null && !hs[s].present) { assign(s, d); this.slotSeenT[s] = now; }
      else leftover.push(d); // unbound handedness, or a duplicate of an already-filled slot
    }
    // 2) Bind a not-yet-bound hand to a free slot — preferring the side it was raised on ("raise a hand").
    for (const d of leftover) {
      const pref: 0 | 1 = d.wristX < 0 ? 0 : 1;
      const other: 0 | 1 = pref === 0 ? 1 : 0;
      let s: 0 | 1 | null = null;
      if (this.slotCat[pref] === null && !hs[pref].present) s = pref;
      else if (this.slotCat[other] === null && !hs[other].present) s = other;
      if (s !== null) { this.slotCat[s] = d.cat; assign(s, d); this.slotSeenT[s] = now; }
    }

    if (!hs[0].present) hs[0].primed = false;
    if (!hs[1].present) hs[1].primed = false;
    this.handCount = dets.length;
  }

  private smoothControls(h: HandState, dt: number): void {
    for (let j = 0; j < FINGERTIPS.length; j++) {
      if (!h.primed) {
        h.ctrl[j].x = h.pos[j].x; h.ctrl[j].y = h.pos[j].y;
        h.cvx[j] = 0; h.cvy[j] = 0;
      } else {
        [h.ctrl[j].x, h.cvx[j]] = smoothDamp(h.ctrl[j].x, h.pos[j].x, h.cvx[j], this.smoothTime, dt);
        [h.ctrl[j].y, h.cvy[j]] = smoothDamp(h.ctrl[j].y, h.pos[j].y, h.cvy[j], this.smoothTime, dt);
      }
    }
    h.primed = true;
  }

  private drivePuppet(p: Puppet, h: HandState): void {
    if (!h.present) return;
    const slotByTarget = {} as Record<TargetName, number>;
    h.binding.forEach((f) => { slotByTarget[f.target] = FINGERTIPS.indexOf(f.landmark); });
    for (const s of p.strings) {
      const pos = h.ctrl[slotByTarget[s.target]];
      s.control.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: 0 });
    }
  }

  private updateSlot(slot: 0 | 1, now: number, dt: number): void { // dt is the frame step (for goal impulses)
    const h = this.handStates[slot];
    const st = this.slotStates[slot];
    const p = this.puppets[slot];
    if (h.present) st.lastPresentT = now;
    const absent = now - st.lastPresentT > GRACE_MS;

    switch (st.phase) {
      case "waiting":
        reposePuppet(p, p.homeTorso);
        if (h.present) { copyPts(st.steadyAnchor, h.pos); st.steadyT0 = now; st.phase = "steadying"; }
        break;

      case "steadying":
        reposePuppet(p, p.homeTorso);
        if (absent) { st.phase = "waiting"; break; }
        if (!h.present) break;
        if (maxPtDist(h.pos, st.steadyAnchor) > STEADY_MARGIN) { copyPts(st.steadyAnchor, h.pos); st.steadyT0 = now; }
        else if (now - st.steadyT0 >= HOLD_MS) { this.beginAttach(slot, now); }
        break;

      case "attaching":
        if (absent || (h.present && maxPtDist(h.pos, st.captured) > ATTACH_MARGIN)) { this.resetToWaiting(slot); break; }
        reposePuppet(p, st.attachTorso);
        for (const s of p.strings) s.control.setNextKinematicTranslation({ x: st.captured[s.slot].x, y: st.captured[s.slot].y, z: 0 });
        {
          const due = Math.min(ATTACH_ORDER.length, Math.floor((now - st.attachT0) / ATTACH_STRING_MS) + 1);
          while (st.attached < due) {
            const sSlot = ATTACH_ORDER[st.attached];
            attachStringForSlot(RAPIER, this.world, p, sSlot, st.captured[sSlot], st.bind[sSlot]);
            this.onAttach?.(slot, st.attached);
            st.attached++;
          }
        }
        if (st.attached >= ATTACH_ORDER.length && now - st.attachT0 >= ATTACH_ORDER.length * ATTACH_STRING_MS) {
          // Hand over at REST: zero every part velocity, then start the settle ramp with elevated part
          // damping that eases back to the slider value over SETTLE_MS. Strings were captured at the
          // held pose (stretch ~0 -> ~0 force), so there's no chain energy to spasm; the ramp only
          // absorbs the gentle sag as gravity loads the springs.
          stillParts(p);
          setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
          st.settleT0 = now;
          h.primed = false;
          st.phase = "running";
        }
        break;

      case "running":
        if (absent) { this.resetToWaiting(slot); break; }
        this.applySettle(p, st, now);
        if (h.present) { this.smoothControls(h, dt); this.drivePuppet(p, h); }
        // Apply the capped goal force every running frame (even during a brief hand gap within grace)
        // so the puppet keeps holding itself up from the last control positions.
        driveStrings(p, this.stringStiffness, this.stringDamping, this.stringForceCap, dt);
        break;
    }
  }

  // Ease the elevated settle damping/friction back to the live slider values over SETTLE_MS. A no-op
  // once the ramp has finished (settleT0 = -1). Runs while the puppet is already being driven, so the
  // hand stays in control — the ramp only absorbs the post-attach residual.
  private applySettle(p: Puppet, st: SlotState, now: number): void {
    if (st.settleT0 < 0) return;
    const t = (now - st.settleT0) / SETTLE_MS;
    if (t >= 1) {
      setDamping(p, this.drag, DEFAULT_ANGULAR_DAMPING);
      st.settleT0 = -1;
      return;
    }
    const k = easeOut(1 - t); // 1 at release -> 0 at window end
    setDamping(
      p,
      this.drag + (SETTLE_LINEAR_DAMPING - this.drag) * k,
      DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k,
    );
  }

  private beginAttach(slot: 0 | 1, now: number): void {
    const h = this.handStates[slot];
    const st = this.slotStates[slot];
    copyPts(st.captured, h.pos);
    st.bind = h.binding;
    st.attachT0 = now;
    st.attached = 0;
    st.settleT0 = -1;
    // center the torso under the MIDDLE fingertip (the head string's control) so the head hangs
    // straight below point 3 and the other strings fan evenly.
    const headSlot = st.bind.findIndex((f) => f.target === "torso");
    const headX = headSlot >= 0 ? st.captured[headSlot].x : this.puppets[slot].homeTorso.x;
    st.attachTorso = { x: headX, y: this.puppets[slot].homeTorso.y };
    reposePuppet(this.puppets[slot], st.attachTorso);
    st.phase = "attaching";
  }

  // Cut ALL of a puppet's strings and return it to the waiting/prompt state at its neutral home pose.
  resetToWaiting(slot: 0 | 1): void {
    detachAllStrings(this.puppets[slot]);
    reposePuppet(this.puppets[slot], this.puppets[slot].homeTorso);
    // A reset mid-settle would otherwise leave the parts stuck at elevated damping; restore the slider.
    setDamping(this.puppets[slot], this.drag, DEFAULT_ANGULAR_DAMPING);
    this.slotStates[slot].phase = "waiting";
    this.slotStates[slot].attached = 0;
    this.slotStates[slot].settleT0 = -1;
  }

  private loop = (): void => {
    const now = performance.now();
    this.frames++;
    if (now - this.fpsT >= 500) { this.fps = (this.frames * 1000) / (now - this.fpsT); this.frames = 0; this.fpsT = now; }

    this.readHands(now);

    const dt = Math.min(0.05, (now - this.lastLoopT) / 1000);
    this.lastLoopT = now;

    this.world.gravity = { x: 0, y: -this.gravityY, z: 0 };
    this.updateSlot(0, now, dt);
    this.updateSlot(1, now, dt);
    this.world.step();

    const r = this.renderer;
    r.clear();
    for (let s = 0 as 0 | 1; s <= 1; s = (s + 1) as 0 | 1) {
      r.drawPuppet(this.puppets[s]);
      const st = this.slotStates[s];
      const ph = st.phase;
      // Keep the hand outline + live points up through the WHOLE attach (until `running`), so the
      // player holds still until the last string snaps on instead of moving the moment the hold ends.
      // The bar stays full during `attaching` (the strings visibly snapping on carry the progress).
      if (ph === "waiting" || ph === "steadying" || ph === "attaching") {
        const prog = ph === "steadying" ? Math.min(1, (now - st.steadyT0) / HOLD_MS) : ph === "attaching" ? 1 : 0;
        r.drawPrompt(this.puppets[s].xOffset, s, prog, now);
        if ((ph === "steadying" || ph === "attaching") && this.handStates[s].present) {
          r.drawFingerPoints(this.handStates[s].pos, teamColor(this.puppets[s].xOffset));
        }
      }
    }
    if (this.debug) r.drawDebug(this.world, this.puppets.flatMap((p) => p.strings));
    drawHands(this.overlayCtx, this.camOverlay.width, this.camOverlay.height,
      [this.handStates[0].landmarks, this.handStates[1].landmarks],
      [teamColor(this.puppets[0].xOffset), teamColor(this.puppets[1].xOffset)]);

    this.onFrame?.(now, dt);

    requestAnimationFrame(this.loop);
  };
}
