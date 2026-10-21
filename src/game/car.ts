import type { Entry } from '../data/teams';
import { COMPOUNDS, type Compound, wearGrip, weatherGrip, weatherWear } from '../data/tires';
import { PHYS, clamp, lateralGrip, wrapAngle } from './physics';
import type { Projection, TrackModel, TrackPoint } from './trackModel';

export type PitState = 'none' | 'entry' | 'lane' | 'stopped' | 'exit';
export type CarEvent =
  | { type: 'wall'; strength: number }
  | { type: 'spin' }
  | { type: 'pitSpeeding'; speed: number }
  | { type: 'pitStopped' }
  | { type: 'pitExit' };

export interface Controls {
  steer: number;
  throttle: number;
  brake: number;
  boost: boolean;
}

export interface StepEnv {
  wetness: number;
  /** Wear per meter for a medium tire at normal wear rate on this race. */
  wearBase: number;
  wearMult: number;
}

const tmpProj: Projection = { i: 0, s: 0, lat: 0 };
const tmpPoint: TrackPoint = { x: 0, z: 0, y: 0, heading: 0, nx: 0, nz: 0, i: 0 };

export class Car {
  readonly id: number;
  readonly entry: Entry;
  readonly isPlayer: boolean;
  readonly teamIndex: number;
  readonly track: TrackModel;

  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  steerActual = 0;
  roll = 0;
  wheelSpin = 0;

  idx = 0;
  s = 0;
  lat = 0;
  dist = 0;
  completed = -1;
  lapStart = 0;
  lastLap = 0;
  bestLap = Infinity;
  lapTimes: number[] = [];
  finished = false;
  finishTime = 0;
  cp = -1;
  cpTime = 0;
  lapValid = true;

  compound: Compound = 'medium';
  wear = 0;
  tireTemp = 0.5;
  stints: Compound[] = [];
  boostEnergy = 1;
  boosting = false;

  spinning = false;
  spinTimer = 0;
  spinRate = 0;
  ghost = 0;
  offTrack = false;
  onKerb = false;
  sliding = 0;
  slipstream = 0;
  surface: 'track' | 'kerb' | 'off' | 'sand' | 'ice' | 'puddle' = 'track';
  gripMult = 1;
  wrongWayTimer = 0;
  stuckTimer = 0;

  pit: PitState = 'none';
  pitRequest = false;
  pitCompound: Compound = 'medium';
  pitU = 0;
  pitSpeed = 0;
  pitEntryLat = 0;
  pitStopDone = false;
  pitStops = 0;

  penalty = 0;
  warnings = 0;
  excursion = false;
  incidentTimer = 0;

  controls: Controls = { steer: 0, throttle: 0, brake: 0, boost: false };
  assist = false;
  /** True when the AI drives the player's car (cool-down lap after the flag). */
  autopilot = false;
  events: CarEvent[] = [];

