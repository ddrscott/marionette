import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { WORLD_VIEW_HEIGHT, FLOOR_TOP, WALL_OPENING, WALL_HALF_W, FINGERTIPS, type Puppet, type PuppetString, type Vec2 } from "./puppet.ts";
import { HAND_CONNECTIONS, type Landmark } from "./hands.ts";

// Duotone team colours (must match style.css `--rust` / `--teal`). Colour is carried by the PLAYER,
// not the finger: the left puppet (`xOffset < 0`) is rust / Player 1, the right is teal / Player 2.
// Fingers stay distinguishable by the 1..5 number labels on each control disc / overlay ring, not hue.
export const TEAM_RUST = "#c46a45"; // Player 1 (left)  / warm
export const TEAM_TEAL = "#4fb0aa"; // Player 2 (right) / cool + UI accent
const TEAM_DANGER = "#e2512a";      // intensified rust — debug stretch/warning (stays in the warm family)
// Team colour for a world x-offset (or any world-x): left of centre = rust, right = teal.
export const teamColor = (worldX: number): string => (worldX < 0 ? TEAM_RUST : TEAM_TEAL);

// The attach-ritual prompt art: a LEFT-hand SVG (public/hand-left.svg). Its outline is black, which
// disappears on the dark stage, so on load we re-tint every opaque pixel to #808080 on an offscreen
// canvas (drawImage + `source-in` fill) and draw THAT. Mirrored horizontally for the right-side
// prompt so it reads as a right hand. Aspect is taken from the viewBox (678x501) so layout doesn't
// depend on the browser's intrinsic-size handling of SVG <img>.
const HAND_AR = 678 / 501;
const HAND_TINT = "#808080";
const HAND_IMG = new Image();
let HAND_TINTED: HTMLCanvasElement | null = null;
HAND_IMG.onload = () => {
  const iw = HAND_IMG.naturalWidth || 678, ih = HAND_IMG.naturalHeight || 501;
  const off = document.createElement("canvas");
  off.width = iw; off.height = ih;
  const g = off.getContext("2d");
  if (g) {
    g.drawImage(HAND_IMG, 0, 0, iw, ih);
    g.globalCompositeOperation = "source-in"; // keep the hand's shape, replace its colour
    g.fillStyle = HAND_TINT;
    g.fillRect(0, 0, iw, ih);
    HAND_TINTED = off;
  }
};
HAND_IMG.src = "/hand-left.svg";

