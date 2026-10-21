import * as THREE from 'three';
import { THEMES, type Theme, type TrackDef } from '../data/tracks';
import { PHYS, clamp, cornerSpeed, hashString, lateralGrip, mulberry32, smoothstep, wrapAngle } from './physics';

export type PatchKind = 'sand' | 'ice' | 'puddle';

export interface Patch {
  s: number;
  lat: number;
  len: number;
  width: number;
  kind: PatchKind;
}

export interface Projection {
  i: number;
  s: number;
  lat: number;
}

export interface TrackPoint {
  x: number;
  z: number;
  y: number;
  heading: number;
  nx: number;
  nz: number;
  i: number;
}

const PIT_RAMP = 110;

export class TrackModel {
  readonly def: TrackDef;
  readonly theme: Theme;
  readonly N: number;
  readonly L: number;
  readonly hw: number;
  readonly runoff: number;
  readonly W: number;

  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly nx: Float32Array;
  readonly nz: Float32Array;
  readonly s: Float32Array;
  readonly kappa: Float32Array;
  readonly bank: Float32Array;

  /** Racing line lateral offset, its speed limit, and a full braking/acceleration profile. */
  readonly rlOff: Float32Array;
  readonly cornerV: Float32Array;
  readonly profileV: Float32Array;
  readonly idealLap: number;

  readonly pitSide: number;
  readonly pitOff: number;
  readonly pitEntryS: number;
  readonly pitTotal: number;
  readonly pitRamp = PIT_RAMP;
  readonly boxU: number[];

  readonly patches: Patch[] = [];
  patchVersion = 0;
  readonly tunnels: { from: number; to: number }[] = [];
  readonly bridges: number[] = [];
  readonly slipstreamMult: number;
  readonly tireLoad: number;
  readonly temperature: number;

  private readonly rng: () => number;

