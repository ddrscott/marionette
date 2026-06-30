import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { WORLD_VIEW_HEIGHT, type Rig, type Vec2 } from "./puppet.ts";
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

  draw(rig: Rig): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const perch = rig.perch.translation();

    // (1) perch crosshair — the stage half of the hand->perch visual link.
    ctx.strokeStyle = "rgba(57,217,138,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.sx(perch.x), 0); ctx.lineTo(this.sx(perch.x), this.canvas.height);
    ctx.moveTo(0, this.sy(perch.y)); ctx.lineTo(this.canvas.width, this.sy(perch.y));
    ctx.stroke();

    // (2) hand strings (control lines) — drawn behind, thin and dim.
    ctx.strokeStyle = "rgba(57,217,138,0.45)";
    ctx.lineWidth = 1.5;
    for (const hs of rig.handStrings) {
      const w = localToWorld(hs.arm, hs.armAnchor);
      ctx.beginPath();
      ctx.moveTo(this.sx(perch.x), this.sy(perch.y));
      ctx.lineTo(this.sx(w.x), this.sy(w.y));
      ctx.stroke();
    }

    // (3) center string — polyline through the segment chain; sags and swings.
    ctx.strokeStyle = "#c9c9d2";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.sx(perch.x), this.sy(perch.y));
    for (const seg of rig.chain) {
      const c = seg.translation();
      ctx.lineTo(this.sx(c.x), this.sy(c.y));
    }
    const tt = localToWorld(rig.torso, rig.torsoTopAnchor);
    ctx.lineTo(this.sx(tt.x), this.sy(tt.y));
    ctx.stroke();

    // (4) puppet capsules.
    for (const part of rig.parts) {
      const e1 = localToWorld(part.body, { x: 0, y: part.half });
      const e2 = localToWorld(part.body, { x: 0, y: -part.half });
      ctx.strokeStyle = part.color;
      ctx.lineWidth = part.rad * 2 * this.scale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(this.sx(e1.x), this.sy(e1.y));
      ctx.lineTo(this.sx(e2.x), this.sy(e2.y));
      ctx.stroke();
    }

    // (5) perch control bar — sits on top.
    const barHalf = 0.55 * this.scale;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.sx(perch.x) - barHalf, this.sy(perch.y));
    ctx.lineTo(this.sx(perch.x) + barHalf, this.sy(perch.y));
    ctx.stroke();
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

  // control point #9 (palm) — ringed + crosshair, the cam half of the perch link.
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
