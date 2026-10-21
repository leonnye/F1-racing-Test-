import type { Input } from '../core/input';
import { settings } from '../core/settings';
import { COMPOUNDS, COMPOUND_ORDER } from '../data/tires';
import type { Car } from '../game/car';
import { PHYS } from '../game/physics';
import { formatTime, type RaceSession } from '../game/race';
import type { TrackModel } from '../game/trackModel';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export function tireState(wear: number): { cls: string; label: string } {
  if (wear < 0.6) return { cls: 'ok', label: 'GOOD' };
  if (wear < 0.8) return { cls: 'warn', label: 'WORN' };
  return { cls: 'bad', label: 'CRITICAL' };
}

export class Hud {
  private root: HTMLElement;
  private input: Input;
  private session: RaceSession | null = null;
  private tower: HTMLElement;
  private rows: HTMLElement[] = [];
  private posEl: HTMLElement;
  private posOf: HTMLElement;
  private lapEl: HTMLElement;
  private curEl: HTMLElement;
  private lastEl: HTMLElement;
  private bestEl: HTMLElement;
  private lights: HTMLElement;
  private flag: HTMLElement;
  private msgs: HTMLElement;
  private weatherEl: HTMLElement;
  private map: HTMLCanvasElement;
  private mapBase: HTMLCanvasElement | null = null;
  private mapXf = { s: 1, ox: 0, oz: 0 };
  private warn: HTMLElement;
  private speedEl: HTMLElement;
  private tireEl: HTMLElement;
  private tireLetter: HTMLElement;
  private tirePct: HTMLElement;
  private tireLabel: HTMLElement;
  private boostBar: HTMLElement;
  private tags: HTMLElement;
  private pitPanel: HTMLElement;
  private pitTitle: HTMLElement;
  private chips: HTMLButtonElement[] = [];
  private pitGame: HTMLElement;
  private needle: HTMLElement;
  private zone: HTMLElement;
  private wheelDots: HTMLElement[] = [];
  private pitFlash: HTMLElement;
  private modeTag: HTMLElement;
  private slowTimer = 0;
  private shownMsgIds = new Set<number>();