  constructor(def: TrackDef) {
    if (!def.points) throw new Error(`Track ${def.id} has no layout yet`);
    this.def = def;
    this.theme = THEMES[def.theme];
    this.hw = def.halfWidth ?? 7.5;
    this.runoff = def.runoff ?? 8;
    this.W = this.hw + this.runoff;
    this.slipstreamMult = def.slipstream ?? 1;
    this.tireLoad = def.tireLoad ?? 1;
    this.temperature = def.temperature ?? 0.5;
    this.rng = mulberry32(hashString(def.id));

    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    curve.arcLengthDivisions = 6000;
    const approx = curve.getLength();
    const N = Math.max(200, Math.round(approx / 2));
    const pts = curve.getSpacedPoints(N);
    this.N = N;

    this.px = new Float32Array(N);
    this.pz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
    }
    this.s = new Float32Array(N);
    let acc = 0;
    for (let i = 0; i < N; i++) {
      this.s[i] = acc;
      const j = (i + 1) % N;
      acc += Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
    }
    this.L = acc;

    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.nx = new Float32Array(N);
    this.nz = new Float32Array(N);
    const heading = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 1);
      const b = this.wrap(i + 1);
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = dz;
      this.nz[i] = -dx;
      heading[i] = Math.atan2(dx, dz);
    }

    this.kappa = this.curvatureOf(heading, 3, 6);

    this.bank = new Float32Array(N);
    if (def.banking) {
      const maxSlope = Math.tan((def.banking * Math.PI) / 180);
      const raw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const k = this.kappa[i];
        raw[i] = -Math.sign(k) * Math.min(1, Math.abs(k) / 0.0035) * maxSlope;
      }
      this.bank.set(this.smooth(raw, 30));
    }

    this.rlOff = this.computeRacingLine();

    const rlHeading = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 1);
      const b = this.wrap(i + 1);
      const ax = this.px[a] + this.nx[a] * this.rlOff[a];
      const az = this.pz[a] + this.nz[a] * this.rlOff[a];
      const bx = this.px[b] + this.nx[b] * this.rlOff[b];
      const bz = this.pz[b] + this.nz[b] * this.rlOff[b];
      rlHeading[i] = Math.atan2(bx - ax, bz - az);
    }
    const rlKappa = this.curvatureOf(rlHeading, 4, 4);

    this.cornerV = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const bonus = Math.abs(this.bank[i]) * 9.8 * 1.5;
      this.cornerV[i] = cornerSpeed(rlKappa[i], 1, bonus);
    }
    const { profile, lap } = this.buildProfile(this.cornerV, 1);
    this.profileV = profile;
    this.idealLap = lap;

    const probeX = this.px[0] + this.nx[0] * 60;
    const probeZ = this.pz[0] + this.nz[0] * 60;
    const inside = this.pointInLoop(probeX, probeZ);
    this.pitSide = inside ? -1 : 1;
    this.pitOff = this.pitSide * (this.hw + 9);
    const entry = def.pitEntry ?? 300;
    const exit = def.pitExit ?? 300;
    this.pitEntryS = this.L - entry;
    this.pitTotal = entry + exit;
    this.boxU = [];
    const boxStart = PIT_RAMP + 40;
    const boxEnd = this.pitTotal - PIT_RAMP - 40;
    for (let k = 0; k < 6; k++) this.boxU.push(boxStart + ((boxEnd - boxStart) * k) / 5);

    for (const f of def.features ?? []) {
      if (f.type === 'tunnel') {
        this.tunnels.push({ from: this.sOfControlPoint(f.from), to: this.sOfControlPoint(f.to) });
      } else if (f.type === 'bridge') {
        this.bridges.push(this.sOfControlPoint(f.at));
      } else if (f.type === 'patches') {
        for (let k = 0; k < f.count; k++) this.patches.push(this.randomPatch(f.kind));
      }
    }
    for (let k = 0; k < 10; k++) this.patches.push(this.randomPatch('puddle'));
  }

  wrap(i: number): number {
    const N = this.N;
    return ((i % N) + N) % N;
  }

  wrapS(s: number): number {
    const L = this.L;
    return ((s % L) + L) % L;
  }

  /** Signed shortest distance from a to b along the loop. */
  deltaS(a: number, b: number): number {
    let d = b - a;
    const L = this.L;
    if (d > L / 2) d -= L;
    else if (d < -L / 2) d += L;
    return d;
  }

  indexAt(s: number): number {
    s = this.wrapS(s);
    let i = Math.floor((s / this.L) * this.N);
    i = clamp(i, 0, this.N - 1);
    while (i > 0 && this.s[i] > s) i--;
    while (i < this.N - 1 && this.s[i + 1] <= s) i++;
    return i;
  }

  heightAt(i: number, lat: number): number {
    const b = this.bank[i];
    return b * lat + Math.abs(b) * this.W;
  }

  /** World position for a track distance and lateral offset. */
  pointAt(s: number, lat: number, out: TrackPoint): TrackPoint {
    s = this.wrapS(s);
    const i = this.indexAt(s);
    const j = (i + 1) % this.N;
    const segLen = (j === 0 ? this.L : this.s[j]) - this.s[i];
    const t = segLen > 0 ? (s - this.s[i]) / segLen : 0;
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    const nl = Math.hypot(nx, nz) || 1;
    out.nx = nx / nl;
    out.nz = nz / nl;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t + out.nx * lat;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t + out.nz * lat;
    out.heading = Math.atan2(-out.nz, out.nx);
    out.y = this.heightAt(i, lat);
    out.i = i;
    return out;
  }

  /** Find nearest centerline position, searching around a hint index. */
  project(x: number, z: number, hint: number, out: Projection, window = 24): Projection {
    let best = hint;
    let bd = Infinity;
    for (let k = -window; k <= window; k++) {
      const j = this.wrap(hint + k);
      const dx = this.px[j] - x;
      const dz = this.pz[j] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    let i = best;
    let j = (i + 1) % this.N;
    let ax = this.px[i];
    let az = this.pz[i];
    let ex = this.px[j] - ax;
    let ez = this.pz[j] - az;
    let len2 = ex * ex + ez * ez || 1;
    let t = ((x - ax) * ex + (z - az) * ez) / len2;
    if (t < 0) {
      j = i;
      i = this.wrap(i - 1);
      ax = this.px[i];
      az = this.pz[i];
      ex = this.px[j] - ax;
      ez = this.pz[j] - az;
      len2 = ex * ex + ez * ez || 1;
      t = ((x - ax) * ex + (z - az) * ez) / len2;
    }
    t = clamp(t, 0, 1);
    const segLen = Math.sqrt(len2);
    out.i = i;
    out.s = this.wrapS(this.s[i] + t * segLen);
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    out.lat = (x - (ax + ex * t)) * nx + (z - (az + ez * t)) * nz;
    return out;
  }

  projectGlobal(x: number, z: number, out: Projection): Projection {
    return this.project(x, z, Math.floor(this.N / 2), out, Math.ceil(this.N / 2));
  }

  /** Lateral position of the pit lane center at pit-lane distance u. */
  pitLaneOffset(u: number, entryLat: number, exitLat: number): number {
    const enter = smoothstep(0, PIT_RAMP, u);
    const leave = smoothstep(this.pitTotal - PIT_RAMP, this.pitTotal, u);
    const base = entryLat + (this.pitOff - entryLat) * enter;
    return base + (exitLat - this.pitOff) * leave;
  }

  /** Distance into the pit lane for a track distance, or -1 when outside it. */
  pitU(s: number): number {
    const u = this.wrapS(s - this.pitEntryS);
    return u <= this.pitTotal ? u : -1;
  }

  /** Lateral position of the barrier on one side (+1 left, -1 right). */
  wallLat(side: number, s: number): number {
    if (side === this.pitSide) {
      const u = this.pitU(s);
      if (u >= 0) {
        if (u > PIT_RAMP && u < this.pitTotal - PIT_RAMP) return this.hw + 3;
        return Math.abs(this.pitOff) + 6;
      }
    }
    return this.W;
  }

  inTunnel(s: number): boolean {
    for (const t of this.tunnels) {
      if (this.wrapS(s - t.from) <= this.wrapS(t.to - t.from)) return true;
    }
    return false;
  }

  /** Low-grip patch under a car, if any. */
  patchAt(s: number, lat: number, wetness: number): PatchKind | null {
    for (const p of this.patches) {
      if (p.kind === 'puddle' && wetness < 0.5) continue;
      if (this.wrapS(s - p.s) > p.len) continue;
      if (Math.abs(lat - p.lat) < p.width / 2) return p.kind;
    }
    return null;
  }

  /** Drifting sand shifts across the track between laps. */
  driftPatches(): void {
    if (!this.patches.some((p) => p.kind === 'sand')) return;
    this.patchVersion++;
    for (const p of this.patches) {
      if (p.kind !== 'sand') continue;
      p.lat = clamp(p.lat + (this.rng() - 0.5) * 6, -(this.hw - 1.5), this.hw - 1.5);
    }
  }

  /** Speed profile for a grip multiplier; used for qualifying estimates and assists. */
  buildProfile(corner: Float32Array, gripMult: number): { profile: Float32Array; lap: number } {
    const N = this.N;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = Math.min(PHYS.VMAX, corner[i] * Math.sqrt(gripMult));
    for (let pass = 0; pass < 2; pass++) {
      for (let k = N - 1; k >= 0; k--) {
        const i = k;
        const j = (i + 1) % N;
        const ds = this.segLen(i);
        const decel = Math.min(PHYS.BRAKE, lateralGrip(v[j]) * gripMult) * 0.82;
        const lim = Math.sqrt(v[j] * v[j] + 2 * decel * ds);
        if (lim < v[i]) v[i] = lim;
      }
    }
    const fwd = new Float32Array(v);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const p = this.wrap(i - 1);
        const ds = this.segLen(p);
        const a = PHYS.ACCEL * (1 - (fwd[p] / PHYS.VMAX) ** 2);
        const lim = Math.sqrt(fwd[p] * fwd[p] + 2 * Math.max(0.5, a) * ds);
        if (lim < fwd[i]) fwd[i] = lim;
      }
    }
    let lap = 0;
    for (let i = 0; i < N; i++) lap += this.segLen(i) / Math.max(5, fwd[i]);
    return { profile: v, lap };
  }

  segLen(i: number): number {
    const j = (i + 1) % this.N;
    return (j === 0 ? this.L : this.s[j]) - this.s[i];
  }

  private sOfControlPoint(idx: number): number {
    const pts = this.def.points!;
    const [x, z] = pts[clamp(idx, 0, pts.length - 1)];
    const out: Projection = { i: 0, s: 0, lat: 0 };
    return this.projectGlobal(x, z, out).s;
  }

  private randomPatch(kind: PatchKind): Patch {
    const r = this.rng;
    let s = 0;
    for (let tries = 0; tries < 20; tries++) {
      s = r() * this.L;
      if (this.pitU(s) < 0 && this.deltaS(0, s) > 120) break;
    }
    const width = kind === 'puddle' ? 3 + r() * 3 : 4 + r() * 4;
    const len = kind === 'puddle' ? 10 + r() * 14 : 22 + r() * 28;
    const lat = (r() * 2 - 1) * (this.hw - width / 2 - 0.5);
    return { s, lat, len, width, kind };
  }

  private curvatureOf(heading: Float32Array, k: number, smoothWin: number): Float32Array {
    const N = this.N;
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - k);
      const b = this.wrap(i + k);
      const dist = this.deltaS(this.s[a], this.s[b]);
      raw[i] = dist > 0 ? wrapAngle(heading[b] - heading[a]) / dist : 0;
    }
    return this.smooth(raw, smoothWin);
  }

  private smooth(src: Float32Array, win: number): Float32Array {
    const N = this.N;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -win; k <= win; k++) sum += src[this.wrap(i + k)];
      out[i] = sum / (win * 2 + 1);
    }
    return out;
  }

  private computeRacingLine(): Float32Array {
    const N = this.N;
    const off = new Float32Array(N);
    const maxOff = this.hw - 1.7;
    const schedule: [number, number][] = [
      [14, 220],
      [8, 160],
      [4, 120],
    ];
    for (const [k, iters] of schedule) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const a = this.wrap(i - k);
          const b = this.wrap(i + k);
          const mx = (this.px[a] + this.nx[a] * off[a] + this.px[b] + this.nx[b] * off[b]) / 2;
          const mz = (this.pz[a] + this.nz[a] * off[a] + this.pz[b] + this.nz[b] * off[b]) / 2;
          const target = (mx - this.px[i]) * this.nx[i] + (mz - this.pz[i]) * this.nz[i];
          off[i] = clamp(off[i] + (target - off[i]) * 0.6, -maxOff, maxOff);
        }
      }
    }
    return off;
  }

  private pointInLoop(x: number, z: number): boolean {
    let inside = false;
    const N = this.N;
    for (let i = 0, j = N - 1; i < N; j = i++) {
      const xi = this.px[i];
      const zi = this.pz[i];
      const xj = this.px[j];
      const zj = this.pz[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
}
