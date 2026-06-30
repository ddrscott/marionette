// Main-thread interface to hand detection. Detection itself runs in a Web Worker
// (`handsWorker.ts`) so the physics/render loop never blocks on GPU inference (§5). This
// module owns the camera + the worker, pumps frames to it (one in flight, gated to new
// camera frames), and exposes the LATEST per-hand result for main.ts to consume.
import type { Landmark, WorkerHand, WorkerInbound, WorkerOutbound } from "./handsProtocol.ts";

// Re-exported for the overlay (draw.ts) and callers — neither pulls in @mediapipe.
export { HAND_CONNECTIONS } from "./handsProtocol.ts";
export type { Landmark, WorkerHand } from "./handsProtocol.ts";

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

// Quality = FIXED preset tiers (not device-capability enumeration, not an FPS picker). Higher tiers
// are sharper but heavier to detect — 480p is the default because it's the fastest detection and
// matches the app's original hardcoded 640×480. Resolution is requested as a PREFERENCE (ideal),
// never a hard constraint, so a camera that can't hit the tier still works.
export type QualityTier = "480p" | "720p" | "1080p";
export const DEFAULT_QUALITY: QualityTier = "480p";
export const QUALITY_TIERS: Record<QualityTier, { width: number; height: number; label: string }> = {
  "480p":  { width: 640,  height: 480,  label: "480p (640×480) — fastest detection" },
  "720p":  { width: 1280, height: 720,  label: "720p (1280×720)" },
  "1080p": { width: 1920, height: 1080, label: "1080p (1920×1080) — sharpest, heaviest" },
};
export const isQualityTier = (v: unknown): v is QualityTier =>
  v === "480p" || v === "720p" || v === "1080p";

export interface SourceOpts { deviceId?: string | null; tier?: QualityTier }

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

// Main-thread handle: owns the camera + the detection worker. `latest` is replaced (not
// mutated) each time the worker returns; `seq` increments with it so main.ts can process a
// result exactly once and otherwise hold the last-known hands (the decoupled §5 loop).
export class Hands {
  latest: WorkerHand[] = [];
  seq = 0;
  ready = false;                  // worker's HandLandmarker is built (set async, never blocks boot)
  private inFlight = false;        // at most ONE frame in the worker at a time (no backlog/lag)
  private lastVideoTime = -1;      // only ship a frame when the camera advanced

  // Current camera source. `stream` is the live MediaStream (its tracks are stopped before each
  // re-acquire); `deviceId`/`tier` reflect what's ACTUALLY playing (a saved-but-gone device falls
  // back, so these can differ from what was requested).
  private stream: MediaStream | null = null;
  deviceId: string | null = null;
  tier: QualityTier = DEFAULT_QUALITY;

  private constructor(readonly video: HTMLVideoElement, private readonly worker: Worker) {
    worker.addEventListener("message", (ev: MessageEvent): void => {
      const msg = ev.data as WorkerOutbound;
      if (msg.type === "ready") {
        this.ready = true; // landmarker built — pump() may now ship frames
      } else if (msg.type === "result") {
        this.latest = msg.hands;
        this.seq++;
        this.inFlight = false; // result returned — free to send the next frame
      } else if (msg.type === "error") {
        this.inFlight = false;
        console.error("[handsWorker]", msg.message);
      }
    });
    // A classic-worker LOAD failure (parse/import error) fires here, not as a message — surface
    // it instead of letting detection silently never start.
    worker.addEventListener("error", (e: ErrorEvent): void => {
      console.error("[handsWorker] failed to load:", e.message || e);
    });
  }

