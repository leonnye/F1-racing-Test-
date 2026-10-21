import { audio, vibrate } from '../core/audio';
import type { Input } from '../core/input';
import { settings, type Difficulty, type WearRate } from '../core/settings';
import type { Entry } from '../data/teams';
import { COMPOUNDS, type Compound, bestCompoundFor, isDryCompound } from '../data/tires';
import { AIDriver, type AIContext } from './ai';
import { Car, type StepEnv } from './car';
import { PHYS, lateralGrip, wrapAngle } from './physics';
import type { TrackModel } from './trackModel';
import { WeatherState, type WeatherMode } from './weather';

export type SessionKind = 'race' | 'qualifying' | 'demo';
export type LapsMode = 'short' | 'standard';

export interface RaceConfig {
  trackId: string;
  teamId: string;
  driverId: string;
  difficulty: Difficulty;
  lapsMode: LapsMode;
  qualifying: boolean;
  weather: WeatherMode;
  startCompound: Compound;
  wearRate: WearRate;
  rubberBand: boolean;
}

export type MessageKind = 'info' | 'warn' | 'penalty' | 'good' | 'purple';

export interface RadioMessage {
  id: number;
  text: string;
  kind: MessageKind;
  time: number;
}

export interface PitGame {
  wheel: number;
  needle: number;
  dir: number;
  zone: number;
  lockout: number;
  waited: number;
  elapsed: number;
  release: number;
  results: ('perfect' | 'good' | 'slow')[];
  flash: string;
}

export interface ClassRow {
  car: Car;
  pos: number;
  finished: boolean;
  laps: number;
  total: number;
  gapText: string;
}

const WEAR_RATE: Record<WearRate, number> = { low: 0.6, normal: 1, high: 1.6 };
const STEP = 1 / 120;
const CHECKPOINTS = 50;
const PENALTY = 5;

export function raceLaps(trackLaps: number, mode: LapsMode): number {
  return mode === 'short' ? 3 : trackLaps;
}

export class RaceSession {
  readonly kind: SessionKind;
  readonly config: RaceConfig;
  readonly track: TrackModel;
  readonly cars: Car[] = [];
  player: Car | null = null;
  readonly weather: WeatherState;
  readonly totalLaps: number;
  readonly lapSeconds: number;

  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  countdown = 0;
  lightsOn = 0;
  private goAt: number;
  raceTime = 0;
  order: Car[] = [];
  messages: RadioMessage[] = [];
  pitGame: PitGame | null = null;
  brakeHint = false;
  fastestLap = Infinity;
  fastestCar: Car | null = null;
  leaderFinished = false;
  playerFinishedAt = -1;
  shake = 0;
  sparks: { x: number; y: number; z: number; n: number }[] = [];
  qualifyingLaps: number[] = [];
  onPlayerFinished: (() => void) | null = null;
  onQualifyingDone: ((best: number | null) => void) | null = null;

  private ai = new Map<Car, AIDriver>();
  private aiPitTimers = new Map<Car, number>();
  private positions = new Map<Car, number>();
  private firstCp = new Map<number, number>();
  private yellow: { s: number; until: number }[] = [];
  private aheadOfPlayer = new Map<Car, boolean>();
  private wasSpinning = new Map<Car, boolean>();
  private prevS = new Map<Car, number>();
  private finishOrder: Car[] = [];
  private acc = 0;
  private msgId = 0;
  private tireWarned = 0;
  private hintGiven = '';
  private lastYellowPenalty = -10;
  private finalLapAnnounced = false;
  private stepEnv: StepEnv;
  private aiCtx: AIContext;
  private qualifyingDoneFired = false;