  constructor(id: number, entry: Entry, isPlayer: boolean, teamIndex: number, track: TrackModel) {
    this.id = id;
    this.entry = entry;
    this.isPlayer = isPlayer;
    this.teamIndex = teamIndex;
    this.track = track;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardSpeed(): number {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }

  get inPit(): boolean {
    return this.pit !== 'none';
  }

  placeOnTrack(s: number, lat: number, speed = 0): void {
    const p = this.track.pointAt(s, lat, tmpPoint);
    this.x = p.x;
    this.z = p.z;
    this.y = p.y;
    this.heading = p.heading;
    this.vx = Math.sin(p.heading) * speed;
    this.vz = Math.cos(p.heading) * speed;
    this.track.project(this.x, this.z, p.i, tmpProj, 4);
    this.idx = tmpProj.i;
    this.s = tmpProj.s;
    this.lat = tmpProj.lat;
  }

  fitTires(compound: Compound): void {
    this.compound = compound;
    this.wear = 0;
    this.tireTemp = 0.15 + this.track.temperature * 0.35;
    this.stints.push(compound);
  }

  /** Combined grip multiplier from tires, weather, driver skill, and surface. */
  tireGrip(wetness: number): number {
    const stats = this.entry.driver.stats;
    const temp = this.tireTemp;
    let tempGrip = 0.86 + 0.14 * Math.min(1, temp / 0.7);
    if (temp > 0.92) tempGrip -= (temp - 0.92) * 0.6;
    const wetSkill = 1 + (stats.wet - 0.5) * 0.08 * wetness;
    return weatherGrip(this.compound, wetness) * wearGrip(this.wear) * tempGrip * wetSkill;
  }

  step(dt: number, env: StepEnv): void {
    if (this.pit !== 'none') {
      this.pitStep(dt);
      return;
    }
    const track = this.track;
    const c = this.controls;
    if (this.ghost > 0) this.ghost -= dt;
    if (this.incidentTimer > 0) this.incidentTimer -= dt;

    const surfaceGrip = this.surfaceGrip(env.wetness);
    this.gripMult = this.tireGrip(env.wetness) * surfaceGrip;
    const bankBonus = Math.abs(track.bank[this.idx]) * 9.8 * 1.5;

    let fx = Math.sin(this.heading);
    let fz = Math.cos(this.heading);
    let vf = this.vx * fx + this.vz * fz;
    const absV = Math.abs(vf);
    const G = lateralGrip(absV) * this.gripMult + bankBonus;

    if (this.spinning) {
      this.spinTimer -= dt;
      this.heading += this.spinRate * dt;
      this.spinRate *= Math.exp(-1.6 * dt);
      const v = this.speed;
      const nv = Math.max(0, v - 9 * dt);
      const k = v > 0 ? nv / v : 0;
      this.vx *= k;
      this.vz *= k;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.sliding = v;
      if (this.spinTimer <= 0) this.spinning = false;
      this.updateTrackPosition();
      this.updateTires(dt, env, 0, 1);
      return;
    }

    const steerTarget = clamp(c.steer, -1, 1);
    const analog = !this.isPlayer || this.autopilot || Math.abs(steerTarget) % 1 !== 0;
    const rate = analog ? 10 : Math.abs(steerTarget) > Math.abs(this.steerActual) ? 3.4 : 7;
    const ds = steerTarget - this.steerActual;
    this.steerActual += clamp(ds, -rate * dt, rate * dt);

    const steerAngle = PHYS.MAX_STEER * (1 - Math.min(0.65, absV / 140));
    const geomYaw = (absV * Math.tan(steerAngle)) / PHYS.WHEELBASE;
    const gripYaw = ((this.assist ? 1.0 : 1.16) * G) / Math.max(absV, 4);
    const dir = vf >= -0.5 ? 1 : -1;
    let yaw = this.steerActual * Math.min(geomYaw, gripYaw) * dir;

    if (this.assist && absV > 6) {
      const ahead = track.wrap(this.idx + 4 + Math.floor(absV * 0.15));
      const trackHeading = Math.atan2(track.tx[ahead], track.tz[ahead]);
      const diff = wrapAngle(trackHeading - this.heading);
      const help = (1 - Math.abs(this.steerActual)) * clamp(diff * 1.4, -0.35, 0.35);
      if (Math.abs(diff) < 1.2) yaw = clamp(yaw + help * Math.min(1, absV / 20), -gripYaw, gripYaw);
    }

    this.yawRate = yaw;
    this.heading = wrapAngle(this.heading + yaw * dt);
    fx = Math.sin(this.heading);
    fz = Math.cos(this.heading);
    const lx = fz;
    const lz = -fx;
    vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;

    const canBoost = c.boost && this.boostEnergy > 0.02 && vf > 5 && c.throttle > 0;
    this.boosting = canBoost;
    if (canBoost) this.boostEnergy = Math.max(0, this.boostEnergy - dt * 0.24);
    else this.boostEnergy = Math.min(1, this.boostEnergy + dt * (0.035 + c.brake * 0.12 * Math.min(1, absV / 40)));

    const vtop = PHYS.VMAX * (canBoost ? PHYS.BOOST_VMAX : 1) * (1 + this.slipstream * 0.055);
    let a = 0;
    if (c.throttle > 0) {
      let engine = PHYS.ACCEL * c.throttle * (1 - (Math.max(0, vf) / vtop) ** 2);
      engine = Math.min(engine, G * 0.95);
      if (canBoost) engine += PHYS.BOOST_ACCEL * Math.max(0, 1 - vf / vtop);
      engine += this.slipstream * 1.6;
      a += engine;
    } else {
      a -= Math.sign(vf) * 1.4;
    }
    a -= 0.00012 * vf * Math.abs(vf);
    let reversing = false;
    if (c.brake > 0) {
      if (vf > 0.8) a -= Math.min(PHYS.BRAKE, G * 1.05) * c.brake;
      else if (c.throttle === 0) {
        reversing = true;
        if (vf > -8) a -= 7 * c.brake;
      }
    }
    if (this.offTrack) a -= 0.0045 * vf * Math.abs(vf) + 2.5 * Math.sign(vf);
    const prevVf = vf;
    vf += a * dt;
    if (!reversing && prevVf > 0 && vf < 0) vf = 0;
    if (prevVf < 0 && vf > 0 && c.throttle === 0) vf = 0;

    const corr = G * dt;
    if (Math.abs(vl) <= corr) vl = 0;
    else vl -= Math.sign(vl) * corr;
    this.sliding = Math.abs(vl);

    this.vx = fx * vf + lx * vl;
    this.vz = fz * vf + lz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.wheelSpin += (vf / 0.36) * dt;

    const spinThreshold = this.assist ? 0.95 : 0.6;
    if (Math.abs(vl) > 7 && Math.abs(vl) > Math.abs(vf) * spinThreshold) {
      this.startSpin(Math.sign(vl) * -(2.5 + Math.random() * 2));
    }

    this.updateTrackPosition();
    this.updateTires(dt, env, Math.min(1.5, Math.abs(vf * yaw) / Math.max(1, G)), c.brake);
  }

  startSpin(rate: number): void {
    if (this.spinning || this.pit !== 'none' || this.ghost > 0) return;
    this.spinning = true;
    this.spinTimer = 1.5;
    this.spinRate = rate;
    this.incidentTimer = 4;
    this.events.push({ type: 'spin' });
  }

  respawn(): void {
    const track = this.track;
    const lat = clamp(this.lat, -(track.hw - 2.5), track.hw - 2.5);
    const back = 6;
    this.placeOnTrack(this.s - back, lat, 12);
    this.dist -= back;
    this.spinning = false;
    this.spinRate = 0;
    this.ghost = 2.5;
    this.steerActual = 0;
    this.wrongWayTimer = 0;
    this.stuckTimer = 0;
  }

  beginPit(): void {
    this.pit = 'entry';
    this.pitU = Math.max(0, this.track.deltaS(this.track.pitEntryS, this.s));
    this.pitEntryLat = this.lat;
    this.pitSpeed = Math.max(0, this.forwardSpeed);
    this.pitStopDone = false;
    this.spinning = false;
  }

  finishPitStop(): void {
    this.fitTires(this.pitCompound);
    this.pitStops++;
    this.pitStopDone = true;
    this.pitRequest = false;
    this.pit = 'lane';
  }

  private pitStep(dt: number): void {
    const track = this.track;
    const c = this.controls;
    const limit = PHYS.PIT_LIMIT;
    let v = this.pitSpeed;
    const boxU = track.boxU[this.teamIndex];
    if (this.pit === 'entry') {
      if (this.isPlayer && !this.autopilot) {
        const acc = c.throttle * PHYS.ACCEL * (1 - (v / PHYS.VMAX) ** 2) - c.brake * PHYS.BRAKE - 0.8 - 0.00012 * v * v;
        v = Math.max(3, v + acc * dt);
      } else {
        v = Math.max(limit, v - 30 * dt);
      }
      if (this.pitU >= track.pitRamp) {
        if (v > limit + 1.5) this.events.push({ type: 'pitSpeeding', speed: v });
        v = Math.min(v, limit);
        this.pit = 'lane';
      }
    } else if (this.pit === 'lane') {
      let target = limit;
      if (!this.pitStopDone) target = Math.min(limit, Math.sqrt(2 * 9 * Math.max(0, boxU - this.pitU)));
      v = v < target ? Math.min(target, v + 10 * dt) : Math.max(target, v - 14 * dt);
      if (!this.pitStopDone && this.pitU >= boxU - 0.6 && v < 1.2) {
        v = 0;
        this.pit = 'stopped';
        this.events.push({ type: 'pitStopped' });
      }
      if (this.pitU >= track.pitTotal - track.pitRamp) this.pit = 'exit';
    } else if (this.pit === 'stopped') {
      v = 0;
    } else if (this.pit === 'exit') {
      v = Math.min(PHYS.VMAX, v + PHYS.ACCEL * 0.8 * dt);
    }

    this.pitSpeed = v;
    const prevU = this.pitU;
    this.pitU += v * dt;
    this.dist += this.pitU - prevU;
    const exitLat = track.pitSide * (track.hw - 2.5);
    const u = this.pitU;
    const lat = track.pitLaneOffset(u, this.pitEntryLat, exitLat);
    const s = track.wrapS(track.pitEntryS + u);
    const p = track.pointAt(s, lat, tmpPoint);
    const dLat = (track.pitLaneOffset(u + 1, this.pitEntryLat, exitLat) - lat) / 1;
    const heading = p.heading + Math.atan(dLat);
    this.x = p.x;
    this.z = p.z;
    this.y = p.y;
    this.heading = heading;
    this.vx = Math.sin(heading) * v;
    this.vz = Math.cos(heading) * v;
    this.idx = p.i;
    this.s = s;
    this.lat = lat;
    this.wheelSpin += (v / 0.36) * dt;
    this.steerActual = 0;
    this.sliding = 0;
    this.offTrack = false;
    this.onKerb = false;
    this.surface = 'track';

    if (this.pitU >= track.pitTotal) {
      this.pit = 'none';
      this.pitRequest = false;
      this.events.push({ type: 'pitExit' });
    }
  }

  private surfaceGrip(wetness: number): number {
    const track = this.track;
    const absLat = Math.abs(this.lat);
    const curved = Math.abs(track.kappa[this.idx]) > 0.0025;
    this.onKerb = curved && absLat > track.hw - 0.4 && absLat < track.hw + 1.3;
    this.offTrack = absLat > track.hw + 1.3;
    const patch = this.offTrack ? null : track.patchAt(this.s, this.lat, wetness);
    if (this.offTrack) {
      this.surface = 'off';
      return 0.6;
    }
    if (patch === 'sand') {
      this.surface = 'sand';
      return 0.62;
    }
    if (patch === 'ice') {
      this.surface = 'ice';
      return 0.45;
    }
    if (patch === 'puddle') {
      this.surface = 'puddle';
      return 0.74;
    }
    this.surface = this.onKerb ? 'kerb' : 'track';
    return this.onKerb ? 0.97 : 1;
  }

  private updateTrackPosition(): void {
    const track = this.track;
    const proj = track.project(this.x, this.z, this.idx, tmpProj);
    this.dist += track.deltaS(this.s, proj.s);
    this.s = proj.s;
    this.idx = proj.i;
    this.lat = proj.lat;

    const side = this.lat >= 0 ? 1 : -1;
    const wall = track.wallLat(side, this.s) - PHYS.CAR_HALF_WIDTH;
    if (Math.abs(this.lat) > wall) {
      const over = Math.abs(this.lat) - wall;
      const nx = track.nx[this.idx] * side;
      const nz = track.nz[this.idx] * side;
      this.x -= nx * over;
      this.z -= nz * over;
      this.lat -= side * over;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.vx -= nx * vn * 1.25;
        this.vz -= nz * vn * 1.25;
        const scrub = Math.max(0.5, 1 - vn * 0.035);
        this.vx *= scrub;
        this.vz *= scrub;
        if (vn > 3) this.events.push({ type: 'wall', strength: vn });
        if (vn > 16) this.startSpin(side * (2 + Math.random() * 2));
      }
    }

    const roll = Math.atan(track.bank[this.idx]);
    const rel = wrapAngle(this.heading - Math.atan2(track.tx[this.idx], track.tz[this.idx]));
    this.roll = roll * Math.cos(rel);
    this.y = track.heightAt(this.idx, clamp(this.lat, -track.W, track.W));
  }

  private updateTires(dt: number, env: StepEnv, cornerLoad: number, brake: number): void {
    const v = this.speed;
    const stats = this.entry.driver.stats;
    const care = 1.18 - stats.tireCare * 0.36;
    let factor = 1 + this.sliding * 0.22 + cornerLoad * 0.55;
    if (brake > 0 && v > 20) factor += 0.6 * brake;
    if (this.offTrack) factor += 1.4;
    if (this.onKerb) factor += 0.6;
    if (this.boosting) factor += 0.2;
    const temp = this.tireTemp;
    if (temp > 0.92) factor *= 1 + (temp - 0.92) * 3;
    const rate = env.wearBase * env.wearMult * COMPOUNDS[this.compound].wear * weatherWear(this.compound, env.wetness) * care;
    this.wear = Math.min(1, this.wear + v * dt * rate * factor);

    const target = clamp(
      0.12 + this.track.temperature * 0.32 + Math.min(0.42, v / 200) + cornerLoad * 0.18 + Math.min(0.25, this.sliding * 0.03) - env.wetness * 0.12,
      0,
      1,
    );
    const k = target > temp ? 0.09 : 0.05;
    this.tireTemp += (target - temp) * Math.min(1, k * dt * 3);
  }
}
