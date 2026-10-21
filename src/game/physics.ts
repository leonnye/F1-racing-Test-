export const PHYS = {
  /** Top speed in m/s on a flat straight without boost or slipstream. */
  VMAX: 88,
  ACCEL: 15,
  BRAKE: 36,
  /** Base lateral grip (m/s^2) and aero downforce coefficient. */
  G0: 21,
  KD: 0.0026,
  WHEELBASE: 3.4,
  MAX_STEER: 0.5,
  PIT_LIMIT: 80 / 3.6,
  BOOST_ACCEL: 4.5,
  BOOST_VMAX: 1.07,
  CAR_HALF_WIDTH: 1.0,
  CAR_HALF_LENGTH: 2.6,
};

export function lateralGrip(v: number): number {
  return PHYS.G0 + PHYS.KD * v * v;
}

/** Highest speed a car can hold through a corner of the given curvature. */
export function cornerSpeed(curvature: number, gripMult = 1, bonus = 0): number {
  const k = Math.abs(curvature);
  if (k < 1e-5) return PHYS.VMAX * 1.2;
  const r = 1 / k;
  const kd = PHYS.KD * gripMult;
  const denom = 1 - kd * r;
  if (denom <= 0.02) return PHYS.VMAX * 1.2;
  return Math.min(PHYS.VMAX * 1.2, Math.sqrt(((PHYS.G0 * gripMult + bonus) * r) / denom));
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Seeded PRNG so track decorations are identical every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
