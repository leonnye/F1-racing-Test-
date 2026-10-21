import type { Difficulty } from '../core/settings';
import { COMPOUNDS, type Compound, isDryCompound } from '../data/tires';
import type { Car } from './car';
import { PHYS, clamp, lateralGrip, wrapAngle } from './physics';
import type { TrackModel, TrackPoint } from './trackModel';

export const DIFFICULTY_PACE: Record<Difficulty, number> = {
  rookie: 0.86,
  pro: 0.935,
  legend: 0.985,
};

const MISTAKE_MULT: Record<Difficulty, number> = {
  rookie: 2,
  pro: 1,
  legend: 0.45,
};

export interface AIContext {
  cars: Car[];
  track: TrackModel;
  wetness: number;
  raceTime: number;
  started: boolean;
  totalLaps: number;
  player: Car | null;
  rubberBand: boolean;
  allowPits: boolean;
  yellowAt: (s: number) => boolean;
  positionOf: (car: Car) => number;
}

const tmpPoint: TrackPoint = { x: 0, z: 0, y: 0, heading: 0, nx: 0, nz: 0, i: 0 };

export class AIDriver {
  readonly car: Car;
  readonly difficulty: Difficulty;
  basePace: number;
  reaction: number;
  personalOffset: number;
  latCurrent = 0;
  passSide = 0;
  passTimer = 0;
  mistakeTimer = 0;
  mistakeKind: 'wide' | 'late' = 'wide';
  revengeTimer = 0;
  grudge = 0;
  lastPosition = 99;
  strategyTimer = 0;
  wearLimit: number;

  constructor(car: Car, difficulty: Difficulty) {
    this.car = car;
    this.difficulty = difficulty;
    const st = car.entry.driver.stats;
    this.basePace =
      DIFFICULTY_PACE[difficulty] *
      (1 + (st.qualifying - 0.55) * 0.02 + (st.consistency - 0.55) * 0.012 + (Math.random() - 0.5) * 0.01);
    this.reaction = 0.15 + (1 - st.starts) * 0.5 + Math.random() * 0.15;
    this.personalOffset = (Math.random() - 0.5) * 1.2;
    this.wearLimit = 0.72 + st.tireCare * 0.14 + (Math.random() - 0.5) * 0.06;
    this.latCurrent = car.lat;
  }

