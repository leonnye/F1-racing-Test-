import * as THREE from 'three';
import { mulberry32 } from '../game/physics';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

export function gridTexture(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.globalAlpha = 0.9;
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.globalAlpha = 0.25;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
  return toTexture(c);
}

export function asphaltTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#464656';
  g.fillRect(0, 0, 256, 256);
  const r = mulberry32(7);
  for (let i = 0; i < 9000; i++) {
    const v = 52 + Math.floor(r() * 50);
    g.fillStyle = `rgb(${v},${v},${v + 6})`;
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  return toTexture(c);
}

export function kerbTexture(a: string, b: string): THREE.CanvasTexture {
  const [c, g] = canvas(16, 64);
  g.fillStyle = a;
  g.fillRect(0, 0, 16, 32);
  g.fillStyle = b;
  g.fillRect(0, 32, 16, 32);
  return toTexture(c);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 32);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const t = toTexture(c, false);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Building facade: dark with scattered lit windows. */
export function windowTexture(seed: number, colors: string[]): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  const r = mulberry32(seed);
  for (let y = 4; y < 256; y += 10) {
    for (let x = 4; x < 128; x += 9) {
      const p = r();
      if (p < 0.38) {
        g.fillStyle = p < 0.05 ? colors[Math.floor(r() * colors.length)] : p < 0.2 ? '#ffd9a0' : '#7fa8ff';
        g.globalAlpha = 0.35 + r() * 0.65;
        g.fillRect(x, y, 5, 6);
      }
    }
  }
  g.globalAlpha = 1;
  return toTexture(c);
}

/** Soft horizontal gradient for fake wet-road reflections and glows. */
export function fadeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 4);
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  return toTexture(c, true, false);
}

export function radialTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c, false, false);
}

export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 48);
  g.fillStyle = 'rgba(5,3,12,0.75)';
  g.beginPath();
  g.roundRect(4, 6, 120, 36, 8);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 24px Orbitron, Rajdhani, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 25);
  return toTexture(c, false);
}

export function signTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = color;
  g.font = 'bold 64px Orbitron, Rajdhani, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  return toTexture(c, false);
}

export function sandTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#c98a4a';
  g.fillRect(0, 0, 128, 128);
  const r = mulberry32(3);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = r() < 0.5 ? '#e0a865' : '#9a6331';
    g.globalAlpha = 0.5;
    g.fillRect(r() * 128, r() * 128, 2, 1);
  }
  return toTexture(c);
}
