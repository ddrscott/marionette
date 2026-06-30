import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

// CDN-hosted WASM + model: keeps Vite config zero — no asset-copy plugin needed (§5).
const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;
export type Landmark = NormalizedLandmark;

// Orientation proxies pulled from the 21 landmarks, used to pose the control bar in 3D.
// Each field is chosen to be a *signal you can smooth directly* (no angle-wrap, no per-hand
// calibration) and to keep the three rotations decoupled:
//   roll  — fully in-plane, from the wrist(0)->middle-MCP(9) vector (returned as components so
//           One Euro never sees a wrapping angle).
//   pitch — longitudinal z-gradient (middle-MCP vs wrist): palm tips toward/away from camera.
//   yaw   — lateral z-gradient (index-MCP vs pinky-MCP): palm turns left/right.
// Two *projected lengths* would only give ONE scale-invariant DOF (their ratio), so pitch and
// yaw cannot be separated geometrically — the z-gradients keep them independent. MediaPipe's z
// is the noisiest channel, so callers smooth these hard (see main.ts).
export interface HandPose {
  rollX: number; // stage-space (mirrored, +x = screen-right) wrist->MCP9 x-component
  rollY: number; // stage-space (+y = screen-up) wrist->MCP9 y-component
  pitch: number; // z(MCP9) - z(wrist): >0 tips one way, <0 the other
  yaw: number;   // z(MCP5) - z(MCP17): index vs pinky depth
}

export function handPose(lm: Landmark[]): HandPose {
  const wrist = lm[0], mcp9 = lm[9], mcp5 = lm[5], mcp17 = lm[17];
  // Match the stage frame used for translation in main.ts: X is mirrored (selfie), Y points up.
  // Only differences matter here, so the sign flip alone carries the mapping (no offset needed).
  return {
    rollX: -(mcp9.x - wrist.x),
    rollY: -(mcp9.y - wrist.y),
    pitch: mcp9.z - wrist.z,
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
