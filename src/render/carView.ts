import * as THREE from 'three';
import { settings } from '../core/settings';
import { COMPOUNDS, type Compound } from '../data/tires';
import type { Car } from '../game/car';
import { labelTexture, radialTexture } from './textures';

const TRAIL_POINTS = 34;
const TRAIL_SPACING = 1.6;

let underglowTex: THREE.Texture | null = null;

export class CarView {
  readonly group = new THREE.Group();
  readonly car: Car;
  private body = new THREE.Group();
  private frontWheels: THREE.Group[] = [];
  private spinGroups: THREE.Group[] = [];
  private ringMats: THREE.MeshBasicMaterial[] = [];
  private brakeMat: THREE.MeshBasicMaterial;
  private compound: Compound | null = null;
  private label: THREE.Sprite;
  private trail: THREE.Mesh;
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  private history: number[] = [];
  private lastTrail = { x: 0, z: 0 };
  private teamColor: THREE.Color;
  private disposables: { dispose(): void }[] = [];

  constructor(car: Car) {
    this.car = car;
    const team = car.entry.team;
    this.teamColor = new THREE.Color(team.color);

    const bodyMat = new THREE.MeshStandardMaterial({ color: team.body, metalness: 0.7, roughness: 0.25, envMapIntensity: 1.4 });
    const teamMat = new THREE.MeshStandardMaterial({ color: team.color, emissive: team.color, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.3 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.5, metalness: 0.3 });
    const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(team.color).multiplyScalar(2.6) });
    const helmet = new THREE.MeshStandardMaterial({ color: team.accent, emissive: team.color, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.3 });
    this.brakeMat = new THREE.MeshBasicMaterial({ color: 0x400008 });
    this.disposables.push(bodyMat, teamMat, carbon, neon, helmet, this.brakeMat);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      this.disposables.push(geo);
      return m;
    };

    add(new THREE.BoxGeometry(1.9, 0.08, 5.0), carbon, 0, 0.12, -0.1);
    add(new THREE.BoxGeometry(0.85, 0.42, 2.6), bodyMat, 0, 0.42, 0.05);
    const nose = add(new THREE.CylinderGeometry(0.11, 0.32, 1.7, 6), bodyMat, 0, 0.36, 2.15);
    nose.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.55, 0.4, 1.8), teamMat, sx * 0.68, 0.38, -0.15);
      add(new THREE.BoxGeometry(0.04, 0.06, 1.7), neon, sx * 0.97, 0.5, -0.15);
    }
    add(new THREE.BoxGeometry(0.5, 0.52, 1.7), bodyMat, 0, 0.66, -0.95);
    add(new THREE.BoxGeometry(0.05, 0.42, 1.1), teamMat, 0, 0.98, -1.25);
    add(new THREE.BoxGeometry(0.3, 0.28, 0.4), carbon, 0, 1.0, -0.2);
    add(new THREE.SphereGeometry(0.18, 12, 10), helmet, 0, 0.8, 0.28);

    add(new THREE.BoxGeometry(1.95, 0.05, 0.45), teamMat, 0, 0.14, 2.6);
    add(new THREE.BoxGeometry(1.95, 0.03, 0.06), neon, 0, 0.17, 2.82);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.24, 0.5), carbon, sx * 0.97, 0.22, 2.6);

    add(new THREE.BoxGeometry(1.05, 0.06, 0.38), teamMat, 0, 0.98, -2.3);
    add(new THREE.BoxGeometry(1.05, 0.05, 0.2), carbon, 0, 1.1, -2.42);
    add(new THREE.BoxGeometry(1.05, 0.03, 0.05), neon, 0, 1.13, -2.52);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.55, 0.6), carbon, sx * 0.53, 0.84, -2.32);
    add(new THREE.BoxGeometry(0.22, 0.12, 0.05), this.brakeMat, 0, 0.6, -2.58);

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.85 });
    this.disposables.push(tireMat);
    const wheels: [number, number, number, number, boolean][] = [
      [-0.86, 1.62, 0.34, 0.36, true],
      [0.86, 1.62, 0.34, 0.36, true],
      [-0.84, -1.55, 0.37, 0.44, false],
      [0.84, -1.55, 0.37, 0.44, false],
    ];
    for (const [x, z, r, w, front] of wheels) {
      const steer = new THREE.Group();
      steer.position.set(x, r, z);
      const spin = new THREE.Group();
      steer.add(spin);
      const tire = add(new THREE.CylinderGeometry(r, r, w, 18), tireMat, 0, 0, 0, spin);
      tire.rotation.z = Math.PI / 2;
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.ringMats.push(ringMat);
      this.disposables.push(ringMat);
      const ring = add(new THREE.TorusGeometry(r * 0.72, 0.03, 6, 22), ringMat, Math.sign(x) * (w / 2 + 0.005), 0, 0, spin);
      ring.rotation.y = Math.PI / 2;
      add(new THREE.BoxGeometry(0.02, r * 1.1, 0.08), carbon, Math.sign(x) * (w / 2 + 0.01), 0, 0, spin);
      this.body.add(steer);
      this.spinGroups.push(spin);
      if (front) this.frontWheels.push(steer);
    }

    underglowTex ??= radialTexture();
    const glowMat = new THREE.MeshBasicMaterial({
      map: underglowTex,
      color: this.teamColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(glowMat);
    const under = add(new THREE.PlaneGeometry(3.4, 6.6), glowMat, 0, 0.05, -0.1);
    under.rotation.x = -Math.PI / 2;
    under.renderOrder = 3;

    this.group.add(this.body);

    const labelTex = labelTexture(car.entry.driver.code, team.color);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, depthWrite: false, transparent: true });
    this.disposables.push(labelTex, labelMat);
    this.label = new THREE.Sprite(labelMat);
    this.label.scale.set(3.4, 1.3, 1);
    this.label.position.y = 2.7;
    this.group.add(this.label);

    this.trailPos = new Float32Array(TRAIL_POINTS * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_POINTS * 2 * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let k = 0; k < TRAIL_POINTS - 1; k++) {
      const a = k * 2;
      const b = a + 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    tg.setIndex(idx);
    const trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.trail = new THREE.Mesh(tg, trailMat);
    this.trail.frustumCulled = false;
    this.disposables.push(tg, trailMat);
  }

  get trailObject(): THREE.Object3D {
    return this.trail;
  }

  update(time: number, wetness: number, camPos: THREE.Vector3): void {
    const car = this.car;
    this.group.position.set(car.x, car.y, car.z);
    this.group.rotation.set(0, car.heading, 0, 'YXZ');
    this.body.rotation.z = car.roll;
    for (const w of this.frontWheels) w.rotation.y = car.steerActual * 0.4;
    for (const s of this.spinGroups) s.rotation.x = car.wheelSpin;

    if (this.compound !== car.compound) {
      this.compound = car.compound;
      const c = new THREE.Color(COMPOUNDS[car.compound].color).multiplyScalar(1.6);
      for (const m of this.ringMats) m.color.copy(c);
    }

    const s = settings.get();
    const braking = car.controls.brake > 0.1 && car.speed > 2;
    const rainBlink = wetness > 0.3 && (s.reducedFlashing || Math.floor(time * 4) % 2 === 0);
    this.brakeMat.color.set(braking ? 0xff1030 : rainBlink ? 0xff2040 : 0x400008).multiplyScalar(braking || rainBlink ? 3 : 1);

    this.group.visible = car.ghost <= 0 || s.reducedFlashing || Math.floor(time * 10) % 2 === 0;

    const dist = camPos.distanceTo(this.group.position);
    this.label.visible = s.nameTags && !car.isPlayer && dist < 160 && dist > 6;

    this.updateTrail(s.glow === 'low' ? 0.35 : 0.7, camPos);
  }

  private updateTrail(intensity: number, camPos: THREE.Vector3): void {
    const car = this.car;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const rx = car.x - fx * 2.5;
    const rz = car.z - fz * 2.5;
    const ry = car.y + 0.6;
    if (this.history.length === 0 || Math.hypot(rx - this.lastTrail.x, rz - this.lastTrail.z) > TRAIL_SPACING) {
      this.history.unshift(rx, ry, rz);
      if (this.history.length > TRAIL_POINTS * 3) this.history.length = TRAIL_POINTS * 3;
      this.lastTrail.x = rx;
      this.lastTrail.z = rz;
    }
    if (Math.hypot(rx - this.history[0], rz - this.history[2]) > 20) this.history.length = 0;
    const pts = this.history.length / 3;
    const speedK = Math.min(1, Math.max(0, (car.speed - 15) / 50)) * intensity;
    const c = this.teamColor;
    for (let k = 0; k < TRAIL_POINTS; k++) {
      const j = Math.min(k, Math.max(0, pts - 1));
      let x = k === 0 || pts === 0 ? rx : this.history[j * 3];
      let y = k === 0 || pts === 0 ? ry : this.history[j * 3 + 1];
      let z = k === 0 || pts === 0 ? rz : this.history[j * 3 + 2];
      let lx = fz;
      let lz = -fx;
      if (k > 0 && j > 0) {
        const px = this.history[(j - 1) * 3];
        const pz = this.history[(j - 1) * 3 + 2];
        const dx = px - x;
        const dz = pz - z;
        const len = Math.hypot(dx, dz) || 1;
        lx = dz / len;
        lz = -dx / len;
      }
      if (k >= pts) {
        x = rx;
        y = ry;
        z = rz;
      }
      const w = 0.2 * (1 - k / TRAIL_POINTS) + 0.04;
      this.trailPos.set([x + lx * w, y, z + lz * w, x - lx * w, y, z - lz * w], k * 6);
      const camDist = Math.hypot(x - camPos.x, z - camPos.z);
      const nearFade = Math.min(1, Math.max(0, (camDist - 5) / 15));
      const fade = (1 - k / TRAIL_POINTS) ** 1.6 * speedK * nearFade * (k < pts ? 1 : 0);
      this.trailCol.set([c.r * fade, c.g * fade, c.b * fade, c.r * fade, c.g * fade, c.b * fade], k * 6);
    }
    const g = this.trail.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