// Canvas-text sizing in WORLD UNITS (multiplied by `scale` = px per world unit at draw time) so every
// glyph/disc scales with the canvas instead of staying a fixed pixel size (the readability fix). Tuned
// to read clearly at the 1280×800 reference (world height 12 → scale ≈ 67 px/unit).
const DISC_R_UNITS = 0.14;      // finger control-point / fingertip disc radius (~9px @ ref)
const DISC_FONT_UNITS = 0.24;   // the 1..5 number inside a disc (~16px @ ref)
const PROMPT_FONT_UNITS = 0.40; // "raise a hand" / "hold still…" label (~27px @ ref)

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

  // Clear the canvas + draw the shared floor band. Call once per frame, before drawPuppet().
  clear(): void {
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

    // center divider wall — from the top of the view down to the opening (a gap remains near the floor)
    const wallW = Math.max(2, WALL_HALF_W * 2 * this.scale);
    const wallX = this.sx(0);
    const openTopPx = this.sy(FLOOR_TOP + WALL_OPENING);
    ctx.fillStyle = "#15151b";
    ctx.fillRect(wallX - wallW / 2, 0, wallW, openTopPx);
    ctx.strokeStyle = "#2c2c34";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wallX - wallW / 2, 0); ctx.lineTo(wallX - wallW / 2, openTopPx);
    ctx.moveTo(wallX + wallW / 2, 0); ctx.lineTo(wallX + wallW / 2, openTopPx);
    ctx.stroke();
  }

  // Draw one puppet (strings + capsules + control discs). Does NOT clear — call clear() first.
  drawPuppet(rig: Puppet): void {
    const { ctx } = this;

    // (1) strings — each a smooth curve from its finger control point through the chain to the part.
    // Coloured by the puppet's TEAM (rust = left / P1, teal = right / P2), shared by all five strings.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const col = teamColor(rig.xOffset);
    rig.strings.forEach((s) => {
      const top = s.control.translation();
      const controlPt: Vec2 = { x: top.x, y: top.y };
      const segPts: Vec2[] = s.segs.map((seg) => { const c = seg.translation(); return { x: c.x, y: c.y }; });
      const end = localToWorld(s.body, s.bodyAnchor);
      const stroke = (pts: Vec2[]) => {
        if (pts.length < 2) return;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        this.smoothPath(pts);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      if (s.cutJoint === null) {
        stroke([controlPt, ...segPts, end]);
      } else {
        // severed at the hinge above seg[cutJoint]: upper half hangs from the control, lower from the part.
        stroke([controlPt, ...segPts.slice(0, s.cutJoint)]);
        stroke([...segPts.slice(s.cutJoint), end]);
      }
      // attach dot on the puppet (the body end stays attached to the lower half) — world-sized
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(this.sx(end.x), this.sy(end.y), Math.max(2, 0.05 * this.scale), 0, Math.PI * 2);
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
    // Drawn per ATTACHED string (by finger slot), so during the attach ritual discs pop in one at a
    // time with their strings, and a detached/waiting puppet shows none.
    // Disc + number are sized in WORLD units (× this.scale) so they read the same at any resolution.
    const discR = DISC_R_UNITS * this.scale;
    ctx.font = `bold ${DISC_FONT_UNITS * this.scale}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    rig.strings.forEach((s) => {
      if (s.cutJoint !== null) return; // severed string: no live control point
      const t = s.control.translation();
      const px = this.sx(t.x), py = this.sy(t.y);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, discR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d0d0f";
      ctx.fillText(String(s.slot + 1), px, py);
    });
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // ---- attach-ritual prompt: the hand outline ABOVE the puppet (`worldX` = the puppet's home x) in
  // the top third, ~30% of screen height. `side` 0 = left hand as-is, 1 = mirrored -> right hand.
  // Shown while WAITING (gentle pulse) or STEADYING (brightens + a progress bar fills 0->1). The user
  // lines their live fingertip points (drawFingerPoints) up with this outline to calibrate.
  drawPrompt(worldX: number, side: 0 | 1, progress: number, now: number): void {
    const { ctx } = this;
    const h = this.canvas.height;
    const cx = this.sx(worldX);      // horizontally above the puppet
    const cy = h * (1 / 6 + 0.10);   // top third, dropped 10% of view height (matches the puppet drop)
    const hh = 0.30 * h;             // ~30% of screen height
    const hw = hh * HAND_AR;

    if (HAND_TINTED) {
      const a = progress > 0 ? 0.6 + 0.4 * progress : 0.45 + 0.22 * Math.sin(now / 350);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy);
      if (side === 1) ctx.scale(-1, 1); // left-hand art -> right hand for the right side
      ctx.drawImage(HAND_TINTED, -hw / 2, -hh / 2, hw, hh);
      ctx.restore();
    }

    // progress bar + label under the hand — all sized in world units so they scale with the canvas.
    const by = cy + hh / 2 + 0.18 * this.scale;
    const barH = Math.max(4, 0.07 * this.scale);
    const bw = Math.min(hw * 0.6, 2.6 * this.scale), bx = cx - bw / 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(bx, by, bw, barH);
    if (progress > 0) { ctx.fillStyle = teamColor(worldX); ctx.fillRect(bx, by, bw * progress, barH); }
    ctx.font = `${PROMPT_FONT_UNITS * this.scale}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(232,232,232,0.85)";
    ctx.fillText(progress > 0 ? "hold still…" : "raise a hand", cx, by + barH + 0.16 * this.scale);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // The live fingertip control points during calibration — in the puppet's TEAM colour, numbered 1..5
  // by finger slot — so the user can line them up with the hand outline before the strings attach.
  drawFingerPoints(pts: Vec2[], color: string): void {
    const { ctx } = this;
    const discR = DISC_R_UNITS * this.scale; // world-sized disc + number, matching drawPuppet's discs
    ctx.font = `bold ${DISC_FONT_UNITS * this.scale}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    pts.forEach((p, i) => {
      const px = this.sx(p.x), py = this.sy(p.y);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, discR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0d0d0f";
      ctx.fillText(String(i + 1), px, py);
    });
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // Debug overlay: raw physics segments (every chain link + joint) + each chain's measured summed
  // length vs nominalLen (stretch%). For a rigid chain stretch stays ~0 however it folds.
  drawDebug(world: RAPIER_NS.World, strings: PuppetString[]): void {
    const { ctx } = this;

    // Batch ALL physics segments into ONE path + one stroke. (Per-segment beginPath/stroke is the
    // canvas perf killer — at ~hundreds of segments × 2 puppets it dominated the frame and pinned
    // fps to 30.) We drop Rapier's per-vertex colours for one uniform debug colour; the shapes still
    // read fine, and it's ~1 draw call instead of hundreds.
    const buf = world.debugRender();
    const v = buf.vertices;
    ctx.strokeStyle = "rgba(120,180,180,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i + 5 < v.length; i += 6) {
      ctx.moveTo(this.sx(v[i]), this.sy(v[i + 1]));
      ctx.lineTo(this.sx(v[i + 3]), this.sy(v[i + 4]));
    }
    ctx.stroke();

    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "top";
    let ty = 8;
    ctx.fillStyle = TEAM_TEAL;
    ctx.fillText("physics chains — len / nominal  (stretch%)", 8, ty); ty += 15;
    let maxStretch = -Infinity;
    strings.forEach((s) => {
      const top = s.control.translation();
      const nodes: Vec2[] = [{ x: top.x, y: top.y }];
      for (const seg of s.segs) { const c = seg.translation(); nodes.push({ x: c.x, y: c.y }); }
      nodes.push(localToWorld(s.body, s.bodyAnchor));
      let len = 0;
      for (let k = 1; k < nodes.length; k++) len += Math.hypot(nodes[k].x - nodes[k - 1].x, nodes[k].y - nodes[k - 1].y);
      const stretch = ((len - s.nominalLen) / s.nominalLen) * 100;
      maxStretch = Math.max(maxStretch, stretch);
      ctx.fillStyle = stretch > 0.3 ? TEAM_DANGER : "#9a9aa2";
      ctx.fillText(`${s.name.padEnd(13)} ${len.toFixed(2)} / ${s.nominalLen.toFixed(2)}  ${stretch >= 0 ? "+" : ""}${stretch.toFixed(2)}%`, 8, ty);
      ty += 13;
    });
    ctx.fillStyle = maxStretch > 0.3 ? TEAM_DANGER : TEAM_TEAL;
    ctx.fillText(`max stretch: ${maxStretch >= 0 ? "+" : ""}${maxStretch.toFixed(2)}%`, 8, ty + 2);
    ctx.textBaseline = "alphabetic";
  }
}

// ---- hand-landmark overlay (drawn already-mirrored to match the flipped preview) ----
// Draws BOTH players' hands. Each hand maps to a slot (0 = left player, 1 = right player); its 5
// driving fingertips are ringed in that player's TEAM colour (`colors[i]`) and numbered 1..5, so the
// finger→string mapping reads by number while the colour tells the two players apart.
export function drawHands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hands: (Landmark[] | null)[],
  colors: string[],
): void {
  ctx.clearRect(0, 0, w, h);
  hands.forEach((landmarks, i) => {
    if (landmarks) drawOneHand(ctx, w, h, landmarks, colors[i] ?? TEAM_TEAL);
  });
}

function drawOneHand(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: Landmark[], color: string): void {
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

  // the 5 driving fingertips — ringed in this player's TEAM colour with the finger number 1..5.
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  FINGERTIPS.forEach((landmark, i) => {
    const lm = landmarks[landmark];
    const cx = X(lm), cy = Y(lm);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0d0d0f";
    ctx.fillText(String(i + 1), cx, cy + 0.5);
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