  update(dt: number, ctx: AIContext): void {
    const car = this.car;
    const c = car.controls;
    const track = ctx.track;
    if (car.inPit) {
      c.steer = 0;
      c.throttle = 0;
      c.brake = 0;
      c.boost = false;
      return;
    }
    if (!ctx.started || ctx.raceTime < this.reaction) {
      c.steer = 0;
      c.throttle = 0;
      c.brake = 1;
      c.boost = false;
      this.latCurrent = car.lat;
      return;
    }

    const st = car.entry.driver.stats;
    const traits = car.entry.driver.traits;
    const position = ctx.positionOf(car);
    if (position > this.lastPosition && traits.includes('revenge')) this.revengeTimer = 15;
    this.lastPosition = position;
    if (this.revengeTimer > 0) this.revengeTimer -= dt;
    if (this.passTimer > 0) this.passTimer -= dt;
    if (this.grudge > 0) this.grudge = Math.max(0, this.grudge - dt * 0.01);

    const progress = clamp((car.completed + 0.5) / Math.max(1, ctx.totalLaps), 0, 1);
    let pace = this.basePace;
    if (traits.includes('adapts')) pace *= 1 - 0.015 + 0.03 * progress;
    if (traits.includes('comeback') && position > 6) pace *= 1.012;
    if (this.revengeTimer > 0) pace *= 1.02;
    pace *= 1 + (st.wet - 0.5) * 0.03 * ctx.wetness;
    if (car.finished) pace *= 0.72;

    if (ctx.rubberBand && ctx.player && !car.finished) {
      const gap = ctx.player.dist - car.dist;
      if (gap > 80) pace *= 1 + Math.min(0.035, (gap - 80) / 6000);
      else if (gap < -80) pace *= 1 - Math.min(0.03, (-gap - 80) / 6000);
    }
    const yellow = ctx.yellowAt(car.s);
    if (yellow) pace *= 0.86;

    this.updateMistakes(dt, ctx, position);
    let cornerMult = pace;
    let decelMult = 0.8;
    if (this.mistakeTimer > 0) {
      if (this.mistakeKind === 'wide') cornerMult *= 1.13;
      else decelMult = 1.15;
    }

    if (ctx.allowPits && !car.finished) {
      this.strategyTimer -= dt;
      if (this.strategyTimer <= 0) {
        this.strategyTimer = 1;
        this.planPit(ctx);
      }
    }

    // Lateral target: racing line plus traffic handling.
    const v = car.speed;
    const look = 9 + v * 0.42;
    const lookS = car.s + look;
    const lookIdx = track.indexAt(lookS);
    let desiredLat = track.rlOff[lookIdx] * 0.92 + this.personalOffset;

    let blocker: Car | null = null;
    let blockGap = Infinity;
    let carsNear = 0;
    let pressure = false;
    for (const o of ctx.cars) {
      if (o === car || o.inPit) continue;
      const gap = track.deltaS(car.s, o.s);
      const latDiff = o.lat - car.lat;
      if (Math.abs(gap) < 15) carsNear++;
      if (gap < 0 && gap > -12 && Math.abs(latDiff) < 3) pressure = true;
      if (o.ghost > 0 || car.ghost > 0) continue;
      if (gap > 0 && gap < 38 && Math.abs(o.lat - this.latCurrent) < 2.5 && gap < blockGap) {
        blocker = o;
        blockGap = gap;
      }
      if (Math.abs(gap) < 6.5 && Math.abs(latDiff) < 2.8) {
        desiredLat -= Math.sign(latDiff || 1) * (2.9 - Math.abs(latDiff)) * 1.3;
      }
    }

    let followSpeed = Infinity;
    if (blocker) {
      const closing = v > blocker.speed - 2;
      const cornerSoon = track.cornerV[track.indexAt(car.s + 70)] < 50;
      const willing = st.overtaking > 0.45 || !cornerSoon;
      if (closing && !yellow && willing && !car.finished) {
        if (this.passTimer <= 0 || this.passSide === 0) {
          const room = track.hw - 1.3;
          const left = blocker.lat + 3.3;
          const right = blocker.lat - 3.3;
          const leftOk = left <= room;
          const rightOk = right >= -room;
          const prefer = track.rlOff[track.indexAt(car.s + 60)] >= 0 ? 1 : -1;
          if (leftOk && rightOk) this.passSide = prefer;
          else if (leftOk) this.passSide = 1;
          else if (rightOk) this.passSide = -1;
          else this.passSide = 0;
          this.passTimer = 2.2 + (1 - st.overtaking) * 1.5;
        }
        if (this.passSide !== 0) desiredLat = blocker.lat + this.passSide * 3.3;
      }
      const lateralClear = Math.abs(blocker.lat - car.lat) > 2.3;
      if (!lateralClear) followSpeed = blocker.speed + (blockGap - 8) * 0.9;
    } else {
      this.passSide = 0;
    }

    const player = ctx.player;
    if (player && this.grudge > 0.25 && !player.inPit) {
      const gap = track.deltaS(car.s, player.s);
      if (gap < 0 && gap > -30) desiredLat += (player.lat - desiredLat) * 0.5 * this.grudge;
    }

    const maxLat = track.hw - 1.2;
    desiredLat = clamp(desiredLat, -maxLat, maxLat);
    const latRate = 4.5 * dt;
    this.latCurrent += clamp(desiredLat - this.latCurrent, -latRate, latRate);

    // Pure pursuit steering toward the look-ahead point.
    track.pointAt(lookS, this.latCurrent, tmpPoint);
    const dx = tmpPoint.x - car.x;
    const dz = tmpPoint.z - car.z;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const fwd = dx * fx + dz * fz;
    const left = dx * fz - dz * fx;
    const d2 = Math.max(1, fwd * fwd + left * left);
    const curvature = (2 * left) / d2;
    const absV = Math.max(4, Math.abs(car.forwardSpeed));
    const tireGrip = car.tireGrip(ctx.wetness);
    const G = lateralGrip(absV) * tireGrip;
    const steerAngle = PHYS.MAX_STEER * (1 - Math.min(0.65, absV / 140));
    const geomYaw = (absV * Math.tan(steerAngle)) / PHYS.WHEELBASE;
    const gripYaw = (1.16 * G) / absV;
    const maxYaw = Math.min(geomYaw, gripYaw);
    let steer = clamp((curvature * absV) / maxYaw, -1, 1);
    const headingErr = wrapAngle(Math.atan2(dx, dz) - car.heading);
    if (Math.abs(headingErr) > 1.4) steer = Math.sign(headingErr);
    c.steer = steer;

    // Speed: the lowest speed we must hit within braking range.
    const decel = Math.min(PHYS.BRAKE, lateralGrip(v) * tireGrip) * decelMult;
    const gripScale = Math.sqrt(tireGrip) * cornerMult;
    let targetV = PHYS.VMAX * 1.3;
    const stepSamples = 2;
    const range = Math.min(track.N - 1, Math.ceil((v * v) / (2 * decel) / 2) + 10);
    for (let j = 0; j <= range; j += stepSamples) {
      const k = track.wrap(car.idx + j);
      const dist = j * (track.L / track.N);
      const vc = track.cornerV[k] * gripScale;
      const allowed = Math.sqrt(vc * vc + 2 * decel * dist);
      if (allowed < targetV) targetV = allowed;
    }
    for (const p of track.patches) {
      if (p.kind === 'puddle' && ctx.wetness < 0.5) continue;
      const d = track.deltaS(car.s, p.s);
      if (d < -p.len || d > range * (track.L / track.N)) continue;
      if (Math.abs(this.latCurrent - p.lat) > p.width / 2 + 1.2) continue;
      const surface = p.kind === 'ice' ? 0.45 : p.kind === 'sand' ? 0.62 : 0.74;
      let vc = Infinity;
      const start = track.indexAt(p.s);
      const n = Math.ceil(p.len / (track.L / track.N));
      for (let k = 0; k <= n; k += 2) vc = Math.min(vc, track.cornerV[track.wrap(start + k)]);
      vc *= Math.sqrt(tireGrip * surface) * cornerMult * 0.97;
      const allowed = Math.sqrt(vc * vc + 2 * decel * Math.max(0, d));
      if (allowed < targetV) targetV = allowed;
    }
    if (car.pitRequest) {
      const d = track.deltaS(car.s, track.pitEntryS);
      if (d > 0 && d < 500) targetV = Math.min(targetV, Math.sqrt(PHYS.PIT_LIMIT ** 2 + 2 * 22 * Math.max(0, d + track.pitRamp - 20)));
    }
    targetV = Math.min(targetV, followSpeed);
    if (car.surface === 'off') targetV = Math.min(targetV, 35);

    if (v < targetV - 0.3) {
      c.throttle = 1;
      c.brake = 0;
    } else if (v > targetV + 1.2) {
      c.throttle = 0;
      c.brake = clamp((v - targetV) / 6, 0.25, 1);
    } else {
      c.throttle = 0.35;
      c.brake = 0;
    }

    const straightAhead = track.cornerV[track.indexAt(car.s + 120)] > 70;
    const attacking = blocker !== null && blockGap < 45;
    c.boost =
      !car.finished && !yellow && straightAhead && c.throttle === 1 && car.boostEnergy > (attacking || pressure ? 0.25 : 0.7);

    const traitsPressure = pressure ? 1 + (1 - st.composure) * 1.5 : 1;
    this.pressureFactor = traitsPressure * (traits.includes('chaosWeak') && carsNear >= 3 ? 2 : 1);
  }

