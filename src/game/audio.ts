/**
 * Spin Rally audio engine.
 * Original procedural table-tennis effects and a lightweight adaptive synth score.
 * AudioContext is unlocked only from a user gesture; all voices share one master chain.
 */

export type SfxId = "move" | "hit" | "pickup" | "ui" | "explosion" | "win" | "lose" | "bounce" | "net" | "serve" | "score";

const MUTE_KEY = "game.muted";
function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
function writeMuted(value: boolean): void {
  try { localStorage.setItem(MUTE_KEY, value ? "1" : "0"); } catch { /* storage is optional */ }
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private musicGain: GainNode | null = null;
  private disposed = false;
  muted = false;

  private readonly unlock = () => {
    if (this.disposed) return;
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") void ctx.resume();
    this.detachUnlock();
  };

  constructor() {
    this.muted = readMuted();
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  private detachUnlock(): void {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachUnlock();
    this.stopMusic();
    this.master?.disconnect();
    this.compressor?.disconnect();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.noise = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;
      master.gain.value = this.muted ? 0 : 0.62;
      master.connect(compressor).connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.compressor = compressor;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const length = Math.ceil(ctx.sampleRate * 0.35);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      // Slightly correlated noise sounds less like static and more like felt/rubber.
      const white = Math.random() * 2 - 1;
      last = last * 0.22 + white * 0.78;
      data[i] = last;
    }
    this.noise = buffer;
    return buffer;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeMuted(this.muted);
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.62, now, 0.025);
    }
    return this.muted;
  }

  private tone(frequency: number, endFrequency: number, duration: number, gain: number, type: OscillatorType = "sine", destination: AudioNode = this.master!): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, frequency), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + Math.min(0.004, duration * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env).connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  private noiseBurst(duration: number, gain: number, highpass: number, lowpass: number, destination: AudioNode = this.master!): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    source.buffer = this.noiseBuffer(ctx);
    hp.type = "highpass";
    hp.frequency.setValueAtTime(highpass, now);
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(lowpass, now);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(hp).connect(lp).connect(env).connect(destination);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => { source.disconnect(); hp.disconnect(); lp.disconnect(); env.disconnect(); };
  }

  sfx(id: SfxId): void {
    if (this.disposed || this.muted) return;
    this.ensureCtx();
    if (!this.master) return;

    switch (id) {
      case "hit":
        // Rubber-on-ball attack + hollow wooden blade body.
        this.noiseBurst(0.045, 0.24, 900, 7200);
        this.tone(210, 92, 0.105, 0.2, "triangle");
        this.tone(720, 310, 0.035, 0.07, "sine");
        break;
      case "bounce":
        // Distinct, short table-top impact.
        this.noiseBurst(0.025, 0.15, 1500, 8500);
        this.tone(520, 230, 0.075, 0.16, "sine");
        this.tone(145, 105, 0.055, 0.075, "triangle");
        break;
      case "net":
        this.noiseBurst(0.12, 0.13, 500, 4200);
        this.tone(260, 125, 0.14, 0.075, "triangle");
        break;
      case "serve":
        this.noiseBurst(0.028, 0.12, 1200, 6500);
        this.tone(390, 650, 0.09, 0.12, "triangle");
        break;
      case "score":
        this.tone(523.25, 523.25, 0.18, 0.12);
        this.tone(659.25, 659.25, 0.2, 0.11);
        this.tone(783.99, 783.99, 0.28, 0.12);
        break;
      case "win":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone(f, f * 1.005, 0.34, 0.105, "sine", this.master!);
        });
        break;
      case "lose":
        this.tone(330, 220, 0.22, 0.13, "triangle");
        this.tone(220, 146.8, 0.38, 0.12, "sine");
        break;
      case "ui":
        this.tone(580, 760, 0.045, 0.055, "sine");
        break;
      case "move":
        this.noiseBurst(0.025, 0.035, 1600, 5000);
        break;
      case "pickup":
        this.tone(660, 990, 0.12, 0.1);
        break;
      case "explosion":
        this.noiseBurst(0.24, 0.2, 80, 1400);
        this.tone(100, 35, 0.3, 0.14, "sawtooth");
        break;
    }
  }

  /** A quiet, original four-bar-inspired synth loop; no external/copyrighted audio assets. */
  startMusic(): void {
    if (this.disposed || this.musicTimer) return;
    const ctx = this.ensureCtx();
    if (!this.master) return;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.master);
    bus.gain.setTargetAtTime(0.22, ctx.currentTime, 0.8);
    this.musicGain = bus;
    this.musicStep = 0;

    const scale = [0, 3, 5, 7, 10, 12, 10, 7, 5, 3, 7, 10, 12, 15, 12, 10];
    const roots = [110, 130.81, 98, 146.83];
    const tick = () => {
      if (this.disposed || !this.ctx || !this.musicGain) return;
      const step = this.musicStep++;
      const root = roots[Math.floor(step / 16) % roots.length];
      const note = root * Math.pow(2, scale[step % scale.length] / 12);
      const accent = step % 4 === 0;
      this.tone(note, note * 0.995, accent ? 0.22 : 0.14, accent ? 0.045 : 0.022, "sine", this.musicGain);
      if (step % 4 === 0) this.tone(root / 2, root / 2 * 0.99, 0.24, 0.055, "triangle", this.musicGain);
      if (step % 8 === 4) this.noiseBurst(0.035, 0.012, 5000, 11000, this.musicGain);
    };
    tick();
    this.musicTimer = setInterval(tick, 180);
  }

  stopMusic(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.musicGain && this.ctx) {
      const bus = this.musicGain;
      const now = this.ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0.0001, now, 0.12);
      window.setTimeout(() => bus.disconnect(), 700);
    }
    this.musicGain = null;
  }
}
