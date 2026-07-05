// /pose — the one-pose sandbox. A single marionette and a "chalk outline" target silhouette (the
// puppet's own body shape, enlarged, black-filled with a white outline): bring the puppet alive (the
// raise-hand-and-hold ritual, via Pilot), then nestle every body part INTO the silhouette — position
// AND orientation — and hold briefly to lock it. A timer counts up so you chase your own best. No
// opponent, so the marionette's chaos becomes a skill to tame, not adversarial noise.
//
// De-risk sandbox for "is converging a puppet onto a silhouette fun?" — deliberately minimal:
//   • N — next built-in pose (restarts timer)     • C — capture the puppet's CURRENT pose as target
//   • [ / ] — shrink / grow position tolerance     • A — toggle whether orientation must match too
//   • R — restart the current pose (reset the timer + green, keep the outline)
// C logs the captured pose (JSON) to the console, so good poses can be authored by demonstration and
// baked into BUILTINS below instead of guessing coordinates.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, addPuppet, reposePuppet, setPuppetWeight,
  RIGHT_HAND_BINDING, DEFAULT_PUPPET_WEIGHT,
  DEFAULT_STRING_STIFFNESS, DEFAULT_STRING_FORCE_CAP,
  type Vec2, type FingerBind, type TargetName,
} from "./puppet.ts";
import { Pilot, type PilotCfg } from "./pilot.ts";
import { Renderer, drawHands, teamColor, TEAM_TEAL, type PoseSilPart } from "./draw.ts";
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import { makeCamDraggable } from "./dragCam.ts";
import { createSettingsMenu, loadMargin } from "./settingsMenu.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");

const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";
const GRAVITY = 20;

const ROOT_I = 0;              // parts[0] = torso is the root
const HOLD_POSE_MS = 400;      // hold the full pose this long to lock it (the discrete commit)
const PLACE: Vec2 = { x: 0, y: 5.0 }; // where a built-in pose's root sits on screen
// Silhouette is drawn a touch bigger than the real puppet so it reads as an outline to nestle INTO.
const SIL_RAD_SCALE = 1.6;
const SIL_HALF_PAD = 0.12;

// A pose = per-part {x,y,angle} (index order: torso, lArm, rArm, lLeg, rLeg).
type PoseNode = { x: number; y: number; angle: number };

// Built-in target poses as per-part OFFSETS from the root (+y up). Reachable for a marionette (pulled
// from ABOVE — "up/out" poses are natural). Each limb's ANGLE is derived radially (pointing away from
// the torso), which is roughly how a raised/spread limb hangs — so orientation matching stays fair.
const BUILTINS: { name: string; offs: Vec2[] }[] = [
  { name: "STAR",  offs: [{ x: 0, y: 0 }, { x: -1.0, y: 0.5 }, { x: 1.0, y: 0.5 }, { x: -0.8, y: -1.2 }, { x: 0.8, y: -1.2 }] },
  { name: "CHEER", offs: [{ x: 0, y: 0 }, { x: -0.6, y: 0.9 }, { x: 0.6, y: 0.9 }, { x: -0.3, y: -1.3 }, { x: 0.3, y: -1.3 }] },
  { name: "KICK",  offs: [{ x: 0, y: 0 }, { x: -0.8, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: -0.2, y: -1.3 }, { x: 0.9, y: -0.5 }] },
];
// z-angle whose capsule free-end points along (dx,dy) — i.e. radially outward from the root.
const radialAngle = (dx: number, dy: number): number => (dx === 0 && dy === 0 ? 0 : Math.atan2(dx, -dy));
const builtinPose = (i: number): PoseNode[] =>
  BUILTINS[i].offs.map((o) => ({ x: PLACE.x + o.x, y: PLACE.y + o.y, angle: radialAngle(o.x, o.y) }));

const wrapAbs = (d: number): number => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));

// ---- finger → part remap (settings menu) ----
// The player can reassign which numbered finger drives which body part. The 5 finger SLOTS keep their
// physical landmark (thumb=4 … pinky=20); only the target part (and its canonical body anchor) changes.
const LS_BINDING = "handbattle.pose.binding";
const FINGER_NAMES = ["thumb", "index", "middle", "ring", "pinky"];
const TARGET_LABELS: Record<string, string> = { lArm: "left arm", rArm: "right arm", lLeg: "left leg", rLeg: "right leg", torso: "head" };
const BASE_BIND = RIGHT_HAND_BINDING;                          // 5 canonical rows (landmark + anchor per target)
const DEFAULT_TARGETS = BASE_BIND.map((f) => f.target);        // ["lArm","lLeg","torso","rLeg","rArm"]
const ANCHOR_BY_TARGET = new Map(BASE_BIND.map((f) => [f.target, f.bodyAnchor] as const));
const REMAP_TARGETS = DEFAULT_TARGETS.map((t) => ({ value: String(t), label: TARGET_LABELS[t] ?? String(t) }));

