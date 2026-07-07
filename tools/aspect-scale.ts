// Headless / analytic guard for the camera→screen aspect-correct mapping (no webcam, no DOM).
// Proves the properties the task requires:
//
//   (1) UNIFORM & ASPECT-CORRECT — for any viewport aspect, the world motion per unit of PHYSICAL
//       camera distance is EQUAL on x and y (isotropic). Because normalized landmark x/y span
//       different physical extents (camW vs camH px), that means scaleX / cameraAspect === scaleY.
//   (2) FIT — the whole camera field maps INSIDE the play area (nothing unreachable): scaleX <=
//       worldWidth and scaleY <= viewHeight, touching at least one edge.
//   (3) 16:10 landscape is height-limited → scaleY === viewHeight (the tuned vertical feel is kept),
//       and the LEGACY map (cameraAspect = 0) reproduces the old { worldWidth, viewHeight } exactly.
//   (4) The handCursor FILL reduces to the plain remap when field aspect === camera aspect, and is
//       isotropic on screen (equal screen px per camera px on both axes) when they differ.
//
//   npx tsx tools/aspect-scale.ts
import { stageScale, stageX, stageY } from "../src/control.ts";
import { mapCursor } from "../src/handCursor.ts";

const VIEW = 12; // WORLD_VIEW_HEIGHT
const CAM = 640 / 480; // 480p default camera aspect (4:3)
const EPS = 1e-9;

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

// A representative fingertip landmark (only x/y matter here) for the stageX/stageY sanity check.
const lm = (x: number, y: number) => ({ x, y });
// A full 21-landmark hand where every PALM landmark (0,5,9,13,17) sits at (x,y) — so palmCentroid
// returns exactly (x,y). Used by the handCursor checks.
const palmAt = (x: number, y: number) => Array.from({ length: 21 }, () => ({ x, y, z: 0 }));

// worldWidth for a canvas of the given aspect (width/height): worldWidth = viewHeight * canvasAspect.
const worldWidthFor = (canvasAspect: number): number => VIEW * canvasAspect;

const CASES: { name: string; canvasAspect: number }[] = [
  { name: "portrait  9:16 ", canvasAspect: 9 / 16 },
  { name: "portrait  3:4  ", canvasAspect: 3 / 4 },
  { name: "square    1:1  ", canvasAspect: 1 },
  { name: "landscape 16:10", canvasAspect: 16 / 10 },
  { name: "landscape 21:9 ", canvasAspect: 21 / 9 },
];

console.log("== (1) uniform + aspect-correct: x/y sensitivity equal per physical camera unit ==");
for (const { name, canvasAspect } of CASES) {
  const ww = worldWidthFor(canvasAspect);
  const { scaleX, scaleY } = stageScale(ww, VIEW, CAM);
  // world units per unit of PHYSICAL camera distance:
  //   x: |d(worldX)/d(lm.x)| / (physical px per lm.x) = scaleX / camW = scaleX / CAM  (camW=CAM,camH=1)
  //   y: scaleY / camH = scaleY
  const sensX = scaleX / CAM;
  const sensY = scaleY;
  ok(near(sensX, sensY), `${name}  sensX=${sensX.toFixed(4)} sensY=${sensY.toFixed(4)} (ratio ${(sensX / sensY).toFixed(6)})`);
}

console.log("\n== (2) FIT: whole camera field inside the play area (nothing unreachable) ==");
for (const { name, canvasAspect } of CASES) {
  const ww = worldWidthFor(canvasAspect);
  const { scaleX, scaleY } = stageScale(ww, VIEW, CAM);
  const inside = scaleX <= ww + EPS && scaleY <= VIEW + EPS;
  const touches = near(scaleX, ww, 1e-6) || near(scaleY, VIEW, 1e-6);
  ok(inside && touches, `${name}  scaleX=${scaleX.toFixed(3)}<=${ww.toFixed(3)}  scaleY=${scaleY.toFixed(3)}<=${VIEW}  touch=${touches}`);
}

console.log("\n== (3) 16:10 keeps Y (tuned feel) + legacy map unchanged ==");
{
  const ww = worldWidthFor(16 / 10); // 19.2
  const fit = stageScale(ww, VIEW, CAM);
  ok(near(fit.scaleY, VIEW), `16:10 FIT scaleY === viewHeight (${fit.scaleY})`);
  ok(fit.scaleX < ww, `16:10 FIT scaleX (${fit.scaleX.toFixed(3)}) < legacy worldWidth (${ww}) — X corrected, not stretched`);
  const legacy = stageScale(ww, VIEW, 0);
  ok(near(legacy.scaleX, ww) && near(legacy.scaleY, VIEW), `legacy map === { worldWidth=${ww}, viewHeight=${VIEW} } (byte-identical /game)`);
}

console.log("\n== sanity: stageX/stageY unchanged (centered ~[-0.5,0.5], selfie-mirror) ==");
ok(near(stageX(lm(0, 0)), 0.5) && near(stageX(lm(1, 0)), -0.5), "stageX mirrors + centers");
ok(near(stageY(lm(0, 0)), 0.5) && near(stageY(lm(0, 1)), -0.5), "stageY centers");

console.log("\n== (4) handCursor FILL: identical at matching aspect, isotropic when it differs ==");
{
  const margin = 0.25;
  // matching aspect → identical to plain remap
  const a = mapCursor(palmAt(0.3, 0.6), margin);
  const b = mapCursor(palmAt(0.3, 0.6), margin, { cameraAspect: CAM, fieldAspect: CAM });
  ok(near(a.x, b.x) && near(a.y, b.y), `matching aspect reduces to plain remap (${a.x.toFixed(4)},${a.y.toFixed(4)})`);

  // differing aspect → equal screen px per physical camera px on both axes (isotropic).
  // Field: a portrait phone-ish 9:16 element of 400×711 px; camera 4:3.
  const fieldW = 400, fieldH = 711, fa = fieldW / fieldH;
  const d = 0.02; // small landmark delta
  const base = mapCursor(palmAt(0.5, 0.5), margin, { cameraAspect: CAM, fieldAspect: fa });
  const dx = mapCursor(palmAt(0.5 + d, 0.5), margin, { cameraAspect: CAM, fieldAspect: fa });
  const dy = mapCursor(palmAt(0.5, 0.5 + d), margin, { cameraAspect: CAM, fieldAspect: fa });
  // screen px per PHYSICAL camera px: dScreen / (d * camPx). camW=CAM, camH=1 (height units).
  const pxPerCamX = (Math.abs(dx.x - base.x) * fieldW) / (d * CAM);
  const pxPerCamY = (Math.abs(dy.y - base.y) * fieldH) / (d * 1);
  ok(near(pxPerCamX, pxPerCamY, 1e-4), `isotropic on portrait field: ${pxPerCamX.toFixed(3)} px/camU (x) vs ${pxPerCamY.toFixed(3)} (y)`);
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
