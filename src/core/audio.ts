import { settings } from './settings';

export interface EngineSoundState {
  speed: number;
  throttle: number;
  slide: number;
  rain: number;
  boost: boolean;
  active: boolean;
}

const GEAR_TOPS = [18, 28, 38, 48, 58, 68, 78, 96];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private screechGain!: GainNode;
  private rainGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Browsers only allow audio after a user gesture, so the title screen calls this on first tap. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = settings.get().volume;
    this.master.connect(ctx.destination);
    settings.subscribe((s) => {
      this.master.gain.setTargetAtTime(s.volume, ctx.currentTime, 0.05);
    });

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 800;
    this.engineFilter.Q.value = 4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const o2gain = ctx.createGain();
    o2gain.gain.value = 0.35;
    this.osc1.connect(this.engineFilter);
    this.osc2.connect(o2gain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    const noise = this.noiseBuffer(ctx);
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = noise;
    screechSrc.loop = true;
    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 2400;
    screechFilter.Q.value = 6;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    screechSrc.connect(screechFilter).connect(this.screechGain).connect(this.master);
    screechSrc.start();

    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noise;
    rainSrc.loop = true;
    rainSrc.playbackRate.value = 0.7;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1800;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rainSrc.start();

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();
  }

  update(state: EngineSoundState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.abs(state.speed);
    let low = 0;
    let gear = 0;
    while (gear < GEAR_TOPS.length - 1 && v > GEAR_TOPS[gear]) {
      low = GEAR_TOPS[gear];
      gear++;
    }
    const high = GEAR_TOPS[gear];
    const rpm = 0.3 + 0.7 * Math.min(1, (v - low * 0.82) / (high - low * 0.82));
    const freq = 55 + rpm * 210 + (state.boost ? 18 : 0);
    this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(500 + state.throttle * 2600 + rpm * 900, t, 0.05);
    this.engineGain.gain.setTargetAtTime(state.active ? 0.06 + state.throttle * 0.07 : 0, t, 0.08);
    this.screechGain.gain.setTargetAtTime(state.active ? Math.min(0.16, state.slide * 0.05) : 0, t, 0.05);
    this.rainGain.gain.setTargetAtTime(state.active ? state.rain * 0.08 : 0, t, 0.3);
    this.windGain.gain.setTargetAtTime(state.active ? Math.min(0.12, (v / 90) * 0.12) : 0, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(250 + v * 8, t, 0.2);
  }

  silence(): void {
    this.update({ speed: 0, throttle: 0, slide: 0, rain: 0, boost: false, active: false });
  }

  beep(freq: number, duration: number, volume = 0.18): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.value = volume;
    g.gain.setTargetAtTime(0, ctx.currentTime + duration * 0.7, duration * 0.2);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.2);
  }

  thump(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
    g.gain.value = Math.min(0.5, 0.1 + strength * 0.03);
    g.gain.setTargetAtTime(0, ctx.currentTime + 0.05, 0.08);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }

  click(): void {
    this.beep(1400, 0.03, 0.06);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}

export const audio = new AudioEngine();

export function vibrate(ms: number): void {
  if (!settings.get().vibration) return;
  if ('vibrate' in navigator) navigator.vibrate(ms);
}