  // Spawn the worker + start the camera. Does NOT block on the worker's landmarker build — the
  // app boots as soon as the camera is up; the worker signals `ready` asynchronously and pump()
  // stays a no-op until then. (A worker that never readies leaves the puppets hanging with a
  // console error — never a silent boot hang.)
  static async create(video: HTMLVideoElement, opts: SourceOpts = {}): Promise<Hands> {
    // `{ type: "classic" }` is LOAD-BEARING: MediaPipe's wasm loader uses importScripts(), which
    // only exists in a classic worker (a module worker dies with "ModuleFactory not set"). The
    // worker itself has no ESM import (it importScripts() the CJS bundle), so this same classic
    // spawn works in BOTH dev and the production build.
    const worker = new Worker(new URL("./handsWorker.ts", import.meta.url), { type: "classic" });

    // Construct (which attaches the message/error listeners) BEFORE starting the camera. The
    // worker builds its landmarker and posts `ready` almost immediately — if we awaited the
    // camera first, that `ready` (and any early error) would fire before any listener existed
    // and be lost, leaving `ready` stuck false and pump() never shipping a frame.
    const hands = new Hands(video, worker);
    await hands.useSource(opts);
    return hands;
  }

  // Enumerate the available video input devices (for the source picker). Labels are empty/anonymous
  // until the first successful getUserMedia, so callers re-list after the initial permission grant.
  async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  private stopStream(): void {
    if (this.stream) {
      // stop the OLD tracks before re-acquiring so the device is released (avoids the camera
      // leaking / "could not start video source / camera in use" on a switch).
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  // (Re)acquire the camera stream with a chosen device + quality, live. Stops the previous tracks,
  // getUserMedia with the new deviceId + resolution, then swaps `video.srcObject` and re-plays.
  // It does NOT touch the detection worker: the worker keeps pumping frames off the SAME <video>
  // element via pump(), which now points at the new stream — no worker restart, no seq reset.
  async useSource(opts: SourceOpts = {}): Promise<void> {
    if (opts.deviceId !== undefined) this.deviceId = opts.deviceId;
    if (opts.tier !== undefined && isQualityTier(opts.tier)) this.tier = opts.tier;
    const { width, height } = QUALITY_TIERS[this.tier] ?? QUALITY_TIERS[DEFAULT_QUALITY];

    // Resolution + device are PREFERENCES (`ideal`), not hard constraints: a camera that can't do
    // the tier still opens at its nearest mode, and a saved deviceId that's gone falls back to the
    // default device instead of throwing (graceful — no crash).
    const videoConstraints: MediaTrackConstraints = { width: { ideal: width }, height: { ideal: height } };
    if (this.deviceId) videoConstraints.deviceId = { ideal: this.deviceId };

    this.stopStream();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
    } catch (e) {
      // belt-and-suspenders: `ideal` shouldn't over-constrain, but if a UA still rejects, retry
      // with no resolution constraint (keep the device as a hint).
      if (e instanceof DOMException && e.name === "OverconstrainedError") {
        stream = await navigator.mediaDevices.getUserMedia({
          video: this.deviceId ? { deviceId: { ideal: this.deviceId } } : true,
        });
      } else throw e;
    }

    this.stream = stream;
    // Reflect what we ACTUALLY got — the active device may differ from what was requested (saved id
    // gone, or the UA picked another). Keeps deviceId honest for persistence + the dropdown.
    const settings = stream.getVideoTracks()[0]?.getSettings();
    if (settings?.deviceId) this.deviceId = settings.deviceId;

    this.video.srcObject = stream;
    await this.video.play();
  }

  // Call once per rAF. If the worker is ready, the camera has a fresh frame, and the worker is
  // idle, grab it as an ImageBitmap and TRANSFER it (zero-copy). A no-op while not ready, while a
  // frame is in flight, or while the camera hasn't advanced — so detection runs at camera rate,
  // never backing up behind the render loop.
  pump(t: number): void {
    if (!this.ready) return;                         // worker's landmarker not built yet
    if (this.inFlight) return;
    if (this.video.readyState < 2) return;           // HAVE_CURRENT_DATA — a frame exists to grab
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    this.inFlight = true;
    createImageBitmap(this.video)
      .then((bmp) => {
        const msg: WorkerInbound = { type: "frame", bmp, t };
        this.worker.postMessage(msg, [bmp]);
      })
      .catch((e) => { this.inFlight = false; console.error("[hands] createImageBitmap", e); });
  }
}

// Backwards-compatible entry point: spawn the worker + start the camera (optionally with a saved
// device + quality re-applied on boot).
export const initHands = (video: HTMLVideoElement, opts: SourceOpts = {}): Promise<Hands> =>
  Hands.create(video, opts);
