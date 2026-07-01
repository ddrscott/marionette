// Procedural adaptive chiptune for /game — no assets, shares sound.ts's AudioContext + master bus so
// one mute kills music too. Adapted to TS ESM from false-alarms-web's public/js/music.js.
//
// A "song" is a set of 16-step (one bar) patterns + per-layer voices, run by a LOOKAHEAD SCHEDULER on
// its own setInterval (OFF the render loop, so it never costs the 60fps). Two tracks share one bus +
// voice graph, so a menu<->fight switch crossfades and can never overlap:
//   - MENU_SONG  — calm, fixed intensity: prematch / round breaks / match end.
//   - FIGHT_SONG — intense, ADAPTIVE: escalates with combat intensity (0..1 the game feeds in as
//                  strings drop / the clock runs out); instruments tier in, tempo climbs.

import { getCtx, getMaster, audioReady } from "./sound.ts";

type LayerCfg = { wave: WaveName; octave: number; vol: number; on: number; attack: number; release: number };
type WaveName = "pulse50" | "pulse25" | "pulse12";
type LayerName = "bass" | "arp" | "lead";
type Song = {
  keyRoot: number;
  bpmCalm: number;
  bpmFrantic: number;
  busVol: number;
  adaptive: boolean;
  fixedIntensity: number; // used when adaptive === false
  layers: Record<LayerName, LayerCfg>;
  bass: (number | null)[];
  arp: (number | null)[];
  lead: (number | null)[]; // two bars (32 steps) for a longer hook
  drums: { kick: number[]; snare: number[]; hatOn: number; snareOn: number; kickOn: number };
};

// --- the fight song: escalates with intensity, A-minor-ish drive ---
const FIGHT_SONG: Song = {
  keyRoot: 57, // A3
  bpmCalm: 96,
  bpmFrantic: 148,
  busVol: 0.5,
  adaptive: true,
  fixedIntensity: 0,
  layers: {
    bass: { wave: "pulse12", octave: -24, vol: 0.22, on: 0.01, attack: 0.005, release: 0.16 },
    arp: { wave: "pulse25", octave: 0, vol: 0.1, on: 0.22, attack: 0.002, release: 0.07 },
    lead: { wave: "pulse50", octave: 12, vol: 0.12, on: 0.62, attack: 0.004, release: 0.16 },
  },
  bass: [0, null, 7, 0, 0, null, null, 10, null, 0, 10, null, 5, null, 7, null],
  arp: [0, null, 12, 0, 15, 7, 12, null, null, null, 19, 7, 15, 7, 0, 12],
  lead: [
    null, 12, null, 15, null, null, null, null, 17, null, null, null, null, null, 12, 19,
    12, null, 7, 12, 15, null, null, 19, null, null, 17, null, 15, 12, null, null,
  ],
  drums: {
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hatOn: 0.3, snareOn: 0.4, kickOn: 0.08,
  },
};

// --- the menu / between-rounds song: slow, sparse, brighter, fixed gentle intensity ---
const MENU_SONG: Song = {
  keyRoot: 50, // D3 — calmer register
  bpmCalm: 84,
  bpmFrantic: 84,
  busVol: 0.4,
  adaptive: false,
  fixedIntensity: 0.55, // constant: bass + arp + soft beat, no lead wail
  layers: {
    bass: { wave: "pulse50", octave: -24, vol: 0.17, on: 0.01, attack: 0.01, release: 0.3 },
    arp: { wave: "pulse25", octave: 12, vol: 0.085, on: 0.2, attack: 0.003, release: 0.18 },
    lead: { wave: "pulse12", octave: 12, vol: 0.075, on: 0.5, attack: 0.006, release: 0.3 },
  },
  bass: [0, null, null, null, 9, null, null, null, 5, null, null, null, 7, null, null, null],
  arp: [12, null, 16, null, 19, null, 16, null, 14, null, 17, null, 19, null, 21, null],
  lead: [
    null, null, 24, null, null, null, 21, null, null, null, 19, null, null, null, null, null,
    null, null, 21, null, null, null, 19, null, null, null, 17, null, null, null, 16, null,
  ],
  drums: {
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hatOn: 0.3, snareOn: 0.45, kickOn: 0.1,
  },
};

