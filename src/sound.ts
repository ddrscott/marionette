// Procedural WebAudio SFX for /game — no assets, just oscillators + noise bursts. Adapted to TS ESM
// from false-alarms-web's public/js/sound.js. One shared AudioContext + a master GainNode bus that
// the music engine (music.ts) also hangs off, so a single mute kills everything. Nothing sounds until
// unlock() runs on a real user gesture (browser autoplay policy — a webcam frame is NOT a gesture).
//
// This module is imported ONLY by the game layer; the harness never touches it.

let ctx: AudioContext | null = null;
let unlocked = false;
let master: GainNode | null = null; // sfx + music both connect here so one mute kills all audio
let muted = false;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

// Create/resume the shared context on a user gesture. Idempotent — safe to call on every click/key.
export function unlock(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  unlocked = true;
}

// --- shared accessors for music.ts (same bus) ---
export function getCtx(): AudioContext | null { return ctx; }
export function getMaster(): GainNode | null { return master; }
export function audioReady(): boolean { return !!(unlocked && ctx && ctx.state === "running"); }
export function getMuted(): boolean { return muted; }
export function setMuted(m: boolean): void {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
}

function out(): AudioNode | null { return master ?? ctx?.destination ?? null; }

// A single oscillator with an exponential gain envelope + optional pitch slide (Hz added over dur).
function blip(freq: number, dur = 0.08, type: OscillatorType = "square", vol = 0.05, slide = 0): void {
  if (!unlocked || !ctx) return;
  const dest = out();
  if (!dest) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// A decaying white-noise burst through a lowpass — the body of every impact/slice/hiss.
function noise(dur = 0.15, vol = 0.08, freq = 800, type: BiquadFilterType = "lowpass"): void {
  if (!unlocked || !ctx) return;
  const dest = out();
  if (!dest) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(dest);
  src.start(t);
}

// Fire fn only if `windowMs` has elapsed since this key last fired — guards continuous/rapid triggers
// (a sustained limb overlap, a per-frame check) from machine-gunning the synth into a roar.
const _last: Record<string, number> = Object.create(null);
function throttled(key: string, windowMs: number, fn: () => void): boolean {
  const now = ctx ? ctx.currentTime * 1000 : performance.now();
  if (now - (_last[key] || 0) < windowMs) return false;
  _last[key] = now;
  fn();
  return true;
}

// Named fighter voices — each a little layered synth recipe. Wired from the /game layer.
export const sfx = {
  // The money SFX: a string is severed. A sharp filtered "shff" noise burst + a fast descending
  // blip = a downward slice. Throttled a touch so a burst of cuts still reads as distinct hits.
  slice: (): void => { throttled("slice", 60, () => {
    noise(0.13, 0.13, 5200, "highpass");
    blip(1600, 0.09, "sawtooth", 0.05, -1200);
    blip(520, 0.06, "square", 0.03, -260);
  }); },

  // The two puppets' limbs collide: a metallic clang — a couple of detuned blips + a noise tick.
  // Throttled so a sustained overlap doesn't machine-gun (cut.ts also gates it with a cooldown).
  clash: (): void => { throttled("clash", 90, () => {
    blip(430, 0.12, "square", 0.06, 40);
    blip(660, 0.11, "triangle", 0.045, 60);
    noise(0.06, 0.06, 2600, "highpass");
  }); },

  // A string snaps on during the attach ritual. Rising per string index (0..4) for a satisfying
  // build across the ~1s ritual.
  attach: (index: number): void => {
    const base = 300 + index * 130;
    blip(base, 0.09, "triangle", 0.05, 220);
    noise(0.05, 0.03, 1800, "highpass");
  },

  // A puppet is killed — a big low hit + a downward sweep.
  ko: (): void => {
    noise(0.3, 0.14, 700);
    blip(180, 0.45, "sawtooth", 0.1, -150);
    blip(70, 0.5, "sine", 0.1, -30);
  },

  // "ROUND N" chime at the top of a round.
  round: (): void => {
    [523, 784].forEach((f, i) => setTimeout(() => blip(f, 0.18, "triangle", 0.06), i * 130));
  },

  // "FIGHT!" — a punchy stab that kicks the fight off.
  fight: (): void => {
    noise(0.12, 0.09, 1400);
    blip(330, 0.18, "sawtooth", 0.08, 260);
    setTimeout(() => blip(660, 0.16, "square", 0.06), 90);
  },

  // "TIME" — the round timer runs out (no K.O.).
  time: (): void => {
    [660, 660, 880].forEach((f, i) => setTimeout(() => blip(f, 0.16, "square", 0.05), i * 130));
  },

  // Victory fanfare at match end.
  win: (): void => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.22, "triangle", 0.07), i * 150));
  },

  // Final-seconds countdown tick. `urgent` (<= 3s) is higher + brighter. Throttled per key so a
  // per-frame poll only sounds once even though it's checked every frame.
  beep: (urgent = false): void => { throttled("beep", 400, () => {
    blip(urgent ? 1200 : 880, 0.09, "square", urgent ? 0.06 : 0.045);
  }); },
};
