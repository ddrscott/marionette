import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { WORLD_VIEW_HEIGHT, FLOOR_TOP, WALL_OPENING, WALL_HALF_W, FINGERTIPS, limbAxisPoint, type Puppet, type PuppetString, type Vec2 } from "./puppet.ts";
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

// One capsule of a pose-target silhouette (a puppet part at its goal transform, enlarged for drawing).
export interface PoseSilPart { x: number; y: number; angle: number; half: number; rad: number; }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  scale = 80; // px per world unit; recomputed on resize from the FIXED world view height
  // The game/harness draw the fighting floor + center wall; the /characters demo turns BOTH off for a
  // clean stage (its world has no floor/wall either, so deselected puppets fall clean off the bottom).
  showFloor = true;
  showWall = true;

  constructor(readonly canvas: HTMLCanvasElement) {
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

  // Clear the canvas + draw the shared floor band. Call once per frame, before drawPuppet().
  clear(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // floor band
    if (this.showFloor) {
      const floorPx = this.sy(FLOOR_TOP);
      ctx.fillStyle = "#121216";
      ctx.fillRect(0, floorPx, this.canvas.width, this.canvas.height - floorPx);
      ctx.strokeStyle = "#2c2c34";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, floorPx); ctx.lineTo(this.canvas.width, floorPx);
      ctx.stroke();
    }

    if (!this.showWall) return;
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
  // `showControls` (default true) draws the numbered 1..5 control discs at each string's control
  // point. Callers SUPPRESS it during the attach ritual (waiting/attaching) so the ONLY numbered set
  // on screen is `drawFingerPoints` at the live fingertips — otherwise the two sets double up.
  drawPuppet(rig: Puppet, showControls = true): void {
    const { ctx } = this;

    // (1) strings — each a light line from its finger control point (the GOAL) to the part, pointing at
    // the fingertip every frame. Coloured by the puppet's TEAM (rust = left / P1, teal = right / P2). The
    // soft goal-drive carries no physics chain, so we draw the straight goal line with a gentle sag when
    // it's slack (anchor closer than the rest length). A CUT string drops its two ends as limp stubs.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const col = teamColor(rig.xOffset);
    rig.strings.forEach((s) => {
      const top = s.control.translation();
      const end = localToWorld(s.body, s.bodyAnchor);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      if (!s.cut) {
        const dx = end.x - top.x, dy = end.y - top.y;
        const dist = Math.hypot(dx, dy);
        const sag = Math.max(0, s.nominalLen - dist) * 0.5; // droop only while slack; straight when taut
        const midX = (top.x + end.x) / 2, midY = (top.y + end.y) / 2 - sag;
        ctx.beginPath();
        this.moveTo({ x: top.x, y: top.y });
        ctx.quadraticCurveTo(this.sx(midX), this.sy(midY), this.sx(end.x), this.sy(end.y));
        ctx.stroke();
      } else {
        // severed: two limp stubs dangling straight down from the fingertip and from the limb anchor.
        const stub = Math.min(0.8, s.nominalLen * 0.35);
        ctx.beginPath();
        this.moveTo({ x: top.x, y: top.y }); this.lineTo({ x: top.x, y: top.y - stub });
        this.moveTo(end); this.lineTo({ x: end.x, y: end.y - stub });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // attach dot on the puppet (the string's fixed end on the limb) — world-sized
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

    // (2b) weapons — a blade bolted PAST the limb tip (disjoint reach). Drawn in the weapon's own steel
    // colour so it reads as a held tool, not a limb; a slim highlight down the spine gives it an edge.
    // A disarmed blade is gone (its collider was removed).
    for (const part of rig.parts) {
      const w = part.weapon;
      if (!w || w.disarmed) continue;
      const base = limbAxisPoint(part, part.half);
      const tip = limbAxisPoint(part, part.half + w.def.reach);
      ctx.lineCap = "round";
      ctx.strokeStyle = w.def.color;
      ctx.lineWidth = Math.max(2, w.def.thickness * 2 * this.scale);
      ctx.beginPath();
      this.moveTo(base);
      this.lineTo(tip);
      ctx.stroke();
      // bright tip so the reach (the thing that matters for spacing) is easy to read
      ctx.fillStyle = "#eef0f3";
      ctx.beginPath();
      ctx.arc(this.sx(tip.x), this.sy(tip.y), Math.max(2, w.def.thickness * this.scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // (3) finger control points — coloured discs numbered 1..5 (the puppeteer's fingertips on stage).
    // Drawn per ATTACHED string (by finger slot); this is the single numbered set once the puppet is
    // "running". During the attach ritual the caller passes showControls=false and the live fingertip
    // discs (drawFingerPoints) are the single set instead, so the numbers never double.
    // Disc + number are sized in WORLD units (× this.scale) so they read the same at any resolution.
    if (!showControls) return;
    const discR = DISC_R_UNITS * this.scale;
    ctx.font = `bold ${DISC_FONT_UNITS * this.scale}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    rig.strings.forEach((s) => {
      if (s.cut) return; // severed string: no live control point
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

  // ---- character-select helpers (/characters) — all sized in world units so they scale with the canvas ----

  // A character's name under its preview. `active` = currently hovered (brightens + accent colour).
  // `maxWidthUnits` (optional): if the line would be wider than this many world units, the font is
  // shrunk to fit — so single-line HUD text (e.g. /pose's status + controls hint) never clips off the
  // edges of a narrow/portrait canvas. Omit it (the /characters callers do) to keep the fixed size.
  drawLabel(worldX: number, worldY: number, text: string, accent: string, active: boolean, maxWidthUnits?: number): void {
    const { ctx } = this;
    let fontUnits = active ? 0.44 : 0.36;
    ctx.font = `${fontUnits * this.scale}px "Russo One", ui-monospace, monospace`;
    if (maxWidthUnits && maxWidthUnits > 0) {
      const maxPx = maxWidthUnits * this.scale;
      const w = ctx.measureText(text).width;
      if (w > maxPx) { fontUnits *= maxPx / w; ctx.font = `${fontUnits * this.scale}px "Russo One", ui-monospace, monospace`; }
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = active ? accent : "rgba(216,212,204,0.7)";
    ctx.fillText(text, this.sx(worldX), this.sy(worldY));
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // Hover frame + fist-hold progress arc around a character card. progress 0..1 fills the frame.
  drawSelector(worldX: number, worldY: number, halfW: number, halfH: number, progress: number, accent: string): void {
    const { ctx } = this;
    const x = this.sx(worldX - halfW), y = this.sy(worldY + halfH);
    const w = halfW * 2 * this.scale, h = halfH * 2 * this.scale;
    const r = 0.18 * this.scale;
    const rr = (): void => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    ctx.fillStyle = "rgba(79,176,170,0.06)";
    rr(); ctx.fill();
    ctx.strokeStyle = "rgba(232,232,232,0.18)";
    ctx.lineWidth = Math.max(1.5, 0.03 * this.scale);
    rr(); ctx.stroke();
    if (progress > 0) {
      // a growing accent frame that closes as the fist-hold completes
      const perim = 2 * (w + h);
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, 0.05 * this.scale);
      ctx.setLineDash([perim * progress, perim]);
      rr(); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // The hand cursor on the select screen: a ring at the index-finger point; filled when a fist is held.
  drawCursor(worldX: number, worldY: number, color: string, closed: boolean): void {
    const { ctx } = this;
    const px = this.sx(worldX), py = this.sy(worldY);
    const r = 0.22 * this.scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, 0.04 * this.scale);
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = closed ? color : "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.arc(px, py, closed ? r * 0.6 : r * 0.28, 0, Math.PI * 2); ctx.fill();
  }

  // Big centered banner text (e.g. "PICK YOUR FIGHTER" / "raise a hand"). `y` in world units.
  drawBanner(worldY: number, text: string, sub: string): void {
    const { ctx } = this;
    const cx = this.canvas.width / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${0.72 * this.scale}px "Russo One", ui-monospace, monospace`;
    ctx.fillStyle = "rgba(232,232,232,0.92)";
    ctx.fillText(text, cx, this.sy(worldY));
    if (sub) {
      ctx.font = `${0.34 * this.scale}px "Rajdhani", ui-monospace, monospace`;
      ctx.fillStyle = "rgba(232,232,232,0.55)";
      ctx.fillText(sub, cx, this.sy(worldY) + 0.6 * this.scale);
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // A pose target as a "chalk outline" silhouette (the /pose game): the puppet's own capsule parts at
  // the goal transforms, enlarged a touch, filled BLACK with a WHITE outline — the shape you nestle the
  // live puppet into. A part's outline turns GREEN once it's matched. `parts` are world-space
  // {x,y,angle,half,rad} index-aligned with the puppet; `hold` (0..1) draws the closing lock arc.
  // Trick for a clean union: stroke every part's OUTLINE (thick) first, then every part's BLACK fill
  // (thinner) on top — the fills cover internal seams so only the outer rim shows.
  drawPoseTarget(parts: PoseSilPart[], inZone: boolean[], rootIndex = 0, hold = 0): void {
    const { ctx } = this;
    ctx.lineCap = "round";
    const ends = (p: PoseSilPart): [Vec2, Vec2] => {
      const c = Math.cos(p.angle), s = Math.sin(p.angle);
      return [{ x: p.x - p.half * s, y: p.y + p.half * c }, { x: p.x + p.half * s, y: p.y - p.half * c }];
    };
    // outline layer (white, green where matched)
    parts.forEach((p, i) => {
      const [e1, e2] = ends(p);
      ctx.strokeStyle = inZone[i] ? "#7bd88f" : "#f2f2f2";
      ctx.lineWidth = p.rad * 2 * this.scale + Math.max(3, 0.05 * this.scale);
      ctx.beginPath(); this.moveTo(e1); this.lineTo(e2); ctx.stroke();
    });
    // black fill on top (smaller, so the outline reads as a rim and seams disappear)
    ctx.strokeStyle = "#0b0b0d";
    parts.forEach((p) => {
      const [e1, e2] = ends(p);
      ctx.lineWidth = p.rad * 2 * this.scale;
      ctx.beginPath(); this.moveTo(e1); this.lineTo(e2); ctx.stroke();
    });
    // hold-to-lock arc around the root part
    if (hold > 0) {
      const r = parts[rootIndex];
      const px = this.sx(r.x), py = this.sy(r.y), rad = (r.half + r.rad) * this.scale;
      ctx.strokeStyle = "#7bd88f";
      ctx.lineWidth = Math.max(3, 0.06 * this.scale);
      ctx.beginPath(); ctx.arc(px, py, rad, -Math.PI / 2, -Math.PI / 2 + hold * Math.PI * 2); ctx.stroke();
    }
  }

  // Debug overlay: raw physics bodies (puppet parts + internal joints) + each string's current
  // chord / rest length (stretch%). With the soft goal-drive there are no chain segments — a string's
  // stretch is how far the limb anchor lags past the captured rest length as the capped spring loads.
  drawDebug(world: RAPIER_NS.World, strings: PuppetString[]): void {
    const { ctx } = this;

    // Batch ALL physics colliders into ONE path + one stroke (per-shape beginPath/stroke is a canvas
    // perf killer). We drop Rapier's per-vertex colours for one uniform debug colour.
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
    ctx.fillText("soft strings — chord / rest  (stretch%)", 8, ty); ty += 15;
    let maxStretch = -Infinity;
    strings.forEach((s) => {
      const top = s.control.translation();
      const end = localToWorld(s.body, s.bodyAnchor);
      const chord = Math.hypot(end.x - top.x, end.y - top.y);
      const stretch = ((chord - s.nominalLen) / s.nominalLen) * 100;
      maxStretch = Math.max(maxStretch, stretch);
      const label = s.cut ? "CUT" : `${stretch >= 0 ? "+" : ""}${stretch.toFixed(1)}%`;
      ctx.fillStyle = s.cut ? "#6a6a72" : stretch > 8 ? TEAM_DANGER : "#9a9aa2";
      ctx.fillText(`${s.name.padEnd(13)} ${chord.toFixed(2)} / ${s.nominalLen.toFixed(2)}  ${label}`, 8, ty);
      ty += 13;
    });
    ctx.fillStyle = maxStretch > 8 ? TEAM_DANGER : TEAM_TEAL;
    ctx.fillText(`max stretch: ${maxStretch >= 0 ? "+" : ""}${maxStretch.toFixed(1)}%`, 8, ty + 2);
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
