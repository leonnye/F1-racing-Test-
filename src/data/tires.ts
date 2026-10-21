export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';

export interface CompoundInfo {
  id: Compound;
  name: string;
  letter: string;
  color: string;
  /** Peak grip multiplier on a dry track. */
  dryGrip: number;
  /** Relative wear per meter (medium = 1). */
  wear: number;
}

export const COMPOUNDS: Record<Compound, CompoundInfo> = {
  soft: { id: 'soft', name: 'Soft', letter: 'S', color: '#ff3b3b', dryGrip: 1.045, wear: 1.55 },
  medium: { id: 'medium', name: 'Medium', letter: 'M', color: '#ffd400', dryGrip: 1.0, wear: 1.0 },
  hard: { id: 'hard', name: 'Hard', letter: 'H', color: '#f2f2f2', dryGrip: 0.962, wear: 0.62 },
  inter: { id: 'inter', name: 'Intermediate', letter: 'I', color: '#2ee86b', dryGrip: 0.9, wear: 1.1 },
  wet: { id: 'wet', name: 'Wet', letter: 'W', color: '#2f8bff', dryGrip: 0.82, wear: 0.9 },
};

export const COMPOUND_ORDER: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

export function isDryCompound(c: Compound): boolean {
  return c === 'soft' || c === 'medium' || c === 'hard';
}

/** Grip multiplier from compound and track wetness (0 dry, 0.5 light rain, 1 heavy rain). */
export function weatherGrip(c: Compound, wetness: number): number {
  const w = Math.min(1, Math.max(0, wetness));
  const info = COMPOUNDS[c];
  if (isDryCompound(c)) return info.dryGrip * (1 - 0.55 * w);
  if (c === 'inter') {
    if (w < 0.5) return lerp(0.9, 0.93, w / 0.5);
    return lerp(0.93, 0.72, (w - 0.5) / 0.5);
  }
  if (w < 0.5) return lerp(0.82, 0.86, w / 0.5);
  return lerp(0.86, 0.85, (w - 0.5) / 0.5);
}

/** Wet-weather tires overheat and wear quickly on a dry track. */
export function weatherWear(c: Compound, wetness: number): number {
  if (isDryCompound(c)) return 1 - 0.3 * Math.min(1, wetness);
  const dryness = 1 - Math.min(1, wetness / (c === 'inter' ? 0.3 : 0.6));
  return 1 + dryness * 2.2;
}

/** Grip multiplier from wear (0 fresh, 1 fully worn). */
export function wearGrip(wear: number): number {
  if (wear < 0.7) return 1 - 0.1 * (wear / 0.7);
  const t = Math.min(1, (wear - 0.7) / 0.3);
  return 0.9 - 0.32 * Math.pow(t, 1.3);
}

export function bestCompoundFor(wetness: number, remainingFraction: number): Compound {
  if (wetness > 0.62) return 'wet';
  if (wetness > 0.22) return 'inter';
  if (remainingFraction > 0.62) return 'hard';
  if (remainingFraction > 0.36) return 'medium';
  return 'soft';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
