import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

// CDN-hosted WASM + model: keeps Vite config zero — no asset-copy plugin needed (§5).
const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;
export type Landmark = NormalizedLandmark;

// Orientation proxies pulled from the 21 landmarks, used to pose the control bar in 3D.
// ROLL IS NO LONGER HERE — it is now MEASURED directly from two driving landmarks (see
// control.ts / controlDrive), replacing the old synthesized wrist(0)->middle-MCP(9) proxy. Only
// pitch and yaw remain proxies; each is a *signal you can smooth directly* (no angle-wrap, no
// per-hand calibration) and the two stay decoupled:
//   pitch — in-image finger DROP: how far the fingertips sit below the knuckle row (no depth).
//   yaw   — lateral z-gradient (index-MCP vs pinky-MCP): palm turns left/right.
// MediaPipe's z is the noisiest channel, so callers smooth yaw hard (see main.ts).
export interface HandPose {
  pitch: number; // in-image finger DROP: mean(fingertip.y) - mean(knuckle.y), scale-normalized
  yaw: number;   // z(MCP5) - z(MCP17): index vs pinky depth
}

const FINGERTIPS = [8, 12, 16, 20]; // index, middle, ring, pinky tips
const KNUCKLES = [5, 9, 13, 17];    // their MCP knuckles
const meanY = (lm: Landmark[], idx: number[]): number =>
  idx.reduce((s, i) => s + lm[i].y, 0) / idx.length;

export function handPose(lm: Landmark[]): HandPose {
  const wrist = lm[0], mcp9 = lm[9], mcp5 = lm[5], mcp17 = lm[17];
  // Pitch is read "from the side" WITHOUT depth (per the user's choice): how far the fingertips
  // sit below the knuckle row in the image (image y is DOWN, so dropped fingers => +pitch).
  // Normalized by hand scale (wrist->MCP9 length) so it's invariant to hand size / distance.
  const handScale = Math.hypot(mcp9.x - wrist.x, mcp9.y - wrist.y) || 1e-3;
  return {
    pitch: (meanY(lm, FINGERTIPS) - meanY(lm, KNUCKLES)) / handScale,
    yaw: mcp5.z - mcp17.z,
  };
}

export interface Hands {
  landmarker: HandLandmarker;
  video: HTMLVideoElement;
}

export async function initHands(video: HTMLVideoElement): Promise<Hands> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
  });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await video.play();
  return { landmarker, video };
}
