export type CameraMode = 'chase' | 'far' | 'hood';
export type Difficulty = 'rookie' | 'pro' | 'legend';
export type WearRate = 'low' | 'normal' | 'high';
export type TouchMode = 'auto' | 'on' | 'off';

export interface Settings {
  brakingGuide: boolean;
  steeringHelp: boolean;
  racingLine: boolean;
  glow: 'low' | 'full';
  reducedFlashing: boolean;
  colorblind: boolean;
  camera: CameraMode;
  volume: number;
  vibration: boolean;
  buttonSize: number;
  buttonOpacity: number;
  tiltSteering: boolean;
  touchControls: TouchMode;
  nameTags: boolean;
  touchOffsets: { steer: [number, number]; pedals: [number, number] };
}

const KEY = 'overdrive-gp.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  brakingGuide: true,
  steeringHelp: true,
  racingLine: false,
  glow: 'full',
  reducedFlashing: false,
  colorblind: false,
  camera: 'chase',
  volume: 0.7,
  vibration: true,
  buttonSize: 1,
  buttonOpacity: 0.55,
  tiltSteering: false,
  touchControls: 'auto',
  nameTags: true,
  touchOffsets: { steer: [0, 0], pedals: [0, 0] },
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

type Listener = (s: Settings) => void;

class SettingsStore {
  private value: Settings = load();
  private listeners: Listener[] = [];

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Storage can be unavailable in private browsing; settings then last for the session.
    }
    for (const l of this.listeners) l(this.value);
  }

  reset(): void {
    this.update({ ...DEFAULT_SETTINGS });
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}

export const settings = new SettingsStore();

/** True for phones and tablets; touch-screen laptops with a mouse count as desktop. */
export function isTouchDevice(): boolean {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;
}

export function touchEnabled(): boolean {
  const mode = settings.get().touchControls;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return isTouchDevice();
}
