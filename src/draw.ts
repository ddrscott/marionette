import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { WORLD_VIEW_HEIGHT, FLOOR_TOP, FINGERS, type Rig, type Vec2 } from "./puppet.ts";
import { HAND_CONNECTIONS, type Landmark } from "./hands.ts";

// One distinct colour per finger/string (1 thumb .. 5 pinky), shared by the strings, the control-point
// markers, and the camera-overlay fingertip dots so the finger→part mapping reads at a glance.
const FINGER_COLORS = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c780ff"];

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
    this.scale = this.canvas.height / WORLD_VIEW_HEIGHT;
  }

  // Visible world width (units): a fingertip's full detection range (stage-x ∈ [-0.5,0.5]) maps onto it.
  get worldWidth(): number { return this.canvas.width / this.scale; }

  private sx(x: number): number { return this.canvas.width / 2 + x * this.scale; }
  private sy(y: number): number { return this.canvas.height - y * this.scale; }
  private lineTo(p: Vec2): void { this.ctx.lineTo(this.sx(p.x), this.sy(p.y)); }
  private moveTo(p: Vec2): void { this.ctx.moveTo(this.sx(p.x), this.sy(p.y)); }

  // Stroke a smooth curve through world-space points so a chain's segment nodes read as one
  // continuous, folding string instead of visible links.
  private smoothPath(pts: Vec2[]): void {
    const { ctx } = this;
    this.moveTo(pts[0]);
    if (pts.length < 3) { for (let i = 1; i < pts.length; i++) this.lineTo(pts[i]); return; }
    let i = 1;
    for (; i < pts.length - 2; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(this.sx(pts[i].x), this.sy(pts[i].y), this.sx(mx), this.sy(my));
    }
    ctx.quadraticCurveTo(this.sx(pts[i].x), this.sy(pts[i].y), this.sx(pts[i + 1].x), this.sy(pts[i + 1].y));
  }

  draw(rig: Rig): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // floor band
    const floorPx = this.sy(FLOOR_TOP);
    ctx.fillStyle = "#121216";
    ctx.fillRect(0, floorPx, this.canvas.width, this.canvas.height - floorPx);
    ctx.strokeStyle = "#2c2c34";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, floorPx); ctx.lineTo(this.canvas.width, floorPx);
    ctx.stroke();

    // (1) strings — each a smooth curve from its finger control point through the chain to the part.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    rig.strings.forEach((s, i) => {
      const top = s.control.translation();
      const pts: Vec2[] = [{ x: top.x, y: top.y }];
      for (const seg of s.segs) { const c = seg.translation(); pts.push({ x: c.x, y: c.y }); }
      const end = localToWorld(s.body, s.bodyAnchor);
      pts.push(end);
      ctx.strokeStyle = FINGER_COLORS[i % FINGER_COLORS.length];
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      this.smoothPath(pts);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // attach dot on the puppet
      ctx.fillStyle = FINGER_COLORS[i % FINGER_COLORS.length];
      ctx.beginPath();
      ctx.arc(this.sx(end.x), this.sy(end.y), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // (2) puppet capsules.
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

    // (3) finger control points — coloured discs numbered 1..5 (the puppeteer's fingertips on stage).
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    rig.controls.forEach((c, i) => {
      const t = c.translation();
      const px = this.sx(t.x), py = this.sy(t.y);
      ctx.fillStyle = FINGER_COLORS[i % FINGER_COLORS.length];
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d0d0f";
      ctx.fillText(String(i + 1), px, py + 0.5);
    });
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // Debug overlay: raw physics segments (every chain link + joint) + each chain's measured summed
  // length vs nominalLen (stretch%). For a rigid chain stretch stays ~0 however it folds.
  drawDebug(rig: Rig): void {
    const { ctx } = this;

    const buf = rig.world.debugRender();
    const v = buf.vertices, col = buf.colors;
    ctx.lineWidth = 1;
    for (let i = 0; i + 5 < v.length; i += 6) {
      const ci = (i / 3) * 4;
      const r = Math.round(col[ci] * 255), g = Math.round(col[ci + 1] * 255), b = Math.round(col[ci + 2] * 255);
      ctx.strokeStyle = `rgba(${r},${g},${b},${col[ci + 3] * 0.7})`;
      ctx.beginPath();
      ctx.moveTo(this.sx(v[i]), this.sy(v[i + 1]));
      ctx.lineTo(this.sx(v[i + 3]), this.sy(v[i + 4]));
      ctx.stroke();
    }

    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "top";
    let ty = 8;
    ctx.fillStyle = "#39d98a";
    ctx.fillText("physics chains — len / nominal  (stretch%)", 8, ty); ty += 15;
    let maxStretch = -Infinity;
    rig.strings.forEach((s) => {
      const top = s.control.translation();
      const nodes: Vec2[] = [{ x: top.x, y: top.y }];
      for (const seg of s.segs) { const c = seg.translation(); nodes.push({ x: c.x, y: c.y }); }
      nodes.push(localToWorld(s.body, s.bodyAnchor));
      let len = 0;
      for (let k = 1; k < nodes.length; k++) len += Math.hypot(nodes[k].x - nodes[k - 1].x, nodes[k].y - nodes[k - 1].y);
      const stretch = ((len - s.nominalLen) / s.nominalLen) * 100;
      maxStretch = Math.max(maxStretch, stretch);
      ctx.fillStyle = stretch > 0.3 ? "#ff5c5c" : "#9a9aa2";
      ctx.fillText(`${s.name.padEnd(13)} ${len.toFixed(2)} / ${s.nominalLen.toFixed(2)}  ${stretch >= 0 ? "+" : ""}${stretch.toFixed(2)}%`, 8, ty);
      ty += 13;
    });
    ctx.fillStyle = maxStretch > 0.3 ? "#ff5c5c" : "#39d98a";
    ctx.fillText(`max stretch: ${maxStretch >= 0 ? "+" : ""}${maxStretch.toFixed(2)}%`, 8, ty + 2);
    ctx.textBaseline = "alphabetic";
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

  // all 21 landmarks (dim)
  ctx.fillStyle = "#9a9aa2";
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(X(lm), Y(lm), 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // the 5 control fingertips — ringed in their finger colour with the finger number.
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  FINGERS.forEach((f, i) => {
    const lm = landmarks[f.landmark];
    const cx = X(lm), cy = Y(lm);
    ctx.fillStyle = FINGER_COLORS[i % FINGER_COLORS.length];
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0d0d0f";
    ctx.fillText(String(i + 1), cx, cy + 0.5);
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
