import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { settings } from '../core/settings';

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private useBloom = true;
  readonly mobile: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000);
    this.scene.environment = this.buildEnvironment();
    this.scene.environmentIntensity = 0.9;

    const hemi = new THREE.HemisphereLight(0x6a5cff, 0x12040f, 0.55);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0xa8b8ff, 0.7);
    moon.position.set(-300, 500, -200);
    this.scene.add(moon);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.45, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyGlow();
    settings.subscribe(() => this.applyGlow());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const bloomScale = this.mobile ? 0.5 : 1;
    this.bloom.resolution.set(w * bloomScale, h * bloomScale);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private applyGlow(): void {
    const s = settings.get();
    this.useBloom = s.glow === 'full';
    this.bloom.strength = this.mobile ? 0.75 : 0.85;
  }

  /** A small neon "city" baked into an environment map, so glossy surfaces have something to reflect. */
  private buildEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05030a);
    const colors = [0xff2bd6, 0x19f0ff, 0xa64dff, 0xff8a1f, 0x2f6bff, 0xff2a4d];
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 26; i++) {
      const color = new THREE.Color(colors[i % colors.length]).multiplyScalar(2.5);
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color }));
      const a = (i / 26) * Math.PI * 2;
      const r = 8 + (i % 3);
      m.position.set(Math.cos(a) * r, -1 + (i % 4) * 1.4, Math.sin(a) * r);
      m.scale.set(0.6 + (i % 2), 0.2 + (i % 3) * 0.3, 0.6);
      m.lookAt(0, 0, 0);
      env.add(m);
    }
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(20, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x12062a, side: THREE.BackSide }),
    );
    env.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
    return tex;
  }
}
