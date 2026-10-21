import * as THREE from 'three';
import { settings } from '../core/settings';
import { TEAMS } from '../data/teams';
import { PHYS, hashString, mulberry32 } from '../game/physics';
import type { Projection, TrackModel, TrackPoint } from '../game/trackModel';
import {
  asphaltTexture,
  checkerTexture,
  fadeTexture,
  gridTexture,
  kerbTexture,
  sandTexture,
  signTexture,
  windowTexture,
} from './textures';

type LatFn = (i: number) => number;

const tmpPoint: TrackPoint = { x: 0, z: 0, y: 0, heading: 0, nx: 0, nz: 0, i: 0 };
const tmpProj: Projection = { i: 0, s: 0, lat: 0 };

function glow(color: string, intensity = 2.2): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: true, side: THREE.DoubleSide });
}

/** Builds a strip between two lateral offsets along track samples [i0, i0 + count]. */
function trackStrip(
  track: TrackModel,
  latA: LatFn,
  latB: LatFn,
  lift: number,
  i0 = 0,
  count = track.N,
  vScale = 10,
  yA?: (i: number) => number,
  yB?: (i: number) => number,
): THREE.BufferGeometry {
  const closed = count >= track.N;
  const n = closed ? track.N : count + 1;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  let v = 0;
  for (let k = 0; k < n; k++) {
    const i = track.wrap(i0 + k);
    const la = latA(i);
    const lb = latB(i);
    const ax = track.px[i] + track.nx[i] * la;
    const az = track.pz[i] + track.nz[i] * la;
    const bx = track.px[i] + track.nx[i] * lb;
    const bz = track.pz[i] + track.nz[i] * lb;
    pos.set([ax, (yA ? yA(i) : track.heightAt(i, la)) + lift, az, bx, (yB ? yB(i) : track.heightAt(i, lb)) + lift, bz], k * 6);
    if (k > 0) v += track.segLen(track.wrap(i0 + k - 1)) / vScale;
    uv.set([0, v, 1, v], k * 4);
  }
  const idx: number[] = [];
  const quads = closed ? n : n - 1;
  for (let k = 0; k < quads; k++) {
    const a = k * 2;
    const b = ((k + 1) % n) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Strip from explicit edge points, for paths that don't follow the centerline (pit lane). */
function pathStrip(a: THREE.Vector3[], b: THREE.Vector3[], vScale = 10): THREE.BufferGeometry {
  const n = a.length;
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  let v = 0;
  for (let k = 0; k < n; k++) {
    pos.set([a[k].x, a[k].y, a[k].z, b[k].x, b[k].y, b[k].z], k * 6);
    if (k > 0) v += a[k].distanceTo(a[k - 1]) / vScale;
    uv.set([0, v, 1, v], k * 4);
  }
  const idx: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const p = k * 2;
    const q = (k + 1) * 2;
    idx.push(p, q, p + 1, p + 1, q, q + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Contiguous index ranges where a predicate holds. */
function ranges(track: TrackModel, pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= track.N; i++) {
    const ok = i < track.N && pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      out.push([start, i - start]);
      start = -1;
    }
  }
  if (out.length >= 2 && out[0][0] === 0 && out[out.length - 1][0] + out[out.length - 1][1] === track.N) {
    const last = out.pop()!;
    out[0] = [last[0], last[1] + out[0][1]];
  }
  return out;
}

export class TrackView {
  readonly group = new THREE.Group();
  private readonly track: TrackModel;
  private readonly rng: () => number;
  private roadMat: THREE.MeshStandardMaterial;
  private groundMat: THREE.MeshStandardMaterial;
  private reflectMats: THREE.MeshBasicMaterial[] = [];
  private flickerMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color; seed: number }[] = [];
  private gantryLights: THREE.MeshBasicMaterial[] = [];
  private stars: THREE.Points | null = null;
  private skyMat: THREE.ShaderMaterial;
  private racingLine: THREE.Mesh | null = null;
  private patchGroup = new THREE.Group();
  private patchVersion = -1;
  private puddleMat: THREE.MeshStandardMaterial;
  private unsub: () => void;
  private disposables: { dispose(): void }[] = [];

  constructor(track: TrackModel) {
    this.track = track;
    this.rng = mulberry32(hashString(track.def.id + ':view'));
    const theme = track.theme;

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.sky[1]) },
        bottom: { value: new THREE.Color(theme.sky[0]) },
        cloud: { value: 0 },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float cloud; varying vec3 vPos;
        void main(){ float h = clamp(vPos.y*1.6+0.05,0.0,1.0); vec3 c = mix(bottom, top, pow(h,0.7));
        c = mix(c, vec3(0.06,0.05,0.09), cloud*0.6*(1.0-h*0.5)); gl_FragColor = vec4(c,1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    this.group.add(sky);
    if (theme.stars) this.addStars();

    const gridTex = gridTexture(theme.grid);
    gridTex.repeat.set(9000 / 40, 9000 / 40);
    this.groundMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.ground),
      emissive: new THREE.Color(theme.grid).multiplyScalar(0.35),
      emissiveMap: gridTex,
      roughness: 0.9,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.group.add(ground);

    const asphalt = asphaltTexture();
    asphalt.repeat.set(2, 1);
    this.roadMat = new THREE.MeshStandardMaterial({
      color: 0xb0b0c4,
      map: asphalt,
      roughness: 0.82,
      metalness: 0.05,
      envMapIntensity: 0.5,
      emissive: 0x100e22,
    });
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: 0x03050c,
      roughness: 0.04,
      metalness: 0.9,
      transparent: true,
      opacity: 0,
      envMapIntensity: 2.2,
      depthWrite: false,
    });

    this.buildRoad();
    this.buildPitLane();
    this.buildStartLine();
    this.buildLightPoles();
    this.buildTunnels();
    this.buildBridges();
    this.buildScenery();
    this.group.add(this.patchGroup);
    this.rebuildPatches();
    this.refreshRacingLine();
    this.unsub = settings.subscribe(() => this.refreshRacingLine());
  }

  setStartLights(on: number): void {
    this.gantryLights.forEach((m, i) => {
      m.color.set(i < on ? 0xff1020 : 0x220307).multiplyScalar(i < on ? 3 : 1);
    });
  }

  update(time: number, wetness: number, rain: number, fog: number, cloudy: boolean, scene: THREE.Scene): void {
    const theme = this.track.theme;
    const w = wetness;
    this.roadMat.roughness = 0.82 - w * 0.62;
    this.roadMat.metalness = 0.05 + w * 0.35;
    this.roadMat.envMapIntensity = 0.5 + w * 1.6;
    this.roadMat.color.setScalar(0.69 - w * 0.25);
    this.groundMat.roughness = 0.9 - w * 0.45;
    for (const m of this.reflectMats) m.opacity = w * 0.5;
    this.puddleMat.opacity = Math.max(0, (w - 0.45) * 1.6);
    this.skyMat.uniforms.cloud.value = cloudy ? 1 : 0;
    if (this.stars) (this.stars.material as THREE.PointsMaterial).opacity = cloudy ? 0.1 : 0.9;

    const baseFog = (this.track.def.baseFog ?? 0) + 0.0009;
    const density = baseFog + fog * 0.0075 + rain * 0.0016;
    if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(theme.fog, density);
    scene.fog.color.set(theme.fog);
    (scene.fog as THREE.FogExp2).density = density;

    const reduced = settings.get().reducedFlashing;
    for (const f of this.flickerMats) {
      let k = 1;
      if (!reduced) {
        const n = Math.sin(time * 23 + f.seed) * Math.sin(time * 7.3 + f.seed * 2.1);
        k = n > 0.82 ? 0.15 : n < -0.9 ? 0.4 : 1;
      }
      f.mat.color.copy(f.base).multiplyScalar(k);
    }

    if (this.patchVersion !== this.track.patchVersion) this.rebuildPatches();
  }

  refreshRacingLine(): void {
    const track = this.track;
    const s = settings.get();
    if (this.racingLine) {
      this.group.remove(this.racingLine);
      this.racingLine.geometry.dispose();
      (this.racingLine.material as THREE.Material).dispose();
      this.racingLine = null;
    }
    if (!s.racingLine && !s.brakingGuide) return;
    const g = trackStrip(track, (i) => track.rlOff[i] - 0.3, (i) => track.rlOff[i] + 0.3, 0.05);
    const colors = new Float32Array(track.N * 2 * 4);
    for (let i = 0; i < track.N; i++) {
      const braking = track.profileV[i] > track.profileV[track.wrap(i + 8)] + 1.2;
      const apex = !braking && track.cornerV[i] < PHYS.VMAX * 0.8;
      let c: [number, number, number, number];
      if (s.racingLine) {
        if (s.brakingGuide) c = braking ? [1, 0.12, 0.2, 0.85] : apex ? [1, 0.85, 0.1, 0.7] : [0.2, 1, 0.45, 0.55];
        else c = [0.1, 0.95, 1, 0.6];
      } else {
        c = braking ? [1, 0.12, 0.2, 0.75] : [0, 0, 0, 0];
      }
      colors.set(c, i * 8);
      colors.set(c, i * 8 + 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.racingLine = new THREE.Mesh(g, mat);
    this.racingLine.renderOrder = 2;
    this.group.add(this.racingLine);
  }

  dispose(): void {
    this.unsub();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }

  private add(geom: THREE.BufferGeometry, mat: THREE.Material, renderOrder = 0): THREE.Mesh {
    const m = new THREE.Mesh(geom, mat);
    m.renderOrder = renderOrder;
    this.group.add(m);
    return m;
  }

  private addStars(): void {
    const r = this.rng;
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = r() * Math.PI * 2;
      const phi = Math.acos(0.05 + r() * 0.95);
      pos.set([Math.sin(phi) * Math.cos(theta) * 3000, Math.cos(phi) * 3000, Math.sin(phi) * Math.sin(theta) * 3000], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xdfe4ff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false });
    this.stars = new THREE.Points(g, mat);
    this.group.add(this.stars);
  }

  private buildRoad(): void {
    const t = this.track;
    const theme = t.theme;
    this.add(trackStrip(t, () => -t.hw, () => t.hw, 0.02, 0, t.N, 14), this.roadMat);

    const runoffMat = new THREE.MeshStandardMaterial({ color: theme.runoff, roughness: 0.95, metalness: 0 });
    this.add(trackStrip(t, () => t.hw, () => t.W, 0.012), runoffMat);
    this.add(trackStrip(t, () => -t.W, () => -t.hw, 0.012), runoffMat);

    const kerbMat = new THREE.MeshBasicMaterial({ map: kerbTexture(theme.edgeA, '#f4f4ff'), color: new THREE.Color(0.55, 0.55, 0.55) });
    for (const [i0, count] of ranges(t, (i) => Math.abs(t.kappa[i]) > 0.0025)) {
      if (count < 6) continue;
      this.add(trackStrip(t, () => t.hw - 0.4, () => t.hw + 1.3, 0.035, i0, count, 2), kerbMat);
      this.add(trackStrip(t, () => -t.hw - 1.3, () => -t.hw + 0.4, 0.035, i0, count, 2), kerbMat);
    }

    this.add(trackStrip(t, () => t.hw - 0.5, () => t.hw - 0.15, 0.045), glow(theme.edgeA, 2.4), 1);
    this.add(trackStrip(t, () => -t.hw + 0.15, () => -t.hw + 0.5, 0.045), glow(theme.edgeB, 2.4), 1);

    const fade = fadeTexture();
    this.disposables.push(fade);
    const reflA = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.edgeA), map: fade, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const reflB = reflA.clone();
    reflB.color.set(theme.edgeB);
    this.reflectMats.push(reflA, reflB);
    this.add(trackStrip(t, () => t.hw - 5, () => t.hw - 0.5, 0.04, 0, t.N, 6), reflA, 1);
    const reflGeoB = trackStrip(t, () => -t.hw + 0.5, () => -t.hw + 5, 0.04, 0, t.N, 6);
    const uv = reflGeoB.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, 1 - uv.getX(k));
    this.add(reflGeoB, reflB, 1);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    for (const side of [1, -1]) {
      const lat = (i: number) => side * t.wallLat(side, t.s[i]);
      const visible = (i: number) => !(side === t.pitSide && t.pitU(t.s[i]) >= 0);
      for (const [i0, count] of ranges(t, visible)) {
        const base = (i: number) => t.heightAt(i, lat(i));
        this.add(trackStrip(t, lat, lat, 0, i0, count, 10, base, (i) => base(i) + 1.15), wallMat);
        const top = trackStrip(t, (i) => lat(i) - 0.12 * side, (i) => lat(i) + 0.12 * side, 1.16, i0, count);
        this.add(top, glow(side === 1 ? theme.edgeB : theme.edgeA, 1.8), 1);
      }
    }
  }

  private buildPitLane(): void {
    const t = this.track;
    const side = t.pitSide;
    const entryLat = side * (t.hw - 2.5);
    const exitLat = entryLat;
    const laneA: THREE.Vector3[] = [];
    const laneB: THREE.Vector3[] = [];
    const lineA: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    const lineB: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    const outerWall: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    const outerTop: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    const at = (u: number, lat: number, y = 0) => {
      const p = t.pointAt(t.pitEntryS + u, lat, tmpPoint);
      return new THREE.Vector3(p.x, p.y + y, p.z);
    };
    for (let u = 0; u <= t.pitTotal; u += 3) {
      const c = t.pitLaneOffset(u, entryLat, exitLat);
      laneA.push(at(u, c - 3.6, 0.014));
      laneB.push(at(u, c + 3.6, 0.014));
      lineA[0].push(at(u, c - 3.6, 0.03));
      lineA[1].push(at(u, c - 3.35, 0.03));
      lineB[0].push(at(u, c + 3.35, 0.03));
      lineB[1].push(at(u, c + 3.6, 0.03));
      const outer = side * (Math.abs(t.pitOff) + 6);
      outerWall[0].push(at(u, outer, 0));
      outerWall[1].push(at(u, outer, 1.6));
      outerTop[0].push(at(u, outer - 0.12, 1.62));
      outerTop[1].push(at(u, outer + 0.12, 1.62));
    }
    const laneMat = new THREE.MeshStandardMaterial({ color: 0x24222e, roughness: 0.7, metalness: 0.1 });
    this.add(pathStrip(laneA, laneB), laneMat);
    const white = glow('#e8ecff', 1.2);
    this.add(pathStrip(lineA[0], lineA[1]), white, 1);
    this.add(pathStrip(lineB[0], lineB[1]), white, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    this.add(pathStrip(outerWall[0], outerWall[1]), wallMat);
    this.add(pathStrip(outerTop[0], outerTop[1]), glow(t.theme.edgeB, 1.6), 1);

    const pitWallLat = side * (t.hw + 3);
    const pwA: THREE.Vector3[] = [];
    const pwB: THREE.Vector3[] = [];
    const pwTopA: THREE.Vector3[] = [];
    const pwTopB: THREE.Vector3[] = [];
    for (let u = t.pitRamp; u <= t.pitTotal - t.pitRamp; u += 3) {
      pwA.push(at(u, pitWallLat, 0));
      pwB.push(at(u, pitWallLat, 1.1));
      pwTopA.push(at(u, pitWallLat - 0.15, 1.12));
      pwTopB.push(at(u, pitWallLat + 0.15, 1.12));
    }
    this.add(pathStrip(pwA, pwB), wallMat);
    this.add(pathStrip(pwTopA, pwTopB), glow('#ffffff', 1.4), 1);

    for (const u of [t.pitRamp, t.pitTotal - t.pitRamp]) {
      const c = t.pitLaneOffset(u, entryLat, exitLat);
      const a = [at(u, c - 3.4, 0.035), at(u + 0.6, c - 3.4, 0.035)];
      const b = [at(u, c + 3.4, 0.035), at(u + 0.6, c + 3.4, 0.035)];
      this.add(pathStrip(a, b), glow('#ffffff', 1.5), 1);
    }

    const garageMat = new THREE.MeshStandardMaterial({ color: 0x0d0b14, roughness: 0.5, metalness: 0.4 });
    TEAMS.forEach((team, k) => {
      const u = t.boxU[k];
      const c = t.pitLaneOffset(u, entryLat, exitLat);
      const boxA = [at(u - 3.5, c - 2.6, 0.025), at(u + 3.5, c - 2.6, 0.025)];
      const boxB = [at(u - 3.5, c + 2.6, 0.025), at(u + 3.5, c + 2.6, 0.025)];
      const boxMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(team.color), transparent: true, opacity: 0.35, depthWrite: false });
      this.add(pathStrip(boxA, boxB), boxMat, 1);

      const p = t.pointAt(t.pitEntryS + u, side * (Math.abs(t.pitOff) + 13), tmpPoint);
      const garage = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 12), garageMat);
      garage.position.set(p.x, p.y + 4, p.z);
      garage.rotation.y = p.heading;
      this.group.add(garage);
      const signMat = new THREE.MeshBasicMaterial({ map: signTexture(team.abbr, team.color), toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), signMat);
      const sp = t.pointAt(t.pitEntryS + u, side * (Math.abs(t.pitOff) + 6.9), tmpPoint);
      sign.position.set(sp.x, sp.y + 5.5, sp.z);
      sign.rotation.y = p.heading - (Math.PI / 2) * side;
      this.group.add(sign);
    });
  }

  private buildStartLine(): void {
    const t = this.track;
    const checker = checkerTexture();
    checker.repeat.set(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: checker });
    const i0 = t.indexAt(t.L - 1.5);
    this.add(trackStrip(t, () => -t.hw, () => t.hw, 0.04, i0, 2, 3), mat, 1);

    const slotMat = glow('#ffffff', 1.1);
    const sideSign = t.rlOff[0] >= 0 ? 1 : -1;
    for (let k = 0; k < 12; k++) {
      const back = 14 + k * 8 - 2.8;
      const lat = (k % 2 === 0 ? 1 : -1) * 2.6 * sideSign;
      const i = t.indexAt(t.L - back);
      this.add(trackStrip(t, () => lat - 1.2, () => lat + 1.2, 0.04, i, 1, 3), slotMat, 1);
    }

    const p = t.pointAt(8, 0, tmpPoint);
    const gantry = new THREE.Group();
    gantry.position.set(p.x, p.y, p.z);
    gantry.rotation.y = p.heading;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1726, metalness: 0.6, roughness: 0.4 });
    const span = t.W * 2 + 4;
    for (const sx of [-span / 2, span / 2]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), frameMat);
      pillar.position.set(sx, 5, 0);
      gantry.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 2.4, 1), frameMat);
    beam.position.set(0, 10, 0);
    gantry.add(beam);
    const signMat = new THREE.MeshBasicMaterial({ map: signTexture('OVERDRIVE GP', t.theme.edgeA), toneMapped: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.4), signMat);
    sign.position.set(0, 12.6, -0.55);
    sign.rotation.y = Math.PI;
    gantry.add(sign);
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x220307 });
      this.gantryLights.push(m);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), m);
      light.position.set((k - 2) * 1.3, 10, -0.7);
      gantry.add(light);
    }
    this.group.add(gantry);
  }

  private buildLightPoles(): void {
    const t = this.track;
    const positions: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    let side = 1;
    for (let s = 20; s < t.L; s += 70) {
      side = -side;
      if (side === t.pitSide && t.pitU(s) >= 0) continue;
      if (t.inTunnel(s)) continue;
      const p = t.pointAt(s, side * (t.W + 1.5), tmpPoint);
      const m = new THREE.Matrix4().makeTranslation(p.x, 6, p.z);
      positions.push(m);
      const arm = t.pointAt(s, side * (t.W - 1.5), tmpPoint);
      heads.push(new THREE.Matrix4().makeTranslation(arm.x, 12, arm.z));
    }
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e1a2a, metalness: 0.7, roughness: 0.4 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 12, 6), poleMat, positions.length);
    positions.forEach((m, i) => poles.setMatrixAt(i, m));
    this.group.add(poles);
    const headMat = glow('#fff4e0', 2.5);
    const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), headMat, heads.length);
    heads.forEach((m, i) => headMesh.setMatrixAt(i, m));
    this.group.add(headMesh);
  }

  private buildTunnels(): void {
    const t = this.track;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x1a1724, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide });
    const H = 7.5;
    t.tunnels.forEach((tun, n) => {
      const i0 = t.indexAt(tun.from);
      const count = t.wrap(t.indexAt(tun.to) - i0);
      for (const side of [1, -1]) {
        const lat = () => side * t.W;
        this.add(trackStrip(t, lat, lat, 0, i0, count, 10, () => 0, () => H), concrete);
      }
      this.add(trackStrip(t, () => -t.W, () => t.W, 0, i0, count, 10, () => H, () => H), concrete);
      const colors = [t.theme.edgeA, t.theme.edgeB];
      [-1, 1].forEach((side, k) => {
        const base = new THREE.Color(colors[k]).multiplyScalar(2.6);
        const mat = new THREE.MeshBasicMaterial({ color: base.clone(), side: THREE.DoubleSide });
        this.flickerMats.push({ mat, base, seed: n * 10 + k * 3.7 });
        const lat = side * (t.hw - 1);
        this.add(trackStrip(t, () => lat - 0.25, () => lat + 0.25, 0, i0, count, 10, () => H - 0.05, () => H - 0.05), mat, 1);
      });
      for (const s of [tun.from, tun.to]) {
        const p = t.pointAt(s, 0, tmpPoint);
        const frame = new THREE.Group();
        frame.position.set(p.x, 0, p.z);
        frame.rotation.y = p.heading;
        const m = glow(t.theme.edgeA, 2.2);
        const top = new THREE.Mesh(new THREE.BoxGeometry(t.W * 2 + 1, 0.4, 0.4), m);
        top.position.y = H + 0.2;
        frame.add(top);
        for (const sx of [-t.W - 0.3, t.W + 0.3]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 0.4), m);
          post.position.set(sx, H / 2, 0);
          frame.add(post);
        }
        const facade = new THREE.Mesh(new THREE.BoxGeometry(t.W * 2 + 30, 14, 2), concrete);
        facade.position.y = H + 7.2;
        frame.add(facade);
        this.group.add(frame);
      }
    });
  }

  private buildBridges(): void {
    const t = this.track;
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x1c1828, roughness: 0.5, metalness: 0.5 });
    for (const s of t.bridges) {
      const p = t.pointAt(s, 0, tmpPoint);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.heading;
      const width = t.W * 2 + 120;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 1.6, 16), deckMat);
      deck.position.y = 10;
      g.add(deck);
      for (const z of [-8, 8]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(width, 0.25, 0.25), glow(z < 0 ? t.theme.edgeA : t.theme.edgeB, 2.4));
        edge.position.set(0, 9.2, z);
        g.add(edge);
      }
      for (const x of [-(t.W + 10), t.W + 10, -(t.W + 45), t.W + 45]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(3, 10, 6), deckMat);
        pillar.position.set(x, 5, 0);
        g.add(pillar);
      }
      for (let k = 0; k < 12; k++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.6), glow('#fff2d8', 2.2));
        lamp.position.set(-width / 2 + 10 + (k * (width - 20)) / 11, 9.15, 0);
        g.add(lamp);
      }
      this.group.add(g);
    }
  }

  private rebuildPatches(): void {
    const t = this.track;
    this.patchVersion = t.patchVersion;
    for (const child of [...this.patchGroup.children]) {
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      this.patchGroup.remove(m);
    }
    const sandMat = (this.patchGroup.userData.sandMat as THREE.MeshStandardMaterial | undefined) ??
      new THREE.MeshStandardMaterial({ map: sandTexture(), color: 0xc8a080, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false });
    const iceMat = (this.patchGroup.userData.iceMat as THREE.MeshStandardMaterial | undefined) ??
      new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x2a6080, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.6, envMapIntensity: 2, depthWrite: false });
    this.patchGroup.userData.sandMat = sandMat;
    this.patchGroup.userData.iceMat = iceMat;
    for (const p of t.patches) {
      const i0 = t.indexAt(p.s);
      const count = Math.max(2, Math.round(p.len / (t.L / t.N)));
      const mat = p.kind === 'sand' ? sandMat : p.kind === 'ice' ? iceMat : this.puddleMat;
      const g = trackStrip(t, () => p.lat - p.width / 2, () => p.lat + p.width / 2, 0.03, i0, count, 6);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 1;
      this.patchGroup.add(mesh);
    }
  }

  /** Distance from the circuit, accounting for the pit complex. */
  private clearance(x: number, z: number): number {
    const t = this.track;
    const p = t.projectGlobal(x, z, tmpProj);
    const near = t.pitU(p.s) >= 0 || t.pitU(p.s + 60) >= 0 || t.pitU(p.s - 60) >= 0;
    const lat = Math.abs(p.lat);
    if (near && Math.sign(p.lat) === t.pitSide) return lat - (Math.abs(t.pitOff) + 22);
    return lat - (t.W + 4);
  }

  private buildScenery(): void {
    switch (this.track.theme.id) {
      case 'city':
        this.buildCity();
        break;
      case 'desert':
        this.buildDesert();
        break;
      case 'glacier':
        this.buildGlacier();
        break;
      case 'speedway':
        this.buildSpeedway();
        break;
      default:
        this.buildCity();
    }
    this.buildBillboards();
  }

  private candidates(count: number, minOff: number, maxOff: number, radius: (r: () => number) => number): { x: number; z: number; r: number; heading: number }[] {
    const t = this.track;
    const r = this.rng;
    const out: { x: number; z: number; r: number; heading: number }[] = [];
    for (let k = 0; k < count; k++) {
      const s = r() * t.L;
      const side = r() < 0.5 ? -1 : 1;
      const rad = radius(r);
      const off = t.W + minOff + rad + r() * (maxOff - minOff);
      const p = t.pointAt(s, side * off, tmpPoint);
      if (this.clearance(p.x, p.z) < rad) continue;
      if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < (o.r + rad) * 0.9)) continue;
      out.push({ x: p.x, z: p.z, r: rad, heading: p.heading });
    }
    return out;
  }

  private buildCity(): void {
    const theme = this.track.theme;
    const near = this.candidates(520, 8, 90, (r) => 10 + r() * 14);
    const far = this.candidates(380, 90, 420, (r) => 14 + r() * 22);
    const all = [...near.map((c) => ({ ...c, far: false })), ...far.map((c) => ({ ...c, far: true }))];
    const variants = [0, 1, 2].map((v) => {
      const tex = windowTexture(11 + v, [theme.edgeA, theme.edgeB, '#ff8a1f']);
      tex.repeat.set(1 + v, 2 + v);
      return new THREE.MeshStandardMaterial({ color: 0x0c0b12, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.6 });
    });
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const buckets: THREE.Matrix4[][] = [[], [], []];
    const r = this.rng;
    for (const c of all) {
      const h = c.far ? 50 + r() * 160 : 18 + r() * 70;
      const w = c.r * 1.5;
      const d = c.r * (1.1 + r() * 0.5);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(c.x, 0, c.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.heading),
        new THREE.Vector3(w, h, d),
      );
      buckets[Math.floor(r() * 3)].push(m);
    }
    buckets.forEach((list, v) => {
      const mesh = new THREE.InstancedMesh(box, variants[v], list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      this.group.add(mesh);
    });

    const roofMat = glow(theme.edgeB, 2);
    const roofs = all.filter(() => r() < 0.18);
    const roofMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1), roofMat, roofs.length);
    roofs.forEach((c, i) => {
      const h = 20 + r() * 40;
      roofMesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, h, c.z), new THREE.Quaternion(), new THREE.Vector3(c.r * 1.55, 1, c.r * 1.25)));
    });
    this.group.add(roofMesh);
    this.buildSkylineRing(0x0b0912, theme.edgeA);
  }

  private buildSkylineRing(color: number, accent: string): void {
    const r = this.rng;
    const n = 160;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(accent).multiplyScalar(0.08), roughness: 0.8 });
    const mesh = new THREE.InstancedMesh(box, mat, n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.03;
      const d = 1700 + r() * 700;
      const h = 60 + r() * 260;
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), new THREE.Quaternion(), new THREE.Vector3(40 + r() * 60, h, 40 + r() * 60)));
    }
    this.group.add(mesh);
  }

  private buildMountains(color: number, snow: boolean): void {
    const r = this.rng;
    const n = 42;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, emissive: snow ? 0x0a1a2a : 0x12050a });
    const cone = new THREE.ConeGeometry(1, 1, 7);
    cone.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(cone, mat, n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.1;
      const d = 1500 + r() * 900;
      const h = 220 + r() * 520;
      const w = 220 + r() * 380;
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, -5, Math.sin(a) * d), new THREE.Quaternion(), new THREE.Vector3(w, h, w)));
    }
    this.group.add(mesh);
  }

  private buildDesert(): void {
    const r = this.rng;
    const dunes = this.candidates(260, 10, 400, (rr) => 25 + rr() * 45);
    const dune = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const duneMat = new THREE.MeshStandardMaterial({ color: 0x3a1c10, roughness: 1, emissive: 0x1a0606, flatShading: true });
    const mesh = new THREE.InstancedMesh(dune, duneMat, dunes.length);
    dunes.forEach((c, i) => {
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, -1, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), new THREE.Vector3(c.r, 6 + r() * 18, c.r * (0.6 + r() * 0.6))));
    });
    this.group.add(mesh);

    const mesas = this.candidates(70, 40, 500, (rr) => 18 + rr() * 30);
    const mesaMat = new THREE.MeshStandardMaterial({ color: 0x2a1110, roughness: 0.95, flatShading: true });
    const mesa = new THREE.CylinderGeometry(0.8, 1, 1, 6);
    mesa.translate(0, 0.5, 0);
    const mm = new THREE.InstancedMesh(mesa, mesaMat, mesas.length);
    mesas.forEach((c, i) => mm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion(), new THREE.Vector3(c.r, 25 + r() * 60, c.r))));
    this.group.add(mm);

    const cacti = this.candidates(140, 4, 60, () => 2);
    const cactusMat = glow('#2ee86b', 1.6);
    const cg = new THREE.CapsuleGeometry(0.5, 4, 4, 8);
    cg.translate(0, 2.5, 0);
    const cm = new THREE.InstancedMesh(cg, cactusMat, cacti.length);
    cacti.forEach((c, i) => cm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion(), new THREE.Vector3(1, 0.7 + r() * 0.8, 1))));
    this.group.add(cm);
    this.buildMountains(0x1c0a12, false);
  }

  private buildGlacier(): void {
    const r = this.rng;
    const trees = this.candidates(420, 6, 260, (rr) => 4 + rr() * 4);
    const treeGeo = new THREE.ConeGeometry(1, 1, 7);
    treeGeo.translate(0, 0.5, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x0c2a26, roughness: 0.9, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, roughness: 0.6, emissive: 0x1a3550, flatShading: true });
    const tm = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
    const sm = new THREE.InstancedMesh(treeGeo, snowMat, trees.length);
    trees.forEach((c, i) => {
      const h = 10 + r() * 16;
      tm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, 0, c.z), new THREE.Quaternion(), new THREE.Vector3(c.r, h, c.r)));
      sm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, h * 0.62, c.z), new THREE.Quaternion(), new THREE.Vector3(c.r * 0.45, h * 0.4, c.r * 0.45)));
    });
    this.group.add(tm, sm);

    const spikes = this.candidates(120, 4, 120, (rr) => 2 + rr() * 3);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x1d7fa8, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
    const sg = new THREE.ConeGeometry(1, 1, 5);
    sg.translate(0, 0.5, 0);
    const spm = new THREE.InstancedMesh(sg, spikeMat, spikes.length);
    spikes.forEach((c, i) =>
      spm.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          new THREE.Vector3(c.x, 0, c.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5)),
          new THREE.Vector3(c.r, 6 + r() * 12, c.r),
        ),
      ),
    );
    this.group.add(spm);

    const mounds = this.candidates(160, 20, 450, (rr) => 30 + rr() * 50);
    const mg = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mmesh = new THREE.InstancedMesh(mg, snowMat, mounds.length);
    mounds.forEach((c, i) => mmesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, -1, c.z), new THREE.Quaternion(), new THREE.Vector3(c.r, 5 + r() * 14, c.r))));
    this.group.add(mmesh);
    this.groundMat.color.set(0x0d1a26);
    this.buildMountains(0xbcd6ea, true);
  }

  private buildSpeedway(): void {
    const t = this.track;
    const r = this.rng;
    const standMat = new THREE.MeshStandardMaterial({ color: 0x120f1c, roughness: 0.6, metalness: 0.4, emissive: 0xffffff, emissiveMap: windowTexture(41, [t.theme.edgeA, t.theme.edgeB, '#ffffff']), emissiveIntensity: 0.9 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const outside = -t.pitSide;
    const stands: THREE.Matrix4[] = [];
    for (let s = 0; s < t.L; s += 60) {
      if (Math.abs(t.kappa[t.indexAt(s)]) > 0.002) continue;
      const lat = outside * (t.W + 22);
      const p = t.pointAt(s, lat, tmpPoint);
      if (this.clearance(p.x, p.z) < 12) continue;
      stands.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading), new THREE.Vector3(18, 16 + r() * 6, 56)));
    }
    const sm = new THREE.InstancedMesh(box, standMat, stands.length);
    stands.forEach((m, i) => sm.setMatrixAt(i, m));
    this.group.add(sm);

    const towers = this.candidates(60, 15, 60, () => 3);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x1c1828, metalness: 0.7, roughness: 0.3 });
    const tg = new THREE.CylinderGeometry(0.6, 1, 42, 6);
    tg.translate(0, 21, 0);
    const tm = new THREE.InstancedMesh(tg, towerMat, towers.length);
    const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 2.4, 1.2), glow('#ffffff', 3), towers.length);
    towers.forEach((c, i) => {
      tm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(c.x, 0, c.z));
      hm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(c.x, 42, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.heading), new THREE.Vector3(1, 1, 1)));
    });
    this.group.add(tm, hm);

    const ringMat = glow(t.theme.edgeA, 2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(120, 2.2, 8, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    const center = t.pointAt(t.L * 0.25, -t.pitSide * 180, tmpPoint);
    ring.position.set(0, 0.5, 250);
    if (this.clearance(0, 250) < 120) ring.position.set(center.x, 0.5, center.z);
    this.group.add(ring);
    this.buildSkylineRing(0x0b0912, t.theme.edgeB);
  }

  private buildBillboards(): void {
    const t = this.track;
    const words = ['VOLT COLA', 'NIGHTRIDE', 'HYPERION', 'PULSE FM', 'NEON LABS', 'APEX FUEL', 'KINETIC', 'ZENITH'];
    const colors = [t.theme.edgeA, t.theme.edgeB, '#ff8a1f', '#b6ff2e'];
    const r = this.rng;
    let n = 0;
    for (let s = 150; s < t.L - 100 && n < 14; s += t.L / 14) {
      const side = r() < 0.5 ? -1 : 1;
      if (side === t.pitSide && t.pitU(s) >= 0) continue;
      if (t.inTunnel(s)) continue;
      const p = t.pointAt(s, side * (t.W + 5), tmpPoint);
      if (this.clearance(p.x, p.z) < 0) continue;
      const tex = signTexture(words[n % words.length], colors[n % colors.length]);
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), mat);
      board.position.set(p.x, 7, p.z);
      board.rotation.y = p.heading - (Math.PI / 2) * side;
      this.group.add(board);
      n++;
    }
  }
}