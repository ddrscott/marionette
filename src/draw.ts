import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { WORLD_VIEW_HEIGHT, FLOOR_TOP, type Rig, type Vec2 } from "./puppet.ts";
import { HAND_CONNECTIONS, type Landmark } from "./hands.ts";

// Bodies rotate only about Z, so the world rotation is a single angle.
const zAngle = (q: RAPIER_NS.Rotation): number => 2 * Math.atan2(q.z, q.w);

// How far (in world units, per world unit of rope slack) a loose rope's bezier control point sags
// downward under "gravity". The mid-curve drops ~half this (quadratic), so the visible sag is
// ~slack * ROPE_SAG_GRAVITY / 2. Higher = droopier. The px conversion happens via sx/sy (scale).
const ROPE_SAG_GRAVITY = 0.85;

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

  // Visible world width (units): WORLD_VIEW_HEIGHT scaled by the canvas aspect. The control's
  // horizontal reach maps the full detection range (stage-x ∈ [-0.5,0.5]) onto this width.
  get worldWidth(): number { return this.canvas.width / this.scale; }

  private sx(x: number): number { return this.canvas.width / 2 + x * this.scale; }
  private sy(y: number): number { return this.canvas.height - y * this.scale; }
  private lineTo(p: Vec2): void { this.ctx.lineTo(this.sx(p.x), this.sy(p.y)); }
  private moveTo(p: Vec2): void { this.ctx.moveTo(this.sx(p.x), this.sy(p.y)); }

  // Stroke a smooth curve through world-space points (quadratics with midpoints as on-curve
  // joins, original points as controls). Endpoints are hit exactly; interior kinks are rounded
  // off — used so the segmented center chain reads as one continuous string.
  private smoothPath(pts: Vec2[]): void {
    const { ctx } = this;
    this.moveTo(pts[0]);
    if (pts.length < 3) { for (let i = 1; i < pts.length; i++) this.lineTo(pts[i]); return; }
    let i = 1;
    for (; i < pts.length - 2; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(this.sx(pts[i].x), this.sy(pts[i].y), this.sx(mx), this.sy(my));
    }
    ctx.quadraticCurveTo(this.sx(pts[i].x), this.sy(pts[i].y), this.sx(pts[i + 1].x), this.sy(pts[i + 1].y));
  }

  draw(rig: Rig): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // floor: a ground band the puppet can rest on when the control is lowered.
    const floorPx = this.sy(FLOOR_TOP);
    ctx.fillStyle = "#121216";
    ctx.fillRect(0, floorPx, this.canvas.width, this.canvas.height - floorPx);
    ctx.strokeStyle = "#2c2c34";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, floorPx); ctx.lineTo(this.canvas.width, floorPx);
    ctx.stroke();

    // The control body carries only ROLL (in-plane Z); pitch/yaw already live in the posed
    // anchor positions (rig.posedAnchors / rig.barTip). Transform a posed control-local point to
    // world by applying the body's roll then its translation — this lands on exactly the anchor
    // points the solver uses, so the strings always stay attached to the foreshortened "+".
    const ct = rig.control.translation();
    const cr = rig.control.rotation();
    const cz = 2 * Math.atan2(cr.z, cr.w); // roll angle
    const cc = Math.cos(cz), cs = Math.sin(cz);
    const controlPt = (a: Vec2): Vec2 => ({
      x: ct.x + a.x * cc - a.y * cs,
      y: ct.y + a.x * cs + a.y * cc,
    });

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
    rig.strings.forEach((s, i) => {
      const top = controlPt(rig.posedAnchors[i]); // posed (foreshortened) attach point
      const end = localToWorld(s.body, s.bodyAnchor);
      if (s.kind === "chain") {
        // taut center string: draw a smooth curve through the chain nodes so it reads as one
        // continuous string, not 5 visible segments.
        const pts: Vec2[] = [top];
        for (const seg of s.segs) { const c = seg.translation(); pts.push({ x: c.x, y: c.y }); }
        pts.push(end);
        ctx.strokeStyle = "#c9c9d2";
        ctx.lineWidth = 2;
        ctx.beginPath();
        this.smoothPath(pts);
        ctx.stroke();
      } else {
        // loose limb rope: bend it into a smooth bezier whose sag tracks the LIVE slack
        // (maxLength - endpoint distance, clamped >=0). Slack->0 (control takes it up) => the
        // control point collapses onto the chord and the curve straightens to the taut line.
        const dist = Math.hypot(top.x - end.x, top.y - end.y);
        const slack = Math.max(0, s.maxLength - dist);
        // gravity pulls the midpoint DOWN (-world Y); a quadratic CP at 2x gives ~slack*GRAV sag.
        const cp: Vec2 = { x: (top.x + end.x) / 2, y: (top.y + end.y) / 2 - slack * ROPE_SAG_GRAVITY };
        ctx.strokeStyle = "rgba(201,201,210,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.moveTo(top);
        ctx.quadraticCurveTo(this.sx(cp.x), this.sy(cp.y), this.sx(end.x), this.sy(end.y));
        ctx.stroke();
      }
      // attach dot on the puppet — marks the control point (and the customization handle).
      ctx.fillStyle = "#39d98a";
      ctx.beginPath();
      ctx.arc(this.sx(end.x), this.sy(end.y), 3, 0, Math.PI * 2);
      ctx.fill();
    });

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

    // (4) the horizontal control bar ("+") on top — drawn from the SAME posed anchors as the
    // strings, so it foreshortens with pitch/yaw and the strings stay welded to the bar tips.
    // strings index order (see ATTACH): 0 head, 1 lShoulder, 2 rShoulder, 3 lowerBack.
    ctx.strokeStyle = "#caa46a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    this.moveTo(controlPt(rig.posedAnchors[1])); this.lineTo(controlPt(rig.posedAnchors[2])); // horizontal
    this.moveTo(controlPt(rig.barTip)); this.lineTo(controlPt(rig.posedAnchors[3]));           // vertical
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
