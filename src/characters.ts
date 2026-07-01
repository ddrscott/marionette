// /characters — the roster demo / testbed. A grid of all ten rigs (rigs.ts): hover a fighter with
// your hand and make a FIST to pick it. The chosen one snaps to a neutral centre pose while the other
// nine drop off the bottom under gravity; then you hold still over the placeholder hand to attach its
// strings and try it out (same ritual as the game, via Pilot). Take your hand out of view to reset
// back to the select screen and pick another.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, buildRig, removePuppet, reposePuppet, setPuppetWeight,
  DEFAULT_LINEAR_DAMPING, DEFAULT_STRING_FRICTION, DEFAULT_PUPPET_WEIGHT, WORLD_VIEW_HEIGHT,
  type Puppet, type Vec2,
} from "./puppet.ts";
import { RIGS } from "./rigs.ts";
import { Pilot, type PilotCfg } from "./pilot.ts";
import { Renderer, drawHands, teamColor, TEAM_TEAL } from "./draw.ts";
import { HandCursor } from "./handCursor.ts";
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import { makeCamDraggable } from "./dragCam.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");

const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";
const GRAVITY = 20;

// ---- select-screen tuning ----
const ROW_Y = [8.5, 4.3];        // root y of the top / bottom grid rows
const CARD_DY = -0.3;            // card centre relative to the root (visual middle of the preview)
const CARD_HALF_H = 1.7;
const LABEL_DY = -1.75;          // name label offset below the root
const RESET_MS = 1200;           // hand gone this long during tryout -> back to select

// column gap + a fighter's grid centre, derived live from the visible width so the grid reflows on resize
const colGap = (W: number): number => W / 5;
const gridCenter = (i: number, W: number): Vec2 => ({ x: (i % 5 - 2) * colGap(W), y: ROW_Y[i < 5 ? 0 : 1] });

