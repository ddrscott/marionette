import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { CONTROL_HALF_V, CONTROL_HALF_W, WORLD_VIEW_HEIGHT, type Rig, type Vec2 } from "./puppet.ts";
import { HAND_CONNECTIONS, type Landmark } from "./hands.ts";

// Bodies rotate only about Z, so the world rotation is a single angle.
const zAngle = (q: RAPIER_NS.Rotation): number => 2 * Math.atan2(q.z, q.w);

// Rotate a body-local point (Z-only) into world space.
function localToWorld(body: RAPIER_NS.RigidBody, a: Vec2): Vec2 {
  const p = body.translation();
  const ang = zAngle(body.rotation());
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x + a.x * c - a.y * s, y: p.y + a.x * s + a.y * c };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  scale = 80; // px per world unit; recomputed on resize from the FIXED world view height

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
    // A fixed world height fills the viewport, so any world-unit length is a
    // constant fraction of canvas height regardless of resolution (§4.1).
    this.scale = this.canvas.height / WORLD_VIEW_HEIGHT;
  }

  private sx(x: number): number { return this.canvas.width / 2 + x * this.scale; }
  private sy(y: number): number { return this.canvas.height - y * this.scale; }
  private lineTo(p: Vec2): void { this.ctx.lineTo(this.sx(p.x), this.sy(p.y)); }
  private moveTo(p: Vec2): void { this.ctx.moveTo(this.sx(p.x), this.sy(p.y)); }

  draw(rig: Rig): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const ct = rig.control.translation();        // control bar is kinematic, identity rotation
    const controlPt = (a: Vec2): Vec2 => ({ x: ct.x + a.x, y: ct.y + a.y });

    // (1) control-bar crosshair — the stage half of the hand->control visual link.
    ctx.strokeStyle = "rgba(57,217,138,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.sx(ct.x), 0); ctx.lineTo(this.sx(ct.x), this.canvas.height);
    ctx.moveTo(0, this.sy(ct.y)); ctx.lineTo(this.canvas.width, this.sy(ct.y));
    ctx.stroke();

    // (2) strings.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of rig.strings) {
      const top = controlPt(s.controlAnchor);
      const end = localToWorld(s.body, s.bodyAnchor);
      if (s.kind === "chain") {
        ctx.strokeStyle = "#c9c9d2";
        ctx.lineWidth = 2;
        ctx.beginPath();
        this.moveTo(top);
        for (const seg of s.segs) { const c = seg.translation(); this.lineTo({ x: c.x, y: c.y }); }
        this.lineTo(end);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(201,201,210,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.moveTo(top);
        this.lineTo(end);
        ctx.stroke();
      }
      // attach dot on the puppet — marks the control point (and the customization handle).
      ctx.fillStyle = "#39d98a";
      ctx.beginPath();
      ctx.arc(this.sx(end.x), this.sy(end.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // (3) puppet capsules.
    for (const part of rig.parts) {
      const e1 = localToWorld(part.body, { x: 0, y: part.half });
      const e2 = localToWorld(part.body, { x: 0, y: -part.half });
      ctx.strokeStyle = part.color;
      ctx.lineWidth = part.rad * 2 * this.scale;
      ctx.beginPath();
      this.moveTo(e1);
      this.lineTo(e2);
      ctx.stroke();
    }

    // (4) the horizontal control bar ("+") on top.
    ctx.strokeStyle = "#caa46a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    this.moveTo(controlPt({ x: -CONTROL_HALF_W, y: 0 })); this.lineTo(controlPt({ x: CONTROL_HALF_W, y: 0 }));
    this.moveTo(controlPt({ x: 0, y: CONTROL_HALF_V })); this.lineTo(controlPt({ x: 0, y: -CONTROL_HALF_V }));
    ctx.stroke();
    // bright dot at the held center (where the hand maps to).
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(this.sx(ct.x), this.sy(ct.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- hand-landmark overlay (drawn already-mirrored to match the flipped preview) ----
export function drawHand(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  landmarks: Landmark[] | null,
): void {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;

  const X = (lm: Landmark) => (1 - lm.x) * w; // mirror X to match the selfie preview
  const Y = (lm: Landmark) => lm.y * h;

  // connections
  ctx.strokeStyle = "rgba(232,232,232,0.7)";
  ctx.lineWidth = 2;
  for (const conn of HAND_CONNECTIONS) {
    const a = landmarks[conn.start], b = landmarks[conn.end];
    ctx.beginPath();
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
    ctx.stroke();
  }

  // all 21 landmarks
  ctx.fillStyle = "#e8e8e8";
  for (let i = 0; i < landmarks.length; i++) {
    if (i === 9) continue;
    const lm = landmarks[i];
    ctx.beginPath();
    ctx.arc(X(lm), Y(lm), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // control point #9 (palm) — ringed + crosshair, the cam half of the control link.
  const ctrl = landmarks[9];
  const cx = X(ctrl), cy = Y(ctrl);
  ctx.strokeStyle = "rgba(57,217,138,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.stroke();

  ctx.fillStyle = "#39d98a";
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#39d98a";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();
}