  constructor(kind: SessionKind, config: RaceConfig, track: TrackModel, grid: Entry[], playerEntry: Entry | null) {
    this.kind = kind;
    this.config = config;
    this.track = track;
    this.totalLaps = kind === 'demo' ? Number.POSITIVE_INFINITY : kind === 'qualifying' ? 2 : raceLaps(track.def.laps, config.lapsMode);
    this.lapSeconds = track.idealLap / 0.93;
    const expected = (Number.isFinite(this.totalLaps) ? this.totalLaps : 8) * this.lapSeconds;
    this.weather = new WeatherState(kind === 'demo' ? 'clear' : config.weather, expected);
    this.goAt = 1 + 4 * 0.9 + 0.4 + Math.random() * 1.1;

    const lapsForWear = raceLaps(track.def.laps, config.lapsMode);
    this.stepEnv = {
      wetness: this.weather.wetness,
      // Calibrated so a medium tire lasts roughly 70% of the race at normal wear, after driving-style factors.
      wearBase: 0.6 / (lapsForWear * track.L * 0.72),
      wearMult: kind === 'demo' ? 0.4 : WEAR_RATE[config.wearRate],
    };

    const teamIndexOf = (e: Entry) => ['apex', 'vanguard', 'meridian', 'kinetic', 'zenith', 'obsidian'].indexOf(e.team.id);
    if (kind === 'qualifying' && playerEntry) {
      const car = new Car(0, playerEntry, true, Math.max(0, teamIndexOf(playerEntry)), track);
      car.fitTires(config.startCompound);
      car.tireTemp = 0.7;
      car.placeOnTrack(track.L - 450, track.rlOff[track.indexAt(track.L - 450)], 52);
      car.dist = -450;
      this.cars.push(car);
      this.player = car;
      this.phase = 'racing';
    } else {
      grid.forEach((entry, k) => {
        const isPlayer = playerEntry !== null && entry.driver.id === playerEntry.driver.id;
        const car = new Car(k, entry, isPlayer, Math.max(0, teamIndexOf(entry)), track);
        const back = 14 + k * 8;
        const lat = (k % 2 === 0 ? 1 : -1) * 2.6 * (track.rlOff[0] >= 0 ? 1 : -1);
        car.placeOnTrack(track.L - back, lat, kind === 'demo' ? 0 : 0);
        car.dist = -back;
        car.fitTires(isPlayer ? config.startCompound : this.aiStartCompound(k));
        if (isPlayer) this.player = car;
        this.cars.push(car);
      });
      if (kind === 'demo') this.phase = 'racing';
    }

    for (const car of this.cars) {
      const driver = new AIDriver(car, kind === 'demo' ? 'pro' : config.difficulty);
      this.ai.set(car, driver);
      this.prevS.set(car, car.s);
    }
    if (this.player) {
      for (const car of this.cars) if (car !== this.player) this.aheadOfPlayer.set(car, car.dist > this.player.dist);
    }

    this.aiCtx = {
      cars: this.cars,
      track,
      wetness: this.weather.wetness,
      raceTime: 0,
      started: this.phase === 'racing',
      totalLaps: Number.isFinite(this.totalLaps) ? this.totalLaps : 10,
      player: this.player,
      rubberBand: config.rubberBand && kind === 'race',
      allowPits: kind === 'race',
      yellowAt: (s) => this.yellowAt(s),
      positionOf: (car) => this.positions.get(car) ?? 12,
    };
    this.updateOrder();
  }

  get focusCar(): Car {
    return this.player ?? this.order[0] ?? this.cars[0];
  }

  positionOf(car: Car): number {
    return this.positions.get(car) ?? 1;
  }

  update(dt: number, input: Input | null): void {
    dt = Math.min(dt, 0.1);
    const player = this.player;

    if (this.phase === 'countdown') {
      const before = this.lightsOn;
      this.countdown += dt;
      this.lightsOn = Math.max(0, Math.min(5, Math.floor((this.countdown - 1) / 0.9) + 1));
      if (this.lightsOn > before) audio.beep(440, 0.18);
      if (player && input) this.readPlayerControls(input);
      if (this.countdown >= this.goAt) {
        this.phase = 'racing';
        this.lightsOn = 0;
        this.aiCtx.started = true;
        audio.beep(880, 0.45, 0.22);
        this.say('Lights out! Go, go, go!', 'good');
      }
      return;
    }

    if (player && input && !player.autopilot) this.readPlayerControls(input);
    else input?.consume('tap');

    for (const m of this.weather.update(dt, this.raceTime, this.lapSeconds)) if (this.kind === 'race') this.say(m, 'info');
    this.stepEnv.wetness = this.weather.wetness;
    this.aiCtx.wetness = this.weather.wetness;
    this.computeSlipstream();

    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.raceTime += STEP;
      this.aiCtx.raceTime = this.raceTime;
      for (const car of this.cars) {
        const driver = this.ai.get(car);
        if (driver && (!car.isPlayer || car.autopilot)) driver.update(STEP, this.aiCtx);
        this.prevS.set(car, car.s);
        car.step(STEP, this.stepEnv);
      }
      this.handleCollisions();
      for (const car of this.cars) this.afterStep(car);
      if (player && !player.inPit) this.checkYellowOvertakes(player);
    }