// Build a full binding from a per-slot target list: fixed landmark, chosen target, that target's anchor.
const makeBinding = (targets: string[]): FingerBind[] =>
  BASE_BIND.map((f, i) => {
    const t = (targets[i] ?? f.target) as TargetName;
    return { name: `${i + 1} ${FINGER_NAMES[i]}→${TARGET_LABELS[t] ?? t}`, landmark: f.landmark, target: t, bodyAnchor: ANCHOR_BY_TARGET.get(t) ?? f.bodyAnchor };
  });

// Saved mapping (5 known targets), else the default. Guards against a stale/garbage localStorage value.
const loadTargets = (): string[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_BINDING) ?? "null");
    if (Array.isArray(raw) && raw.length === BASE_BIND.length && raw.every((t) => typeof t === "string" && ANCHOR_BY_TARGET.has(t as TargetName))) {
      return raw as string[];
    }
  } catch { /* fall through to default */ }
  return DEFAULT_TARGETS.map(String);
};

(async function main() {
  try {
    await RAPIER.init();
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;

    const world = buildWorld(RAPIER, GRAVITY, { wall: false, floor: true }); // one centred puppet, no divider
    const renderer = new Renderer(scene);
    renderer.showWall = false;

    const overlayCtx = camOverlay.getContext("2d")!;
    const sizeOverlay = (): void => { camOverlay.width = camOverlay.clientWidth; camOverlay.height = camOverlay.clientHeight; };
    sizeOverlay();
    new ResizeObserver(() => { renderer.resize(); sizeOverlay(); }).observe(scene);

    const hands = await initHands(video, { deviceId: localStorage.getItem(LS_DEVICE), tier });

    // /pose is a HOLD-STILL task (nestle each limb into the silhouette and keep it there), so it's
    // deliberately CALMER than the game: the puppet should settle onto the goal and stay, not ring
    // around it. Every lever below is damped up vs the game defaults — a smoother goal (bigger
    // smoothTime) so hand jitter stops exciting the swing; heavier linear/angular part damping so the
    // pendulum + limb wobble die fast; more along-string damping to kill rubberband on the pull.
    const cfg: PilotCfg = {
      worldWidth: renderer.worldWidth,
      playMargin: loadMargin(), swingRange: 1.0, smoothTime: 0.05,
      drag: 2.5, angularDrag: 3.5,
      stiffness: DEFAULT_STRING_STIFFNESS, damping: 28, forceCap: DEFAULT_STRING_FORCE_CAP,
    };

    let bindingTargets = loadTargets(); // player's saved finger→part mapping (or the default)
    const puppet = addPuppet(RAPIER, world, 0, makeBinding(bindingTargets));
    puppet.homeTorso = { x: 0, y: 4.8 };
    puppet.xOffset = 0;
    setPuppetWeight(puppet, DEFAULT_PUPPET_WEIGHT);
    reposePuppet(puppet, puppet.homeTorso);
    const pilot = new Pilot(RAPIER, world, puppet, cfg);

    // Standard app menu (gear → slide-over): camera + quality + play-area margin (no audio on /pose),
    // plus the finger→part remap. Changing the mapping swaps the binding and drops the puppet to
    // re-attach with it (the ritual re-runs → respects the settle/anti-seizure hand-off).
    createSettingsMenu({
      hands,
      margin: { get: () => cfg.playMargin, set: (m) => { cfg.playMargin = m; } },
      remap: {
        fingers: FINGER_NAMES.map((n, i) => `${i + 1} · ${n}`),
        targets: REMAP_TARGETS,
        defaults: DEFAULT_TARGETS.map(String),
        get: () => bindingTargets,
        set: (targets) => {
          bindingTargets = targets;
          localStorage.setItem(LS_BINDING, JSON.stringify(targets));
          puppet.binding = makeBinding(targets);
          pilot.reset(); // drop + re-attach with the new mapping
        },
      },
      mount: $("charstage"),
    });

    // ---- pose-match state ----
    let target: PoseNode[] | null = builtinPose(0);
    let builtinIdx = 0;
    let posTol = 0.5;             // position tolerance (world units) — tune with [ ]
    const ANG_TOL = 0.6;          // orientation tolerance (rad, ~34°) when angle matching is on
    let angleOn = true;           // must the limb ORIENTATION match too? (A toggles)
    let startT = performance.now();
    let solved = false;
    let clearMs = 0;
    let holdStart = -1;
    let lastInZone: boolean[] = [];

    const liveNodes = (): PoseNode[] => puppet.parts.map((p) => {
      const t = p.body.translation(); const q = p.body.rotation();
      return { x: t.x, y: t.y, angle: 2 * Math.atan2(q.z, q.w) };
    });
    // silhouette geometry for the renderer: goal transform + the puppet's part sizes, enlarged.
    const silParts = (): PoseSilPart[] => (target ?? []).map((n, i) => ({
      x: n.x, y: n.y, angle: n.angle,
      half: puppet.parts[i].half + SIL_HALF_PAD, rad: puppet.parts[i].rad * SIL_RAD_SCALE,
    }));
    const setTarget = (nodes: PoseNode[] | null): void => {
      target = nodes; solved = false; clearMs = 0; holdStart = -1; startT = performance.now();
      lastInZone = nodes ? nodes.map(() => false) : [];
    };

    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "n") { builtinIdx = (builtinIdx + 1) % BUILTINS.length; setTarget(builtinPose(builtinIdx)); }
      else if (k === "c") {
        const nodes = liveNodes();
        setTarget(nodes.map((n) => ({ ...n })));
        const root = nodes[ROOT_I];
        const dump = nodes.map((n) => ({ x: +(n.x - root.x).toFixed(2), y: +(n.y - root.y).toFixed(2), a: +n.angle.toFixed(2) }));
        console.info("[pose] captured (offset from root + angle):", JSON.stringify(dump));
      } else if (k === "[") { posTol = Math.max(0.2, +(posTol - 0.05).toFixed(2)); }
      else if (k === "]") { posTol = Math.min(1.2, +(posTol + 0.05).toFixed(2)); }
      else if (k === "a") { angleOn = !angleOn; }
      else if (k === "r") { if (target) setTarget(target); } // restart: reset timer + green, keep the outline
    });

    makeCamDraggable($("camBox"), $("charstage"));
    $("boot").remove();

    let lastT = performance.now();
    let prevPhase = pilot.phase;
    const loop = (): void => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      cfg.worldWidth = renderer.worldWidth;
      world.gravity = { x: 0, y: -GRAVITY, z: 0 };

      hands.pump(now);
      const det = hands.latest[0] ?? null;
      const lm = det ? det.landmarks : null;

      pilot.feed(lm, now);
      pilot.update(now, dt);
      world.step();

      const running = pilot.phase === "running";
      if (running && prevPhase !== "running" && target && !solved) startT = now; // start the clock on come-alive
      prevPhase = pilot.phase;

      if (running && target && !solved) {
        const live = liveNodes();
        lastInZone = target.map((t, i) =>
          Math.hypot(live[i].x - t.x, live[i].y - t.y) <= posTol &&
          (!angleOn || wrapAbs(live[i].angle - t.angle) <= ANG_TOL));
        if (lastInZone.every(Boolean)) {
          if (holdStart < 0) holdStart = now;
          if (now - holdStart >= HOLD_POSE_MS) { solved = true; clearMs = now - startT; }
        } else holdStart = -1;
      } else if (!target) lastInZone = [];

      // ---- render ----
      renderer.clear();
      if (target) {
        const hold = running && !solved && holdStart >= 0 ? Math.min(1, (now - holdStart) / HOLD_POSE_MS) : solved ? 1 : 0;
        renderer.drawPoseTarget(silParts(), lastInZone.length ? lastInZone : target.map(() => false), ROOT_I, hold);
      }
      renderer.drawPuppet(puppet);

      const ph = pilot.phase;
      if (ph === "waiting" || ph === "steadying" || ph === "attaching") {
        renderer.drawPrompt(puppet.xOffset, 0, pilot.steadyProgress(now), now);
        if ((ph === "steadying" || ph === "attaching") && pilot.present) {
          renderer.drawFingerPoints(pilot.pos, teamColor(puppet.xOffset));
        }
      }

      // HUD — pass the visible world width so single-line labels shrink to fit a narrow/portrait
      // canvas instead of clipping off the edges (see Renderer.drawLabel maxWidthUnits).
      const hudMax = renderer.worldWidth - 0.8;
      renderer.drawLabel(0, 11.3, "MARIONETTE POSE", TEAM_TEAL, true, hudMax);
      const inCount = lastInZone.filter(Boolean).length;
      const elapsed = solved ? clearMs : (running && target ? now - startT : 0);
      const status =
        !running ? "raise a hand and hold to bring the puppet alive"
        : !target ? "N: pick a pose · C: capture your own"
        : solved ? `LOCKED  ${(clearMs / 1000).toFixed(2)}s   ·   N: next pose`
        : `${(elapsed / 1000).toFixed(1)}s   ·   ${inCount}/5 in the outline   ·   fill it, then hold`;
      renderer.drawLabel(0, 10.72, status, solved ? "#7bd88f" : "#9a968e", solved, hudMax);
      renderer.drawLabel(0, 0.5,
        `pose ${target ? BUILTINS[builtinIdx].name : "—"}  ·  tol ${posTol.toFixed(2)} ([ ])  ·  angle ${angleOn ? "on" : "off"} (A)  ·  N next  ·  C capture  ·  R restart`,
        "#6b7280", false, hudMax);

      drawHands(overlayCtx, camOverlay.width, camOverlay.height, [lm], [TEAM_TEAL]);
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost and use Chrome.</pre>`;
  }
})();
