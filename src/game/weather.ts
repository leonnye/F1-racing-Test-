export type WeatherMode = 'clear' | 'cloudy' | 'light' | 'heavy' | 'fog' | 'changing';

export const WEATHER_LABELS: Record<WeatherMode, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  light: 'Light rain',
  heavy: 'Heavy rain',
  fog: 'Fog',
  changing: 'Changing',
};

interface WeatherEvent {
  time: number;
  rain: number;
  warned: boolean;
  started: boolean;
}

export class WeatherState {
  readonly mode: WeatherMode;
  rain = 0;
  rainTarget = 0;
  wetness = 0;
  fog = 0;
  cloudy = false;
  private events: WeatherEvent[] = [];

  constructor(mode: WeatherMode, expectedRaceSeconds: number) {
    this.mode = mode;
    switch (mode) {
      case 'cloudy':
        this.cloudy = true;
        break;
      case 'light':
        this.cloudy = true;
        this.rain = this.rainTarget = 0.5;
        this.wetness = 0.5;
        break;
      case 'heavy':
        this.cloudy = true;
        this.rain = this.rainTarget = 1;
        this.wetness = 1;
        break;
      case 'fog':
        this.cloudy = true;
        this.fog = 1;
        break;
      case 'changing': {
        this.cloudy = true;
        const T = expectedRaceSeconds;
        const t1 = T * (0.2 + Math.random() * 0.22);
        const level = Math.random() < 0.5 ? 0.55 : 1;
        this.events.push({ time: t1, rain: level, warned: false, started: false });
        if (Math.random() < 0.55) {
          this.events.push({ time: t1 + T * (0.25 + Math.random() * 0.15), rain: 0, warned: false, started: false });
        }
        break;
      }
      default:
        break;
    }
  }

  /** Advances weather; returns radio messages for the player. */
  update(dt: number, raceTime: number, lapSeconds: number): string[] {
    const msgs: string[] = [];
    for (const e of this.events) {
      const until = e.time - raceTime;
      if (!e.warned && until < lapSeconds * 1.6 && until > 0) {
        e.warned = true;
        msgs.push(e.rain > 0 ? `Rain expected in about ${this.lapsText(until, lapSeconds)}.` : `Rain should stop in about ${this.lapsText(until, lapSeconds)}.`);
      }
      if (!e.started && raceTime >= e.time) {
        e.started = true;
        this.rainTarget = e.rain;
        msgs.push(e.rain > 0.7 ? 'Heavy rain is starting. Watch the grip.' : e.rain > 0 ? 'Light rain is starting.' : 'The rain has stopped. The track will dry.');
      }
    }
    const r = this.rainTarget - this.rain;
    this.rain += Math.sign(r) * Math.min(Math.abs(r), dt * 0.15);
    if (this.rain > this.wetness) this.wetness = Math.min(this.rain, this.wetness + dt * 0.011 * (0.5 + this.rain));
    else this.wetness = Math.max(this.rain, this.wetness - dt * 0.0045);
    return msgs;
  }

  forecast(raceTime: number, lapSeconds: number): string {
    const next = this.events.find((e) => !e.started);
    if (next) {
      const until = next.time - raceTime;
      if (until < lapSeconds * 3) return next.rain > 0 ? `Rain in ~${this.lapsText(until, lapSeconds)}` : `Drying in ~${this.lapsText(until, lapSeconds)}`;
    }
    if (this.rain > 0.7) return 'Heavy rain';
    if (this.rain > 0.05) return 'Light rain';
    if (this.wetness > 0.15) return 'Drying track';
    if (this.fog > 0) return 'Fog';
    return this.cloudy ? 'Cloudy' : 'Clear';
  }

  get icon(): string {
    if (this.rain > 0.7) return '\u{1F327}';
    if (this.rain > 0.05) return '\u{1F326}';
    if (this.fog > 0) return '\u{1F32B}';
    return this.cloudy ? '\u2601' : '\u{1F319}';
  }

  private lapsText(seconds: number, lapSeconds: number): string {
    const laps = Math.max(1, Math.round(seconds / Math.max(1, lapSeconds)));
    return laps === 1 ? '1 lap' : `${laps} laps`;
  }
}