  private pressureFactor = 1;

  noteContactWithPlayer(): void {
    this.grudge = Math.min(1, this.grudge + 0.4);
  }

  private updateMistakes(dt: number, ctx: AIContext, position: number): void {
    if (this.mistakeTimer > 0) {
      this.mistakeTimer -= dt;
      return;
    }
    const car = this.car;
    const st = car.entry.driver.stats;
    let rate = (1 - st.consistency) * 0.012 * MISTAKE_MULT[this.difficulty] * this.pressureFactor;
    if (car.entry.driver.traits.includes('earlyFocusWeak') && car.completed < 2) rate *= 2;
    if (car.entry.driver.traits.includes('adapts') && car.completed < 2) rate *= 1.5;
    if (position === 1) rate *= 0.8;
    rate *= 1 + ctx.wetness * (1 - st.wet);
    if (Math.random() < rate * dt) {
      this.mistakeTimer = 0.7 + Math.random() * 0.7;
      this.mistakeKind = Math.random() < 0.55 ? 'wide' : 'late';
    }
  }

  private planPit(ctx: AIContext): void {
    const car = this.car;
    if (car.pitRequest || car.inPit) return;
    const w = ctx.wetness;
    const lapsLeft = ctx.totalLaps - car.completed - car.track.wrapS(car.dist) / car.track.L;
    if (lapsLeft < 0.9) return;
    const remFrac = clamp(lapsLeft / ctx.totalLaps, 0, 1);
    const skill = car.entry.driver.stats.wet;
    const compound = car.compound;
    let want: Compound | null = null;
    if (w > 0.66 + skill * 0.06 && compound !== 'wet') want = 'wet';
    else if (w > 0.26 + skill * 0.05 && isDryCompound(compound)) want = 'inter';
    else if (w < 0.14 && !isDryCompound(compound)) want = lapsLeft > ctx.totalLaps * 0.45 ? 'medium' : 'soft';
    else if (w < 0.5 && compound === 'wet' && w < 0.4) want = 'inter';
    else if (car.wear > this.wearLimit && lapsLeft > 1.6) {
      if (w > 0.26) want = w > 0.66 ? 'wet' : 'inter';
      else {
        const lastLapsWear = COMPOUNDS.soft.wear * lapsLeft;
        want = remFrac > 0.55 ? 'hard' : remFrac > 0.3 || lastLapsWear > ctx.totalLaps * 0.6 ? 'medium' : 'soft';
      }
    }
    if (want) {
      car.pitRequest = true;
      car.pitCompound = want;
    }
  }
}
