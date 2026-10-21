import * as THREE from 'three';
import type { CameraMode } from '../core/settings';
import type { Car } from '../game/car';
import { wrapAngle } from '../game/physics';

const CYCLE: CameraMode[] = ['chase', 'far', 'hood'];

export class CameraRig {
  mode: CameraMode = 'chase';
  private heading = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private orbit = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  cycle(): CameraMode {
    this.mode = CYCLE[(CYCLE.indexOf(this.mode) + 1) % CYCLE.length];
    return this.mode;
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, car: Car, opts: { rear: boolean; shake: number; cinematic: boolean }): void {
    const cam = this.camera;
    if (!this.initialized) {
      this.heading = car.heading;
    }
    const followRate = car.spinning ? 2 : 7;
    this.heading += wrapAngle(car.heading - this.heading) * Math.min(1, dt * followRate);
    const h = this.heading;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const base = new THREE.Vector3(car.x, car.y, car.z);
    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    let smooth = 10;

    if (opts.cinematic) {
      this.orbit += dt * 0.12;
      const a = h + Math.PI + Math.sin(this.orbit) * 1.2;
      targetPos.set(car.x + Math.sin(a) * 13, car.y + 4.2, car.z + Math.cos(a) * 13);
      targetLook.set(car.x + fx * 4, car.y + 1, car.z + fz * 4);
      smooth = 3;
    } else if (opts.rear) {
      targetPos.set(car.x + fx * 7, car.y + 2.6, car.z + fz * 7);
      targetLook.set(car.x - fx * 6, car.y + 1, car.z - fz * 6);
      smooth = 30;
    } else if (this.mode === 'hood') {
      const ch = car.heading;
      targetPos.set(car.x + Math.sin(ch) * 0.1, car.y + 1.22, car.z + Math.cos(ch) * 0.1);
      targetLook.set(car.x + Math.sin(ch) * 25, car.y + 0.9, car.z + Math.cos(ch) * 25);
      smooth = 60;
    } else {
      const far = this.mode === 'far';
      const back = far ? 12.5 : 7.4;
      const up = far ? 4.6 : 2.65;
      targetPos.set(car.x - fx * back, car.y + up, car.z - fz * back);
      targetLook.set(car.x + fx * 6, car.y + (far ? 1.2 : 1.1), car.z + fz * 6);
    }

    if (!this.initialized) {
      this.pos.copy(targetPos);
      this.look.copy(targetLook);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * smooth);
      this.pos.lerp(targetPos, k);
      this.look.lerp(targetLook, Math.min(1, k * 1.5));
    }
    cam.position.copy(this.pos);
    if (cam.position.y < base.y + 0.5) cam.position.y = base.y + 0.5;
    if (opts.shake > 0) {
      const s = opts.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.look);
    const fov = (this.mode === 'hood' && !opts.cinematic ? 70 : 60) + Math.min(14, (car.speed / 90) * 14);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }
}
