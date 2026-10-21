import { settings, touchEnabled } from './settings';

export type Action = 'camera' | 'pit' | 'pause' | 'tap';

type HoldKey = 'left' | 'right' | 'gas' | 'brake' | 'boost' | 'rear';

const KEYMAP: Record<string, HoldKey> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'gas',
  KeyW: 'gas',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  Space: 'boost',
  KeyR: 'rear',
};

const ACTIONMAP: Record<string, Action> = {
  KeyC: 'camera',
  KeyP: 'pit',
  Escape: 'pause',
  Space: 'tap',
  Enter: 'tap',
};

export class Input {
  private keys = new Set<HoldKey>();
  private touchHeld = new Set<HoldKey>();
  private queue: Action[] = [];
  private tilt: number | null = null;
  private tiltZero = 0;
  private touchRoot: HTMLElement;
  private pitButton: HTMLButtonElement | null = null;
  private editing = false;
  onAnyInput: (() => void) | null = null;

  constructor(touchRoot: HTMLElement) {
    this.touchRoot = touchRoot;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const hold = KEYMAP[e.code];
      const action = ACTIONMAP[e.code];
      if (hold || action) e.preventDefault();
      if (hold) this.keys.add(hold);
      if (action && !e.repeat) this.queue.push(action);
      this.onAnyInput?.();
    });
    window.addEventListener('keyup', (e) => {
      const hold = KEYMAP[e.code];
      if (hold) this.keys.delete(hold);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touchHeld.clear();
    });
    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
    this.buildTouch();
    settings.subscribe(() => this.applyTouchStyle());
  }

  get steer(): number {
    const s = settings.get();
    if (s.tiltSteering && this.tilt !== null && touchEnabled()) {
      const v = (this.tilt - this.tiltZero) / 22;
      return Math.max(-1, Math.min(1, v));
    }
    let v = 0;
    if (this.keys.has('left') || this.touchHeld.has('left')) v += 1;
    if (this.keys.has('right') || this.touchHeld.has('right')) v -= 1;
    return v;
  }

  get throttle(): number {
    return this.keys.has('gas') || this.touchHeld.has('gas') ? 1 : 0;
  }

  get brake(): number {
    return this.keys.has('brake') || this.touchHeld.has('brake') ? 1 : 0;
  }

  get boost(): boolean {
    return this.keys.has('boost') || this.touchHeld.has('boost');
  }

  get rear(): boolean {
    return this.keys.has('rear') || this.touchHeld.has('rear');
  }

  get analogSteer(): boolean {
    return settings.get().tiltSteering && this.tilt !== null && touchEnabled();
  }

  consume(action: Action): boolean {
    const i = this.queue.indexOf(action);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  clearActions(): void {
    this.queue.length = 0;
  }

  calibrateTilt(): void {
    if (this.tilt !== null) this.tiltZero = this.tilt;
  }

  async requestTiltPermission(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
      .DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        return (await DOE.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  setTouchVisible(visible: boolean): void {
    this.touchRoot.classList.toggle('hidden', !(visible && touchEnabled()));
  }

  setPitButton(visible: boolean, active: boolean): void {
    if (!this.pitButton) return;
    this.pitButton.classList.toggle('hidden', !visible);
    this.pitButton.classList.toggle('active', active);
  }

  setEditLayout(on: boolean): void {
    this.editing = on;
    this.touchRoot.classList.toggle('editing', on);
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.beta === null || e.gamma === null) return;
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    let v: number;
    if (angle === 90) v = -e.beta;
    else if (angle === 270 || angle === -90) v = e.beta;
    else v = -e.gamma;
    this.tilt = v;
  }

  private buildTouch(): void {
    const root = this.touchRoot;
    root.innerHTML = `
      <div class="t-top">
        <button class="t-btn small" data-action="pause" aria-label="Pause">II</button>
        <button class="t-btn small" data-action="camera" aria-label="Camera">CAM</button>
        <button class="t-btn small" data-hold="rear" aria-label="Rear view">REAR</button>
      </div>
      <div class="t-group t-steer" data-group="steer">
        <button class="t-btn steer" data-hold="left" aria-label="Steer left">&#9664;</button>
        <button class="t-btn steer" data-hold="right" aria-label="Steer right">&#9654;</button>
      </div>
      <div class="t-group t-pedals" data-group="pedals">
        <button class="t-btn boost" data-hold="boost" aria-label="Boost">BOOST</button>
        <div class="t-row">
          <button class="t-btn brake" data-hold="brake" aria-label="Brake">BRAKE</button>
          <button class="t-btn gas" data-hold="gas" aria-label="Gas">GAS</button>
        </div>
      </div>
      <button class="t-btn pit hidden" data-action="pit" aria-label="Pit this lap">PIT<br/>THIS LAP</button>
      <div class="t-edit-note">Drag the button groups. Tap DONE in the pause menu to finish.</div>
    `;
    this.pitButton = root.querySelector('.pit');

    root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((btn) => {
      const key = btn.dataset.hold as HoldKey;
      const pointers = new Set<number>();
      const release = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) {
          this.touchHeld.delete(key);
          btn.classList.remove('down');
        }
      };
      btn.addEventListener('pointerdown', (e) => {
        if (this.editing) return;
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        pointers.add(e.pointerId);
        this.touchHeld.add(key);
        btn.classList.add('down');
        this.onAnyInput?.();
      });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
    });

    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        if (this.editing) return;
        e.preventDefault();
        this.queue.push(btn.dataset.action as Action);
        this.onAnyInput?.();
      });
    });

    root.querySelectorAll<HTMLElement>('[data-group]').forEach((group) => {
      const name = group.dataset.group as 'steer' | 'pedals';
      let start: [number, number] | null = null;
      let origin: [number, number] = [0, 0];
      group.addEventListener('pointerdown', (e) => {
        if (!this.editing) return;
        e.preventDefault();
        group.setPointerCapture(e.pointerId);
        start = [e.clientX, e.clientY];
        origin = [...settings.get().touchOffsets[name]] as [number, number];
      });
      group.addEventListener('pointermove', (e) => {
        if (!this.editing || !start) return;
        const offsets = { ...settings.get().touchOffsets };
        offsets[name] = [origin[0] + e.clientX - start[0], origin[1] + e.clientY - start[1]];
        settings.update({ touchOffsets: offsets });
      });
      const end = () => {
        start = null;
      };
      group.addEventListener('pointerup', end);
      group.addEventListener('pointercancel', end);
    });

    // A tap anywhere on the play area counts as the pit-stop action.
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root && !this.editing) this.queue.push('tap');
    });

    this.applyTouchStyle();
  }

  private applyTouchStyle(): void {
    const s = settings.get();
    this.touchRoot.style.setProperty('--btn-scale', String(s.buttonSize));
    this.touchRoot.style.setProperty('--btn-opacity', String(s.buttonOpacity));
    this.touchRoot.classList.toggle('tilt', s.tiltSteering);
    const steer = this.touchRoot.querySelector<HTMLElement>('.t-steer');
    const pedals = this.touchRoot.querySelector<HTMLElement>('.t-pedals');
    if (steer) steer.style.transform = `translate(${s.touchOffsets.steer[0]}px, ${s.touchOffsets.steer[1]}px)`;
    if (pedals) pedals.style.transform = `translate(${s.touchOffsets.pedals[0]}px, ${s.touchOffsets.pedals[1]}px)`;
  }
}