const BARS = 16;
// Fight is never fully silent: intensity is floored here so the bass + kick always hold once combat
// starts; the arp/lead/snare still tier in as the fight heats up.
const MIN_INTENSITY = 0.14;
const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
type DrumName = "kick" | "snare" | "hat";
type GraphName = LayerName | DrumName;

export class Music {
  private playing = false;
  private track: "menu" | "fight" | null = null;
  private song: Song = MENU_SONG;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bus: GainNode | null = null;
  private layerGain: Partial<Record<GraphName, GainNode>> = {};
  private waves: Partial<Record<WaveName, PeriodicWave>> = {};
  private noiseBuf: AudioBuffer | null = null;
  private step = 0; // 0..31 (covers the 2-bar lead)
  private nextTime = 0;
  private bpm = FIGHT_SONG.bpmCalm;
  private intensity = 0; // smoothed 0..1
  private target = 0; // requested 0..1

  // --- public API driven by the match FSM ---

  // Calmer between-rounds theme. Idempotent so rapid phase changes never restart/stack the loop.
  startMenu(): void {
    if (this.track === "menu" && this.playing) { this.ensure(); return; }
    this.switchTo("menu", MENU_SONG);
    this.target = MENU_SONG.fixedIntensity;
  }

  // The fight theme — escalates via setIntensity().
  startCombat(): void {
    if (this.track === "fight" && this.playing) { this.ensure(); return; }
    this.switchTo("fight", FIGHT_SONG);
  }

  // 0..1 combat heat (the game maps strings-dropped + clock into this). Ignored by the menu track.
  setIntensity(v: number): void {
    if (!this.song.adaptive) return;
    this.target = clamp(Math.max(v, MIN_INTENSITY), 0, 1);
    if (this.playing) this.ensure();
  }