  constructor(root: HTMLElement, input: Input) {
    this.root = root;
    this.input = input;
    root.innerHTML = '';

    this.tower = el('div', 'hud-tower', root);
    for (let i = 0; i < 12; i++) {
      const row = el('div', 'row', this.tower, '<span class="p"></span><span class="c"></span><span class="n"></span><span class="g"></span><span class="t"></span>');
      this.rows.push(row);
    }

    const top = el('div', 'hud-top', root);
    this.modeTag = el('div', 'mode', top);
    const posWrap = el('div', 'pos', top);
    this.posEl = el('span', 'big', posWrap);
    this.posOf = el('span', 'of', posWrap);
    this.lapEl = el('div', 'lap', top);
    const times = el('div', 'times', top);
    const line = (label: string) => {
      const d = el('div', 't', times, `<span>${label}</span>`);
      return el('b', '', d);
    };
    this.curEl = line('LAP');
    this.lastEl = line('LAST');
    this.bestEl = line('BEST');

    this.lights = el('div', 'hud-lights hidden', root, '<i></i><i></i><i></i><i></i><i></i>');
    this.flag = el('div', 'hud-flag hidden', root, 'YELLOW FLAG &middot; NO OVERTAKING');
    this.msgs = el('div', 'hud-msgs', root);
    this.weatherEl = el('div', 'hud-weather', root);
    this.map = el('canvas', 'hud-map', root);
    this.warn = el('div', 'hud-warn hidden', root);

    const bottom = el('div', 'hud-bottom', root);
    const speed = el('div', 'speed', bottom);
    this.speedEl = el('b', '', speed);
    el('span', '', speed, 'KM/H');
    this.tireEl = el('div', 'tire ok', bottom);
    el('div', 'icon', this.tireEl);
    this.tireLetter = el('div', 'letter', this.tireEl);
    const tinfo = el('div', 'info', this.tireEl);
    this.tirePct = el('b', '', tinfo);
    this.tireLabel = el('span', '', tinfo);
    const boost = el('div', 'boost', bottom, '<span>BOOST</span>');
    const bar = el('div', 'bar', boost);
    this.boostBar = el('i', '', bar);
    this.tags = el('div', 'hud-tags', root);

    this.pitPanel = el('div', 'hud-pit hidden', root);
    this.pitTitle = el('div', 'title', this.pitPanel);
    const chipRow = el('div', 'chips', this.pitPanel);
    COMPOUND_ORDER.forEach((c, i) => {
      const info = COMPOUNDS[c];
      const b = el('button', 'chip', chipRow, `<i style="--c:${info.color}">${info.letter}</i><span>${i + 1}</span>`);
      b.title = info.name;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.session?.setPitCompound(c);
      });
      this.chips.push(b);
    });

    this.pitGame = el('div', 'hud-pitgame hidden', root);
    el('div', 'title', this.pitGame, 'PIT STOP &middot; TAP WHEN THE MARKER IS IN THE ZONE');
    const track = el('div', 'meter', this.pitGame);
    this.zone = el('div', 'zone', track);
    this.needle = el('div', 'needle', track);
    const dots = el('div', 'wheels', this.pitGame);
    for (let i = 0; i < 4; i++) this.wheelDots.push(el('i', '', dots));
    this.pitFlash = el('div', 'flash', this.pitGame);
    const tapBtn = el('button', 'tap', this.pitGame, 'TAP');
    tapBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.session?.pitTap();
    });

    window.addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (!this.session || !(n >= 1 && n <= 5)) return;
      const car = this.session.player;
      if (car && (car.pitRequest || car.pit === 'stopped')) this.session.setPitCompound(COMPOUND_ORDER[n - 1]);
    });
  }

  attach(session: RaceSession | null): void {
    this.session = session;
    this.shownMsgIds.clear();
    this.msgs.innerHTML = '';
    this.root.classList.toggle('hidden', !session || session.kind === 'demo');
    if (session) this.buildMap(session.track);
    const qual = session?.kind === 'qualifying';
    this.tower.classList.toggle('hidden', qual);
  }

  update(dt: number): void {
    const session = this.session;
    if (!session || session.kind === 'demo') return;
    const car = session.player;
    if (!car) return;
    const s = settings.get();
    this.root.classList.toggle('colorblind', s.colorblind);

    setText(this.speedEl, String(Math.round(car.speed * 3.6)));
    const lapTime = car.completed >= 0 && session.phase !== 'countdown' ? session.raceTime - car.lapStart : 0;
    setText(this.curEl, car.finished ? formatTime(car.lastLap) : lapTime > 0 ? formatTime(lapTime) : '--:--.---');
    this.drawMap(session);
    this.updatePit(session, car);

    this.lights.classList.toggle('hidden', session.phase !== 'countdown');
    if (session.phase === 'countdown') {
      this.lights.querySelectorAll('i').forEach((l, i) => l.classList.toggle('on', i < session.lightsOn));
    }

    this.slowTimer -= dt;
    if (this.slowTimer > 0) return;
    this.slowTimer = 0.1;

    const qual = session.kind === 'qualifying';
    setText(this.modeTag, qual ? 'QUALIFYING' : session.config.difficulty.toUpperCase());
    if (qual) {
      setText(this.posEl, car.completed < 0 ? 'OUT' : `${Math.min(2, car.completed + 1)}`);
      setText(this.posOf, qual ? '/2 LAPS' : '');
      setText(this.lapEl, car.completed < 0 ? 'Out lap' : car.lapValid ? 'Flying lap' : 'Lap invalid');
    } else {
      setText(this.posEl, `P${session.positionOf(car)}`);
      setText(this.posOf, `/${session.cars.length}`);
      const lap = Math.min(session.totalLaps, Math.max(1, car.completed + 1));
      setText(this.lapEl, car.finished ? 'FINISHED' : `LAP ${lap}/${session.totalLaps}`);
    }
    setText(this.lastEl, formatTime(car.lastLap));
    setText(this.bestEl, formatTime(car.bestLap));

    const ts = tireState(car.wear);
    this.tireEl.className = `tire ${ts.cls}`;
    setText(this.tireLetter, COMPOUNDS[car.compound].letter);
    this.tireLetter.style.setProperty('--c', COMPOUNDS[car.compound].color);
    setText(this.tirePct, `${Math.round((1 - car.wear) * 100)}%`);
    setText(this.tireLabel, car.tireTemp < 0.45 ? 'COLD' : ts.label);
    this.boostBar.style.width = `${Math.round(car.boostEnergy * 100)}%`;
    this.boostBar.parentElement!.classList.toggle('active', car.boosting);

    const tags: string[] = [];
    if (car.slipstream > 0.15) tags.push('<span class="tag slip">SLIPSTREAM</span>');
    if (car.penalty > 0) tags.push(`<span class="tag pen">+${car.penalty}s PENALTY</span>`);
    if (car.surface === 'sand') tags.push('<span class="tag haz">SAND</span>');
    if (car.surface === 'ice') tags.push('<span class="tag haz">ICE</span>');
    if (car.surface === 'puddle') tags.push('<span class="tag haz">STANDING WATER</span>');
    const html = tags.join('');
    if (this.tags.innerHTML !== html) this.tags.innerHTML = html;

    const yellow = !qual && session.yellowAt(car.s) && session.phase === 'racing';
    this.flag.classList.toggle('hidden', !yellow);

    let warn = '';
    if (car.wrongWayTimer > 0.6) warn = 'WRONG WAY';
    else if (s.brakingGuide && session.brakeHint && !car.inPit) warn = 'BRAKE';
    setText(this.warn, warn);
    this.warn.classList.toggle('hidden', !warn);
    this.warn.classList.toggle('brake', warn === 'BRAKE');

    setText(this.weatherEl, `${session.weather.icon}  ${session.weather.forecast(session.raceTime, session.lapSeconds)}`);

    for (const m of session.messages) {
      if (this.shownMsgIds.has(m.id)) continue;
      this.shownMsgIds.add(m.id);
      const d = el('div', `msg ${m.kind}`, this.msgs, `<span>ENGINEER</span>${m.text}`);
      setTimeout(() => d.remove(), 5500);
      while (this.msgs.children.length > 3) this.msgs.firstElementChild?.remove();
    }

    if (!qual) this.updateTower(session, car);
  }

  private updatePit(session: RaceSession, car: Car): void {
    const g = session.pitGame;
    const showPanel = session.kind === 'race' && !car.finished && (car.pitRequest || car.pit === 'entry' || car.pit === 'lane' || car.pit === 'stopped');
    this.pitPanel.classList.toggle('hidden', !showPanel);
    if (showPanel) {
      let title = 'BOX THIS LAP';
      if (car.pit === 'entry') {
        const over = car.pitSpeed > PHYS.PIT_LIMIT + 1.5;
        title = over ? `PIT ENTRY - SLOW TO 80 KM/H (${Math.round(car.pitSpeed * 3.6)})` : 'PIT ENTRY - 80 KM/H LIMIT';
        this.pitPanel.classList.toggle('over', over);
      } else {
        this.pitPanel.classList.remove('over');
        if (car.pit === 'lane') title = car.pitStopDone ? 'PIT LIMITER ON' : 'PIT LIMITER ON - BOX AHEAD';
        if (car.pit === 'stopped') title = 'CHOOSE TIRES';
      }
      setText(this.pitTitle, car.pit === 'none' ? `${title} - press P again to cancel` : title);
      this.chips.forEach((b, i) => b.classList.toggle('sel', COMPOUND_ORDER[i] === car.pitCompound));
    }

    const near = session.kind === 'race' && !car.finished && !car.inPit && session.phase === 'racing';
    const dToEntry = session.track.deltaS(car.s, session.track.pitEntryS);
    const close = dToEntry > 0 ? dToEntry < session.track.L * 0.45 : session.track.wrapS(session.track.pitEntryS - car.s) < session.track.L * 0.45;
    this.input.setPitButton(near && (close || car.pitRequest), car.pitRequest);

    this.pitGame.classList.toggle('hidden', !g);
    if (g) {
      this.needle.style.left = `${g.needle * 100}%`;
      this.zone.style.left = `${(g.zone - 0.11) * 100}%`;
      this.zone.style.width = '22%';
      this.wheelDots.forEach((d, i) => {
        d.className = i < g.results.length ? g.results[i] : i === g.wheel ? 'cur' : '';
      });
      setText(this.pitFlash, g.release >= 0 ? 'GO GO GO!' : g.flash);
      this.pitGame.classList.toggle('locked', g.lockout > 0);
    }
  }

  private updateTower(session: RaceSession, player: Car): void {
    const order = session.order;
    order.forEach((car, i) => {
      const row = this.rows[i];
      if (!row) return;
      const [p, c, n, g, t] = Array.from(row.children) as HTMLElement[];
      setText(p, String(i + 1));
      c.style.background = car.entry.team.color;
      setText(n, car.entry.driver.code);
      let gap = i === 0 ? (session.kind === 'race' ? 'Leader' : '') : session.gapText(car);
      if (car.inPit) gap = 'PIT';
      if (car.finished) gap = i === 0 ? 'FINISH' : gap;
      setText(g, gap + (car.penalty > 0 ? ` +${car.penalty}s` : ''));
      setText(t, COMPOUNDS[car.compound].letter);
      t.style.color = COMPOUNDS[car.compound].color;
      row.classList.toggle('me', car === player);
      row.classList.toggle('fin', car.finished);
    });
    for (let i = order.length; i < this.rows.length; i++) this.rows[i].classList.add('hidden');
  }

  private buildMap(track: TrackModel): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.N; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    const size = 360;
    const pad = 26;
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.mapXf = {
      s: scale,
      ox: pad + ((size - pad * 2) - (maxX - minX) * scale) / 2 - minX * scale,
      oz: pad + ((size - pad * 2) - (maxZ - minZ) * scale) / 2 - minZ * scale,
    };
    this.map.width = size;
    this.map.height = size;
    const base = document.createElement('canvas');
    base.width = size;
    base.height = size;
    const g = base.getContext('2d')!;
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.N; i += 2) {
        const k = i % track.N;
        const [x, y] = this.toMap(track.px[k], track.pz[k]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 14;
    path();
    g.stroke();
    g.strokeStyle = track.theme.edgeA;
    g.shadowColor = track.theme.edgeA;
    g.shadowBlur = 12;
    g.lineWidth = 6;
    path();
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = '#f2f2ff';
    g.lineWidth = 2;
    path();
    g.stroke();
    const [sx, sy] = this.toMap(track.px[0], track.pz[0]);
    g.fillStyle = '#ffffff';
    g.fillRect(sx - 5, sy - 5, 10, 10);
    this.mapBase = base;
  }

  private toMap(x: number, z: number): [number, number] {
    const f = this.mapXf;
    return [x * f.s + f.ox, z * f.s + f.oz];
  }

  private drawMap(session: RaceSession): void {
    if (!this.mapBase) return;
    const g = this.map.getContext('2d')!;
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.drawImage(this.mapBase, 0, 0);
    const player = session.player;
    for (const car of session.cars) {
      if (car === player) continue;
      const [x, y] = this.toMap(car.x, car.z);
      g.fillStyle = car.entry.team.color;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
    }
    if (player) {
      const [x, y] = this.toMap(player.x, player.z);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = player.entry.team.color;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
    }
  }
}
