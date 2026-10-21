import * as THREE from 'three';
import type { Car } from '../game/car';
import { radialTexture } from './textures';

const RAIN_DROPS = 2200;
const RAIN_BOX = 70;
const PARTICLES = 900;

export class Effects {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private drops: Float32Array;
  private rainMat: THREE.LineBasicMaterial;
  private points: THREE.Points;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pMax: Float32Array;
  private pTint: Float32Array;
  private next = 0;
  private tex: THREE.Texture;

  constructor() {
    this.drops = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * RAIN_BOX * 2;
      this.drops[i * 3 + 1] = Math.random() * 40;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX * 2;
    }
    this.rainPos = new Float32Array(RAIN_DROPS * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);

    this.pPos = new Float32Array(PARTICLES * 3);
    this.pCol = new Float32Array(PARTICLES * 3);
    this.pVel = new Float32Array(PARTICLES * 3);
    this.pLife = new Float32Array(PARTICLES);
    this.pMax = new Float32Array(PARTICLES).fill(1);
    this.pTint = new Float32Array(PARTICLES * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tex = radialTexture();
    const pm = new THREE.PointsMaterial({
      size: 1.3,
      map: this.tex,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(pg, pm);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  update(dt: number, cam: THREE.Vector3, rain: number, wetness: number, cars: Car[], sparks: { x: number; y: number; z: number; n: number }[]): void {
    this.updateRain(dt, cam, rain);
    if (wetness > 0.2) {
      for (const car of cars) {
        const v = car.speed;
        if (v < 14) continue;
        const dx = car.x - cam.x;
        const dz = car.z - cam.z;
        if (dx * dx + dz * dz > 140 * 140) continue;
        const rate = wetness * v * 0.9 * dt;
        let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        while (n-- > 0) {
          const side = Math.random() < 0.5 ? -0.85 : 0.85;
          this.emit(
            car.x - fx * 2.0 + fz * side,
            car.y + 0.3,
            car.z - fz * 2.0 - fx * side,
            car.vx * 0.35 + (Math.random() - 0.5) * 3,
            1.5 + Math.random() * 2.5,
            car.vz * 0.35 + (Math.random() - 0.5) * 3,
            0.5 + Math.random() * 0.4,
            0.35,
            0.4,
            0.5,
          );
        }
      }
    }
    for (const s of sparks) {
      for (let k = 0; k < s.n; k++) {
        this.emit(s.x, s.y + 0.5, s.z, (Math.random() - 0.5) * 14, 2 + Math.random() * 6, (Math.random() - 0.5) * 14, 0.3 + Math.random() * 0.4, 1.6, 0.8, 0.25);
      }
    }
    sparks.length = 0;

    for (let i = 0; i < PARTICLES; i++) {
      if (this.pLife[i] <= 0) {
        this.pCol[i * 3] = this.pCol[i * 3 + 1] = this.pCol[i * 3 + 2] = 0;
        continue;
      }
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 9 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] = Math.max(0.05, this.pPos[i * 3 + 1] + this.pVel[i * 3 + 1] * dt);
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const k = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pCol[i * 3] = this.pTint[i * 3] * k;
      this.pCol[i * 3 + 1] = this.pTint[i * 3 + 1] * k;
      this.pCol[i * 3 + 2] = this.pTint[i * 3 + 2] * k;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.pLife.fill(0);
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.tex.dispose();
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number): void {
    const i = this.next;
    this.next = (this.next + 1) % PARTICLES;
    this.pPos.set([x, y, z], i * 3);
    this.pVel.set([vx, vy, vz], i * 3);
    this.pTint.set([r, g, b], i * 3);
    this.pLife[i] = life;
    this.pMax[i] = life;
  }

  private updateRain(dt: number, cam: THREE.Vector3, rain: number): void {
    this.rain.visible = rain > 0.02;
    if (!this.rain.visible) return;
    const count = Math.floor(RAIN_DROPS * Math.min(1, rain));
    this.rainMat.opacity = 0.18 + rain * 0.25;
    const fall = 42 * dt;
    const len = 1.4;
    const B = RAIN_BOX * 2;
    for (let i = 0; i < count; i++) {
      let x = this.drops[i * 3];
      let y = this.drops[i * 3 + 1] - fall;
      let z = this.drops[i * 3 + 2];
      if (y < cam.y - 10) y += 40;
      x = cam.x + ((((x - cam.x + RAIN_BOX) % B) + B) % B) - RAIN_BOX;
      z = cam.z + ((((z - cam.z + RAIN_BOX) % B) + B) % B) - RAIN_BOX;
      if (y > cam.y + 30) y -= 40;
      this.drops[i * 3] = x;
      this.drops[i * 3 + 1] = y;
      this.drops[i * 3 + 2] = z;
      this.rainPos.set([x, y, z, x + 0.15, y - len, z + 0.05], i * 6);
    }
    this.rain.geometry.setDrawRange(0, count * 2);
    (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