(async function main() {
  try {
    await RAPIER.init();
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;

    const world = buildWorld(RAPIER, GRAVITY, { wall: false, floor: false }); // clean stage, nothing to foul strings
    const renderer = new Renderer(scene);
    renderer.showFloor = false;
    renderer.showWall = false;

    const overlayCtx = camOverlay.getContext("2d")!;
    const sizeOverlay = (): void => { camOverlay.width = camOverlay.clientWidth; camOverlay.height = camOverlay.clientHeight; };
    sizeOverlay();
    new ResizeObserver(() => { renderer.resize(); sizeOverlay(); }).observe(scene);

    const hands = await initHands(video, { deviceId: localStorage.getItem(LS_DEVICE), tier });

    // Live tunables the Pilot reads (worldWidth refreshed each frame so a resize is picked up).
    const cfg: PilotCfg = {
      worldWidth: renderer.worldWidth,
      playMargin: 0.10, swingRange: 1.0, smoothTime: 0.01,
      drag: DEFAULT_LINEAR_DAMPING, friction: DEFAULT_STRING_FRICTION,
    };

    // ---- state ----
    let mode: "select" | "try" = "select";
    let grid: Puppet[] = [];
    let fallers: Puppet[] = [];
    let chosen: Puppet | null = null;
    let selIdx = -1;
    let pilot: Pilot | null = null;
    let hover = -1;
    let lastHandT = performance.now();
    const cursor = new HandCursor(); // shared palm-cursor + fist-to-click (same model as the keyboard)

    const buildGrid = (): void => {
      const W = renderer.worldWidth;
      grid = RIGS.map((def, i) => buildRig(RAPIER, world, gridCenter(i, W), def));
    };
    buildGrid();

    const toSelect = (): void => {
      if (chosen) { removePuppet(world, chosen); chosen = null; }
      for (const f of fallers) removePuppet(world, f);
      fallers = [];
      pilot = null;
      selIdx = -1; hover = -1;
      buildGrid();
      mode = "select";
    };

    const pick = (i: number): void => {
      selIdx = i;
      chosen = grid[i];
      fallers = grid.filter((_, k) => k !== i);
      grid = [];
      // neutral centre pose to try it from (no wall now, so centre is safe)
      chosen.homeTorso = { x: 0, y: 4.6 };
      chosen.xOffset = 0;
      setPuppetWeight(chosen, DEFAULT_PUPPET_WEIGHT);
      reposePuppet(chosen, chosen.homeTorso);
      // let the rest drop away with a little outward scatter
      fallers.forEach((f, k) => {
        const dir = f.homeTorso.x >= 0 ? 1 : -1;
        for (const part of f.parts) part.body.setLinvel({ x: dir * (1.5 + (k % 3)), y: -1.5, z: 0 }, true);
      });
      pilot = new Pilot(RAPIER, world, chosen, cfg);
      lastHandT = performance.now();
      mode = "try";
    };

    makeCamDraggable($("camBox"), $("charstage")); // drag the self-view anywhere; clamped + persisted
    $("boot").remove();

    let lastT = performance.now();
    const loop = (): void => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      cfg.worldWidth = renderer.worldWidth;
      world.gravity = { x: 0, y: -GRAVITY, z: 0 };

      hands.pump(now);
      const det = hands.latest[0] ?? null;
      const lm = det ? det.landmarks : null;
      if (lm) lastHandT = now;

      const W = renderer.worldWidth;

      if (mode === "select") {
        // hold every fighter at its grid cell (reflows with the width)
        grid.forEach((p, i) => reposePuppet(p, gridCenter(i, W)));
        world.step();

        renderer.clear();
        // header
        renderer.drawLabel(0, 11.3, "PICK YOUR FIGHTER", TEAM_TEAL, true);
        renderer.drawLabel(0, 10.75, lm ? "hover a fighter and make a fist" : "raise a hand to choose", "#9a968e", false);

        // shared camera cursor: palm centre points (margin-mapped so you reach the edges), fist to click
        const cs = cursor.read(det, now);
        const curX = (cs.x - 0.5) * W;
        const curY = (1 - cs.y) * WORLD_VIEW_HEIGHT;

        // which card is under the cursor?
        hover = -1;
        if (cs.present) {
          const hw = colGap(W) * 0.42;
          for (let i = 0; i < RIGS.length; i++) {
            const c = gridCenter(i, W);
            if (Math.abs(curX - c.x) < hw && Math.abs(curY - (c.y + CARD_DY)) < CARD_HALF_H) { hover = i; break; }
          }
        }

        grid.forEach((p, i) => {
          const c = gridCenter(i, W);
          const active = i === hover;
          renderer.drawSelector(c.x, c.y + CARD_DY, colGap(W) * 0.42, CARD_HALF_H, 0, RIGS[i].accent);
          renderer.drawPuppet(p);
          renderer.drawLabel(c.x, c.y + LABEL_DY, RIGS[i].name, RIGS[i].accent, active);
        });

        // close your fist over a fighter to pick it (rising-edge click, debounced)
        if (cs.present && hover >= 0 && cs.clicked) pick(hover);

        if (cs.present) renderer.drawCursor(curX, curY, TEAM_TEAL, cs.closed);
      } else if (mode === "try" && chosen && pilot) {
        pilot.feed(lm, now);
        pilot.update(now, dt);
        world.step();

        renderer.clear();
        // the deselected fighters falling away — draw, then cull once off the bottom
        for (const f of fallers) renderer.drawPuppet(f);
        fallers = fallers.filter((f) => {
          if (f.torso.translation().y < -3) { removePuppet(world, f); return false; }
          return true;
        });

        renderer.drawPuppet(chosen);
        const ph = pilot.phase;
        if (ph === "waiting" || ph === "steadying" || ph === "attaching") {
          renderer.drawPrompt(chosen.xOffset, 0, pilot.steadyProgress(now), now);
          if ((ph === "steadying" || ph === "attaching") && pilot.present) {
            renderer.drawFingerPoints(pilot.pos, teamColor(chosen.xOffset));
          }
        }
        renderer.drawLabel(0, 11.3, RIGS[selIdx].name, RIGS[selIdx].accent, true);
        renderer.drawLabel(0, 10.75, "hold still to attach · take your hand away to switch", "#9a968e", false);

        if (now - lastHandT > RESET_MS) toSelect();
      }

      drawHands(overlayCtx, camOverlay.width, camOverlay.height, [lm], [TEAM_TEAL]);
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost and use Chrome.</pre>`;
  }
})();
