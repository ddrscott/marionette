import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

// CDN-hosted WASM + model: keeps Vite config zero — no asset-copy plugin needed (§5).
const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;
export type Landmark = NormalizedLandmark;

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