  stop(): void {
    this.playing = false;
    this.track = null;
    const ctx = getCtx();
    if (this.bus && ctx) this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.18);
  }

  // Hand off between tracks: swap the active song, reset the sequencer to the top of its phrase, and
  // fade the shared bus in. Only one track ever drives the bus, so a switch can't overlap the last.
  private switchTo(track: "menu" | "fight", song: Song): void {
    this.track = track;
    this.song = song;
    this.playing = true;
    this.step = 0;
    this.intensity = 0; // ramp up from silence into the new mix
    if (song.adaptive) this.target = MIN_INTENSITY; // never silent before the first heat update
    this.bpm = song.bpmCalm;
    this.ensure();
    const ctx = getCtx();
    if (this.bus && ctx) {
      this.bus.gain.cancelScheduledValues(ctx.currentTime);
      this.bus.gain.setTargetAtTime(song.busVol, ctx.currentTime, 0.25);
    }
  }

  // --- graph + scheduler ---
  private ensure(): boolean {
    if (!audioReady()) return false;
    const ctx = getCtx();
    if (!ctx) return false;
    if (!this.bus) this.buildGraph(ctx);
    if (this.timer == null) {
      this.nextTime = ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.tick(), 25);
    }
    return true;
  }

  private buildGraph(ctx: AudioContext): void {
    this.waves.pulse50 = makePulse(ctx, 0.5);
    this.waves.pulse25 = makePulse(ctx, 0.25);
    this.waves.pulse12 = makePulse(ctx, 0.125);
    this.noiseBuf = makeNoiseBuffer(ctx);

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(getMaster() ?? ctx.destination);

    const names: GraphName[] = ["bass", "arp", "lead", "kick", "snare", "hat"];
    for (const name of names) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.bus);
      this.layerGain[name] = g;
    }
  }

  private tick(): void {
    const ctx = getCtx();
    if (!ctx) return;
    const S = this.song;
    // smooth intensity toward target; drive tempo + layer mix
    this.intensity += (this.target - this.intensity) * 0.08;
    const t = this.intensity;
    this.bpm = S.bpmCalm + (S.bpmFrantic - S.bpmCalm) * t;

    const L = S.layers, D = S.drums;
    this.setLayer("bass", t > L.bass.on ? L.bass.vol : 0);
    this.setLayer("arp", t > L.arp.on ? L.arp.vol * clamp((t - L.arp.on) / 0.3 + 0.4, 0, 1) : 0);
    this.setLayer("lead", t > L.lead.on ? L.lead.vol : 0);
    this.setLayer("kick", t > D.kickOn ? 0.9 : 0);
    this.setLayer("snare", t > D.snareOn ? 0.5 : 0);
    this.setLayer("hat", t > D.hatOn ? 0.28 : 0);

    if (!this.playing) return;
    const lookahead = ctx.currentTime + 0.12;
    while (this.nextTime < lookahead) {
      this.scheduleStep(this.step, this.nextTime, t);
      const stepDur = 60 / this.bpm / 4; // 16th note
      this.nextTime += stepDur;
      this.step = (this.step + 1) % (BARS * 2);
    }
  }

  private setLayer(name: GraphName, vol: number): void {
    const g = this.layerGain[name];
    const ctx = getCtx();
    if (g && ctx) g.gain.setTargetAtTime(vol, ctx.currentTime, 0.12);
  }

  private scheduleStep(step: number, when: number, t: number): void {
    const ctx = getCtx();
    if (!ctx) return;
    const S = this.song;
    const bar16 = step % BARS;
    const root = S.keyRoot;

    const b = S.bass[bar16];
    if (b != null) this.tone(ctx, "bass", root + b + S.layers.bass.octave, when, 0.16);
    const a = S.arp[bar16];
    if (a != null && t > S.layers.arp.on) this.tone(ctx, "arp", root + a + S.layers.arp.octave, when, 0.09);
    const ld = S.lead[step];
    if (ld != null && t > S.layers.lead.on) this.tone(ctx, "lead", root + ld + S.layers.lead.octave, when, 0.14);

    if (S.drums.kick[bar16] && t > S.drums.kickOn) this.kick(ctx, when);
    if (S.drums.snare[bar16] && t > S.drums.snareOn) this.snare(ctx, when);
    if (t > S.drums.hatOn) {
      const frantic = t > 0.7;
      if (frantic || bar16 % 2 === 0) this.hat(ctx, when, bar16 % 4 === 0 ? 0.28 : 0.18);
    }
  }

  // --- voices ---
  private tone(ctx: AudioContext, layer: LayerName, midi: number, when: number, dur: number): void {
    const cfg = this.song.layers[layer];
    const wave = this.waves[cfg.wave];
    const dest = this.layerGain[layer];
    if (!wave || !dest) return;
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.setValueAtTime(midiToFreq(midi), when);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(1, when + cfg.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + cfg.release);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + dur + cfg.release + 0.02);
  }

  private kick(ctx: AudioContext, when: number): void {
    const dest = this.layerGain.kick;
    if (!dest) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(48, when + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + 0.16);
  }

  private snare(ctx: AudioContext, when: number): void {
    const dest = this.layerGain.snare;
    if (!dest || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    src.connect(hp).connect(g).connect(dest);
    const off = Math.floor(Math.random() * (this.noiseBuf.duration - 0.2) * ctx.sampleRate) / ctx.sampleRate;
    src.start(when, off, 0.15);
  }

  private hat(ctx: AudioContext, when: number, vol: number): void {
    const dest = this.layerGain.hat;
    if (!dest || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    src.connect(hp).connect(g).connect(dest);
    const off = Math.floor(Math.random() * (this.noiseBuf.duration - 0.1) * ctx.sampleRate) / ctx.sampleRate;
    src.start(when, off, 0.05);
  }
}

// --- waveform helpers ---
function makePulse(ctx: AudioContext, duty: number, harmonics = 26): PeriodicWave {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export const music = new Music();