    this.updatePitGame(dt);
    this.updateAiPits(dt);
    this.yellow = this.yellow.filter((y) => y.until > this.raceTime);
    this.updateOrder();
    if (player && this.kind === 'race') this.playerAdvice(player);
    if (player) this.brakeHint = this.computeBrakeHint(player);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.5);
    this.messages = this.messages.filter((m) => this.raceTime - m.time < 6);
  }

  togglePit(): void {
    const car = this.player;
    if (!car || this.kind !== 'race' || car.inPit || car.finished || this.phase !== 'racing') return;
    car.pitRequest = !car.pitRequest;
    if (car.pitRequest) {
      const lapsLeft = this.totalLaps - Math.max(0, car.completed);
      car.pitCompound = bestCompoundFor(this.weather.wetness, lapsLeft / this.totalLaps);
      this.say(`Box this lap. ${COMPOUNDS[car.pitCompound].name} tires ready.`, 'info');
    } else {
      this.say('Pit stop cancelled. Stay out.', 'info');
    }
  }

  setPitCompound(c: Compound): void {
    if (this.player) this.player.pitCompound = c;
  }

  pitTap(): void {
    const g = this.pitGame;
    if (!g || g.release >= 0 || g.lockout > 0 || g.wheel >= 4) return;
    const d = Math.abs(g.needle - g.zone);
    if (d < 0.11) {
      g.results.push(d < 0.04 ? 'perfect' : 'good');
      g.flash = d < 0.04 ? 'PERFECT' : 'GOOD';
      this.nextWheel(g);
      audio.beep(d < 0.04 ? 1320 : 990, 0.08, 0.12);
    } else {
      g.lockout = 0.5;
      g.flash = 'SLIPPED';
      audio.beep(180, 0.15, 0.15);
    }
  }

  yellowAt(s: number): boolean {
    for (const y of this.yellow) {
      const d = this.track.deltaS(y.s, s);
      if (d > -260 && d < 60) return true;
    }
    return false;
  }

  gapText(car: Car): string {
    const leader = this.order[0];
    if (!leader || car === leader) return this.kind === 'demo' ? '' : 'Leader';
    const lapsDown = Math.floor((leader.dist - car.dist) / this.track.L);
    if (lapsDown >= 1) return `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
    const first = this.firstCp.get(car.cp);
    if (first === undefined || car.cp < 0) return '';
    return `+${Math.max(0, car.cpTime - first).toFixed(1)}`;
  }

  /** Gap in seconds to the car directly ahead, or null. */
  intervalAhead(car: Car): number | null {
    const pos = this.positionOf(car);
    const ahead = this.order[pos - 2];
    if (!ahead) return null;
    const t = this.firstCp.get(car.cp);
    if (t === undefined) return null;
    const lead = this.track.deltaS(car.s, ahead.s);
    return Math.max(0, lead / Math.max(10, car.speed));
  }

  classification(): ClassRow[] {
    const finished = this.cars.filter((c) => c.finished);
    const running = this.cars.filter((c) => !c.finished);
    finished.sort((a, b) => b.completed - a.completed || a.finishTime + a.penalty - (b.finishTime + b.penalty));
    running.sort((a, b) => b.dist - a.dist);
    const rows: ClassRow[] = [];
    const winner = finished[0];
    const all = [...finished, ...running];
    all.forEach((car, i) => {
      const total = car.finishTime + car.penalty;
      let gapText = '';
      if (!car.finished) gapText = 'Running';
      else if (car === winner) gapText = formatTime(total);
      else if (car.completed < winner.completed) {
        const n = winner.completed - car.completed;
        gapText = `+${n} lap${n > 1 ? 's' : ''}`;
      } else gapText = `+${(total - (winner.finishTime + winner.penalty)).toFixed(3)}s`;
      rows.push({ car, pos: i + 1, finished: car.finished, laps: car.completed, total, gapText });
    });
    return rows;
  }

  get allFinished(): boolean {
    return this.cars.every((c) => c.finished);
  }

  private say(text: string, kind: MessageKind): void {
    this.messages.push({ id: ++this.msgId, text, kind, time: this.raceTime });
    if (this.messages.length > 4) this.messages.shift();
  }

  private readPlayerControls(input: Input): void {
    const car = this.player!;
    const c = car.controls;
    c.steer = input.steer;
    c.throttle = input.throttle;
    c.brake = input.brake;
    c.boost = input.boost;
    car.assist = settings.get().steeringHelp;
    if (input.consume('pit')) this.togglePit();
    if (input.consume('tap') && this.pitGame) this.pitTap();
  }

  private aiStartCompound(k: number): Compound {
    const w = this.weather.wetness;
    if (w > 0.62) return 'wet';
    if (w > 0.22) return 'inter';
    if (this.config.lapsMode === 'short') return k % 3 === 0 ? 'soft' : 'medium';
    return k % 4 === 0 ? 'soft' : k % 4 === 3 ? 'hard' : 'medium';
  }

  private afterStep(car: Car): void {
    const track = this.track;
    for (const e of car.events) {
      switch (e.type) {
        case 'wall':
          if (e.strength > 5 && this.sparks.length < 20) this.sparks.push({ x: car.x, y: car.y, z: car.z, n: Math.min(30, Math.round(e.strength * 1.5)) });
          if (car.isPlayer) {
            audio.thump(e.strength);
            vibrate(Math.min(200, e.strength * 10));
            this.shake = Math.min(1, this.shake + e.strength / 25);
          }
          if (e.strength > 14) this.addYellow(car.s);
          break;
        case 'spin':
          this.addYellow(car.s);
          if (car.isPlayer) this.say('Spin! Hold on.', 'warn');
          break;
        case 'pitSpeeding':
          this.addPenalty(car, `Pit lane speeding (${Math.round(e.speed * 3.6)} km/h)`);
          break;
        case 'pitStopped':
          if (car.isPlayer && !car.autopilot) this.startPitGame();
          else this.aiPitTimers.set(car, 2.2 + Math.random() * 1.2);
          break;
        case 'pitExit':
          if (car.isPlayer) this.say(`Out of the pits on ${COMPOUNDS[car.compound].name} tires. Cold tires, take care.`, 'info');
          this.tireWarnReset(car);
          break;
      }
    }
    car.events.length = 0;

    if (this.kind === 'race' && car.pitRequest && car.pit === 'none' && !car.spinning && !car.finished) {
      const before = track.deltaS(track.pitEntryS, this.prevS.get(car) ?? car.s);
      const after = track.deltaS(track.pitEntryS, car.s);
      if (before < 0 && after >= 0 && after < 25) car.beginPit();
    }

    const comp = Math.floor(car.dist / track.L);
    if (comp > car.completed) {
      const prev = car.completed;
      car.completed = comp;
      if (prev >= 0) this.recordLap(car, this.raceTime - car.lapStart);
      car.lapStart = this.raceTime;
      car.lapValid = true;
      if (car === this.order[0] && prev >= 0) track.driftPatches();
      if (this.kind === 'race' && !car.finished && (comp >= this.totalLaps || (this.leaderFinished && prev >= 0))) {
        this.finishCar(car);
      } else if (this.kind === 'qualifying' && comp >= this.totalLaps) {
        this.finishQualifying();
      }
      if (this.kind === 'race' && car === this.order[0] && comp === this.totalLaps - 1 && !this.finalLapAnnounced) {
        this.finalLapAnnounced = true;
        this.say('Final lap!', 'info');
      }
    }

    const cp = Math.floor(car.dist / (track.L / CHECKPOINTS));
    if (cp > car.cp) {
      car.cp = cp;
      car.cpTime = this.raceTime;
      if (!this.firstCp.has(cp)) this.firstCp.set(cp, this.raceTime);
    }

    if (!car.inPit) {
      if (car.offTrack && car.speed > 12 && Math.abs(track.kappa[car.idx]) > 0.002) {
        if (!car.excursion) {
          car.excursion = true;
          if (car.lapValid && this.kind === 'qualifying' && car.completed >= 0) this.say('Track limits. Lap time deleted.', 'penalty');
          car.lapValid = false;
          if (this.kind === 'race') {
            car.warnings++;
            if (car.warnings % 3 === 0) this.addPenalty(car, 'Repeated track limits');
            else if (car.isPlayer) this.say(`Track limits warning ${car.warnings % 3}/3.`, 'warn');
          }
        }
      } else if (Math.abs(car.lat) < track.hw) {
        car.excursion = false;
      }
    }

    if (!car.inPit && this.phase !== 'countdown') {
      const trackHeading = Math.atan2(track.tx[car.idx], track.tz[car.idx]);
      const rel = Math.abs(wrapAngle(car.heading - trackHeading));
      const was = this.wasSpinning.get(car) ?? false;
      this.wasSpinning.set(car, car.spinning);
      if (was && !car.spinning && (rel > 1.75 || Math.abs(car.lat) > track.hw + 3)) {
        this.respawn(car);
        return;
      }
      if (!car.spinning) {
        const reversing = car.forwardSpeed < -1 && car.isPlayer;
        if (rel > 1.9 && car.speed > 3 && !reversing) car.wrongWayTimer += STEP;
        else car.wrongWayTimer = 0;
        if (car.wrongWayTimer > (car.isPlayer && !car.autopilot ? 3 : 1)) {
          this.respawn(car);
          return;
        }
        const stuck = car.speed < 2 && this.raceTime > 4 && (car.offTrack || !car.isPlayer || car.autopilot);
        car.stuckTimer = stuck ? car.stuckTimer + STEP : 0;
        if (car.stuckTimer > (car.isPlayer && !car.autopilot ? 4 : 2.5)) this.respawn(car);
      }
    }
  }

  private respawn(car: Car): void {
    this.addYellow(car.s);
    car.respawn();
    if (car.isPlayer) this.say('Back on track.', 'info');
  }

  private addYellow(s: number): void {
    if (this.kind !== 'race') return;
    this.yellow.push({ s, until: this.raceTime + 8 });
  }

  private addPenalty(car: Car, reason: string): void {
    if (this.kind !== 'race') return;
    car.penalty += PENALTY;
    if (car.isPlayer) this.say(`+${PENALTY}s penalty: ${reason}.`, 'penalty');
  }

  private recordLap(car: Car, t: number): void {
    car.lapTimes.push(t);
    car.lastLap = t;
    const valid = this.kind !== 'qualifying' || car.lapValid;
    if (valid && t < car.bestLap) car.bestLap = t;
    if (this.kind === 'qualifying') {
      if (valid) this.qualifyingLaps.push(t);
      this.say(valid ? `Lap time ${formatTime(t)}` : 'Lap deleted.', valid ? 'good' : 'penalty');
      return;
    }
    if (this.kind === 'race' && t < this.fastestLap) {
      this.fastestLap = t;
      this.fastestCar = car;
      if (car.isPlayer && car.completed > 1) this.say(`Fastest lap! ${formatTime(t)}`, 'purple');
    }
    if (car.isPlayer && this.kind === 'race' && !car.finished) {
      const interval = this.intervalAhead(car);
      const pos = this.positionOf(car);
      if (interval !== null && pos > 1 && car.completed % 2 === 0) this.say(`P${pos}. Gap to the car ahead: ${interval.toFixed(1)}s.`, 'info');
    }
  }

  private finishCar(car: Car): void {
    car.finished = true;
    car.finishTime = this.raceTime;
    car.pitRequest = false;
    this.finishOrder.push(car);
    if (!this.leaderFinished) {
      this.leaderFinished = true;
      this.say(`Chequered flag! ${car.entry.driver.name} wins on the road.`, 'good');
    }
    if (car.isPlayer) {
      car.autopilot = true;
      this.playerFinishedAt = this.raceTime;
      this.phase = 'finished';
      this.pitGame = null;
      this.onPlayerFinished?.();
    }
  }

  private finishQualifying(): void {
    if (this.qualifyingDoneFired) return;
    this.qualifyingDoneFired = true;
    this.phase = 'finished';
    if (this.player) this.player.autopilot = true;
    const best = this.qualifyingLaps.length ? Math.min(...this.qualifyingLaps) : null;
    this.onQualifyingDone?.(best);
  }

  private startPitGame(): void {
    this.pitGame = {
      wheel: 0,
      needle: 0,
      dir: 1,
      zone: 0.3 + Math.random() * 0.4,
      lockout: 0,
      waited: 0,
      elapsed: 0,
      release: -1,
      results: [],
      flash: '',
    };
  }

  private nextWheel(g: PitGame): void {
    g.wheel++;
    g.waited = 0;
    g.zone = 0.25 + Math.random() * 0.5;
    if (g.wheel >= 4) g.release = 0.35;
  }

  private updatePitGame(dt: number): void {
    const g = this.pitGame;
    const car = this.player;
    if (!g || !car) return;
    g.elapsed += dt;
    if (g.release >= 0) {
      g.release -= dt;
      if (g.release < 0) {
        car.finishPitStop();
        const perfect = g.results.filter((r) => r === 'perfect').length;
        this.say(`Pit stop ${g.elapsed.toFixed(1)}s${perfect === 4 ? ' - perfect crew work!' : ''}`, perfect === 4 ? 'good' : 'info');
        this.pitGame = null;
      }
      return;
    }
    g.needle += g.dir * dt * 1.5;
    if (g.needle > 1) {
      g.needle = 2 - g.needle;
      g.dir = -1;
    } else if (g.needle < 0) {
      g.needle = -g.needle;
      g.dir = 1;
    }
    if (g.lockout > 0) g.lockout -= dt;
    g.waited += dt;
    if (g.waited > 3) {
      g.results.push('slow');
      g.flash = 'SLOW';
      this.nextWheel(g);
    }
  }

  private updateAiPits(dt: number): void {
    for (const [car, t] of this.aiPitTimers) {
      const left = t - dt;
      if (left <= 0) {
        this.aiPitTimers.delete(car);
        if (car.pit === 'stopped') car.finishPitStop();
      } else this.aiPitTimers.set(car, left);
    }
  }

  private computeSlipstream(): void {
    const track = this.track;
    for (const car of this.cars) {
      car.slipstream = 0;
      if (car.inPit || car.speed < 25) continue;
      let best = 0;
      for (const o of this.cars) {
        if (o === car || o.inPit || o.speed < 25) continue;
        const gap = track.deltaS(car.s, o.s);
        if (gap > 4 && gap < 40 && Math.abs(o.lat - car.lat) < 2.2) best = Math.max(best, 1 - gap / 40);
      }
      const trait = car.entry.driver.traits.includes('slipstream') ? 1.4 : 1;
      car.slipstream = Math.min(1.6, best * track.slipstreamMult * trait);
    }
  }

  private handleCollisions(): void {
    const cars = this.cars;
    const R = 1.12;
    const OFF = 1.35;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.inPit || a.ghost > 0) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.inPit || b.ghost > 0) continue;
        const dx0 = a.x - b.x;
        const dz0 = a.z - b.z;
        if (dx0 * dx0 + dz0 * dz0 > 49) continue;
        let impact = 0;
        const asx = Math.sin(a.heading);
        const acz = Math.cos(a.heading);
        const bsx = Math.sin(b.heading);
        const bcz = Math.cos(b.heading);
        for (let ia = -1; ia <= 1; ia += 2) {
          for (let ib = -1; ib <= 1; ib += 2) {
            const ax = a.x + asx * OFF * ia;
            const az = a.z + acz * OFF * ia;
            const bx = b.x + bsx * OFF * ib;
            const bz = b.z + bcz * OFF * ib;
            const dx = ax - bx;
            const dz = az - bz;
            const d = Math.hypot(dx, dz);
            if (d >= R * 2 || d < 1e-4) continue;
            const nx = dx / d;
            const nz = dz / d;
            const overlap = R * 2 - d;
            a.x += (nx * overlap) / 2;
            a.z += (nz * overlap) / 2;
            b.x -= (nx * overlap) / 2;
            b.z -= (nz * overlap) / 2;
            const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
            if (vrel < 0) {
              const jimp = (-(1 + 0.3) * vrel) / 2;
              a.vx += nx * jimp;
              a.vz += nz * jimp;
              b.vx -= nx * jimp;
              b.vz -= nz * jimp;
              impact = Math.max(impact, -vrel);
              a.heading += ia * 0.012 * Math.sign(nx * acz - nz * asx) * Math.min(4, -vrel);
              b.heading -= ib * 0.012 * Math.sign(nx * bcz - nz * bsx) * Math.min(4, -vrel);
            }
          }
        }
        if (impact > 1) this.onContact(a, b, impact);
      }
    }
  }

  private onContact(a: Car, b: Car, impact: number): void {
    const front = a.dist > b.dist ? a : b;
    const rear = front === a ? b : a;
    if (impact > 4 && this.sparks.length < 20) {
      this.sparks.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, n: Math.min(30, Math.round(impact * 2)) });
    }
    for (const car of [a, b]) {
      car.vx *= 0.985;
      car.vz *= 0.985;
      if (car.isPlayer && impact > 2) {
        audio.thump(impact);
        vibrate(Math.min(250, impact * 15));
        this.shake = Math.min(1, this.shake + impact / 20);
      }
    }
    if (impact > 3) {
      if (a.isPlayer) this.ai.get(b)?.noteContactWithPlayer();
      if (b.isPlayer) this.ai.get(a)?.noteContactWithPlayer();
    }
    if (impact > 10 && Math.random() < 0.7) {
      front.startSpin((Math.random() < 0.5 ? -1 : 1) * (2.5 + impact * 0.12));
      if (rear.isPlayer && front.spinning) this.addPenalty(rear, 'Causing a collision');
    }
  }

  private checkYellowOvertakes(player: Car): void {
    const inYellow = this.yellowAt(player.s);
    for (const o of this.cars) {
      if (o === player) continue;
      const ahead = o.dist > player.dist;
      const was = this.aheadOfPlayer.get(o) ?? ahead;
      this.aheadOfPlayer.set(o, ahead);
      if (was && !ahead && inYellow && !o.inPit && !o.spinning && o.incidentTimer <= 0 && o.speed > 15) {
        if (this.raceTime - this.lastYellowPenalty > 5) {
          this.lastYellowPenalty = this.raceTime;
          this.addPenalty(player, 'Overtaking under yellow flag');
        }
      }
    }
  }

  private updateOrder(): void {
    const finishIndex = new Map<Car, number>();
    this.finishOrder.forEach((c, i) => finishIndex.set(c, i));
    this.order = [...this.cars].sort((a, b) => {
      const fa = finishIndex.get(a);
      const fb = finishIndex.get(b);
      if (fa !== undefined && fb !== undefined) return fa - fb;
      if (fa !== undefined) return -1;
      if (fb !== undefined) return 1;
      return b.dist - a.dist;
    });
    this.order.forEach((c, i) => this.positions.set(c, i + 1));
  }

  private tireWarnReset(car: Car): void {
    if (car.isPlayer) this.tireWarned = 0;
  }

  private playerAdvice(car: Car): void {
    if (car.finished) return;
    if (car.wear > 0.6 && this.tireWarned < 1) {
      this.tireWarned = 1;
      this.say('Tires are starting to fade.', 'warn');
    } else if (car.wear > 0.8 && this.tireWarned < 2) {
      this.tireWarned = 2;
      this.say('Tires are nearly gone. Box this lap?', 'warn');
    }
    const w = this.weather.wetness;
    let hint = '';
    if (w > 0.66 && car.compound !== 'wet') hint = 'Heavy rain. Full wets would be faster.';
    else if (w > 0.3 && isDryCompound(car.compound)) hint = 'The track is wet. Consider intermediates.';
    else if (w < 0.12 && !isDryCompound(car.compound) && this.raceTime > 10) hint = 'The track is drying. Slicks would be faster.';
    if (hint && hint !== this.hintGiven) {
      this.hintGiven = hint;
      this.say(hint, 'warn');
    }
  }

  private computeBrakeHint(car: Car): boolean {
    if (car.inPit || car.spinning) return false;
    const track = this.track;
    const v = car.speed;
    const grip = car.tireGrip(this.weather.wetness);
    const decel = Math.min(PHYS.BRAKE, lateralGrip(v) * grip) * 0.85;
    const scale = Math.sqrt(grip) * 0.97;
    const range = Math.ceil((v * v) / (2 * decel) / 2) + 6;
    for (let j = 0; j <= range; j += 2) {
      const k = track.wrap(car.idx + j);
      const vc = track.cornerV[k] * scale;
      const allowed = Math.sqrt(vc * vc + 2 * decel * j * (track.L / track.N));
      if (v > allowed + 2) return true;
    }
    return false;
  }
}

export function formatTime(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
