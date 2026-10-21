import { audio } from '../core/audio';
import { isTouchDevice, settings, type Settings } from '../core/settings';
import { TEAMS } from '../data/teams';
import { COMPOUNDS, COMPOUND_ORDER } from '../data/tires';
import { TRACKS } from '../data/tracks';
import { formatTime, raceLaps, type ClassRow, type RaceConfig } from '../game/race';
import { WEATHER_LABELS, type WeatherMode } from '../game/weather';

type Option<T> = { value: T; label: string };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function segmented<T extends string | boolean | number>(name: string, options: Option<T>[], value: T): string {
  return `<div class="seg" data-seg="${name}">${options
    .map((o) => `<button type="button" data-value="${String(o.value)}" class="${o.value === value ? 'sel' : ''}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}

function bindSegments(root: HTMLElement, onChange: (name: string, value: string) => void): void {
  root.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        audio.click();
        onChange(seg.dataset.seg!, b.dataset.value!);
      });
    });
  });
}

function parseValue(v: string): string | boolean | number {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export interface MainMenuHandlers {
  quickRace: () => void;
  settings: () => void;
  howTo: () => void;
}

export interface PauseHandlers {
  resume: () => void;
  restart: () => void;
  settings: () => void;
  quit: () => void;
  editLayout: () => void;
}

const SETUP_KEY = 'overdrive-gp.setup.v1';

export function loadSetup(): RaceConfig {
  const def: RaceConfig = {
    trackId: 'metropolis',
    teamId: 'obsidian',
    driverId: 'mercer',
    difficulty: 'pro',
    lapsMode: 'short',
    qualifying: false,
    weather: 'clear',
    startCompound: 'medium',
    wearRate: 'normal',
    rubberBand: false,
  };
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    return raw ? { ...def, ...(JSON.parse(raw) as Partial<RaceConfig>) } : def;
  } catch {
    return def;
  }
}

function saveSetup(c: RaceConfig): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(c));
  } catch {
    // Not critical; the setup simply won't be remembered.
  }
}

export class Menus {
  constructor(private root: HTMLElement) {}

  hide(): void {
    this.root.innerHTML = '';
    this.root.className = '';
  }

  private screen(cls: string, html: string): HTMLElement {
    this.root.className = 'menu-layer';
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    return this.root.firstElementChild as HTMLElement;
  }

  title(onStart: () => void): void {
    const s = this.screen(
      'title',
      `<div class="logo"><span class="o">OVERDRIVE</span><span class="gp">GP</span></div>
       <div class="tagline">Neon night Formula racing</div>
       <div class="press">${isTouchDevice() ? 'Tap' : 'Press any key or click'} to start</div>`,
    );
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', go);
      onStart();
    };
    s.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  main(h: MainMenuHandlers): void {
    const s = this.screen(
      'main',
      `<div class="logo small"><span class="o">OVERDRIVE</span><span class="gp">GP</span></div>
       <nav class="main-nav">
         <button data-go="quick" class="primary">Quick Race</button>
         <button data-soon="Career mode">Career <em>Soon</em></button>
         <button data-soon="Online multiplayer">Multiplayer <em>Soon</em></button>
         <button data-soon="Create your own team and driver">Create Team &amp; Player <em>Soon</em></button>
         <button data-go="settings">Settings</button>
         <button data-go="howto">Driving School</button>
         <button data-soon="Sign in with Google, Apple, or email">Sign In <em>Soon</em></button>
       </nav>
       <div class="guest-note">Playing as guest. Quick races are not saved.</div>`,
    );
    s.querySelector('[data-go="quick"]')!.addEventListener('click', () => (audio.click(), h.quickRace()));
    s.querySelector('[data-go="settings"]')!.addEventListener('click', () => (audio.click(), h.settings()));
    s.querySelector('[data-go="howto"]')!.addEventListener('click', () => (audio.click(), h.howTo()));
    s.querySelectorAll<HTMLButtonElement>('[data-soon]').forEach((b) =>
      b.addEventListener('click', () => this.toast(`${b.dataset.soon} is planned for a later version. It needs accounts and a server.`)),
    );
  }

  toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  setup(onStart: (c: RaceConfig) => void, onBack: () => void): void {
    const c = loadSetup();
    const render = () => {
      const team = TEAMS.find((t) => t.id === c.teamId) ?? TEAMS[0];
      const driver = team.drivers.find((d) => d.id === c.driverId) ?? team.drivers[0];
      const track = TRACKS.find((t) => t.id === c.trackId && t.playable) ?? TRACKS[0];
      const laps = raceLaps(track.laps, c.lapsMode);
      const s = this.screen(
        'setup',
        `<header><button class="back">&larr; Back</button><h1>Quick Race</h1><span></span></header>
         <div class="setup-grid">
           <section>
             <h2>Team &amp; Driver</h2>
             <div class="teams">${TEAMS.map(
               (t) => `<div class="team ${t.id === team.id ? 'sel' : ''}" style="--tc:${t.color}">
                  <div class="tname">${esc(t.name)}</div><div class="tcolor">${esc(t.colorName)}</div>
                  <div class="drivers">${t.drivers
                    .map((d) => `<button data-team="${t.id}" data-driver="${d.id}" class="${d.id === driver.id ? 'sel' : ''}">#${d.number} ${esc(d.name)}</button>`)
                    .join('')}</div></div>`,
             ).join('')}</div>
             <div class="driver-card" style="--tc:${team.color}">
               <div class="num">${driver.number}</div>
               <div><b>${esc(driver.name)}</b> <span class="nat">${driver.nationality}</span><br/>
               <i>${esc(driver.personality)}</i><br/>
               <span class="strong">+ ${esc(driver.strong)}</span><br/><span class="weak">- ${esc(driver.weak)}</span></div>
             </div>
           </section>
           <section>
             <h2>Track</h2>
             <div class="tracks">${TRACKS.map(
               (t) => `<button class="trk ${t.id === track.id ? 'sel' : ''} ${t.playable ? '' : 'locked'}" data-track="${t.id}" ${t.playable ? '' : 'disabled'}>
                 <span class="n">${t.num}</span><span class="info"><b>${esc(t.name)}</b><small>${esc(t.setting)} &middot; ${esc(t.hazards)}</small></span>
                 <span class="laps">${t.playable ? `${t.laps} laps` : 'Soon'}</span></button>`,
             ).join('')}</div>
           </section>
           <section>
             <h2>Race</h2>
             <label>Difficulty</label>${segmented('difficulty', [
               { value: 'rookie', label: 'Rookie' },
               { value: 'pro', label: 'Pro' },
               { value: 'legend', label: 'Legend' },
             ], c.difficulty)}
             <label>Race length</label>${segmented('lapsMode', [
               { value: 'short', label: 'Short (3 laps)' },
               { value: 'standard', label: `Standard (${track.laps} laps)` },
             ], c.lapsMode)}
             <label>Qualifying</label>${segmented('qualifying', [
               { value: false, label: 'Off' },
               { value: true, label: 'Two-lap shootout' },
             ], c.qualifying)}
             <label>Weather</label>${segmented(
               'weather',
               (Object.keys(WEATHER_LABELS) as WeatherMode[]).map((w) => ({ value: w, label: WEATHER_LABELS[w] })),
               c.weather,
             )}
             <label>Starting tires</label>${segmented(
               'startCompound',
               COMPOUND_ORDER.map((k) => ({ value: k, label: COMPOUNDS[k].name })),
               c.startCompound,
             )}
             <label>Tire wear</label>${segmented('wearRate', [
               { value: 'low', label: 'Low' },
               { value: 'normal', label: 'Normal' },
               { value: 'high', label: 'High' },
             ], c.wearRate)}
             <label>Rubber-banding</label>${segmented('rubberBand', [
               { value: false, label: 'Off' },
               { value: true, label: 'Light' },
             ], c.rubberBand)}
             <p class="hint">${laps} laps on ${esc(track.name)}. Pit lane: ${esc(track.pitDesc)}.</p>
           </section>
         </div>
         <footer><button class="start primary">Start ${c.qualifying ? 'Qualifying' : 'Race'}</button></footer>`,
      );
      s.querySelector('.back')!.addEventListener('click', () => (audio.click(), onBack()));
      s.querySelectorAll<HTMLButtonElement>('[data-driver]').forEach((b) =>
        b.addEventListener('click', () => {
          audio.click();
          c.teamId = b.dataset.team!;
          c.driverId = b.dataset.driver!;
          saveSetup(c);
          const scroll = s.querySelector('.setup-grid')!.scrollTop;
          render();
          this.root.querySelector('.setup-grid')!.scrollTop = scroll;
        }),
      );
      s.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) =>
        b.addEventListener('click', () => {
          audio.click();
          c.trackId = b.dataset.track!;
          saveSetup(c);
          const scroll = s.querySelector('.setup-grid')!.scrollTop;
          render();
          this.root.querySelector('.setup-grid')!.scrollTop = scroll;
        }),
      );
      bindSegments(s, (name, value) => {
        (c as unknown as Record<string, unknown>)[name] = parseValue(value);
        if (name === 'difficulty') c.rubberBand = value === 'rookie';
        if (name === 'weather') {
          if (value === 'heavy') c.startCompound = 'wet';
          else if (value === 'light') c.startCompound = 'inter';
          else if (c.startCompound === 'wet' || c.startCompound === 'inter') c.startCompound = 'medium';
        }
        saveSetup(c);
        if (['difficulty', 'weather', 'lapsMode', 'qualifying'].includes(name)) {
          const scroll = s.querySelector('.setup-grid')!.scrollTop;
          render();
          this.root.querySelector('.setup-grid')!.scrollTop = scroll;
        }
      });
      s.querySelector('.start')!.addEventListener('click', () => {
        audio.click();
        saveSetup(c);
        onStart({ ...c });
      });
    };
    render();
  }

  settings(onBack: () => void, extras: { calibrate: () => void; editLayout: () => void; requestTilt: () => Promise<boolean> }): void {
    const render = () => {
      const st = settings.get();
      const toggle = (key: keyof Settings, label: string, desc = '') =>
        `<div class="set-row"><div><b>${label}</b>${desc ? `<small>${desc}</small>` : ''}</div>${segmented(key, [
          { value: false, label: 'Off' },
          { value: true, label: 'On' },
        ], st[key] as boolean)}</div>`;
      const s = this.screen(
        'settings',
        `<header><button class="back">&larr; Back</button><h1>Settings</h1><span></span></header>
         <div class="settings-body">
           <section><h2>Assists</h2>
             ${toggle('brakingGuide', 'Braking guide', 'Red markers and a BRAKE warning before corners')}
             ${toggle('steeringHelp', 'Steering help', 'Keeps the car pointed down the track and prevents most spins')}
             ${toggle('racingLine', 'Racing line', 'Shows the ideal line on the road')}
           </section>
           <section><h2>Display</h2>
             <div class="set-row"><div><b>Glow level</b><small>Low turns off bloom for better phone performance</small></div>${segmented('glow', [
               { value: 'low', label: 'Low' },
               { value: 'full', label: 'Full' },
             ], st.glow)}</div>
             ${toggle('reducedFlashing', 'Reduced flashing', 'Stops flickering tunnel lights and blinking rain lights')}
             ${toggle('colorblind', 'Colorblind-safe colors', 'Blue, amber and magenta tire states')}
             ${toggle('nameTags', 'Driver name tags')}
             <div class="set-row"><div><b>Camera</b></div>${segmented('camera', [
               { value: 'chase', label: 'Chase' },
               { value: 'far', label: 'Far' },
               { value: 'hood', label: 'Hood' },
             ], st.camera)}</div>
           </section>
           <section><h2>Sound</h2>
             <div class="set-row"><div><b>Volume</b></div><input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-range="volume"/></div>
           </section>
           <section><h2>Touch controls</h2>
             <div class="set-row"><div><b>Show touch buttons</b></div>${segmented('touchControls', [
               { value: 'auto', label: 'Auto' },
               { value: 'on', label: 'On' },
               { value: 'off', label: 'Off' },
             ], st.touchControls)}</div>
             <div class="set-row"><div><b>Button size</b></div><input type="range" min="0.7" max="1.5" step="0.05" value="${st.buttonSize}" data-range="buttonSize"/></div>
             <div class="set-row"><div><b>Button opacity</b></div><input type="range" min="0.2" max="1" step="0.05" value="${st.buttonOpacity}" data-range="buttonOpacity"/></div>
             ${toggle('tiltSteering', 'Tilt steering', 'Steer by tilting the phone in landscape')}
             ${toggle('vibration', 'Vibration')}
             <div class="set-row buttons">
               <button class="ghost" data-act="calibrate">Calibrate tilt</button>
               <button class="ghost" data-act="layout">Move buttons</button>
               <button class="ghost" data-act="reset">Reset all settings</button>
             </div>
           </section>
         </div>`,
      );
      s.querySelector('.back')!.addEventListener('click', () => (audio.click(), onBack()));
      bindSegments(s, async (name, value) => {
        const v = parseValue(value);
        if (name === 'tiltSteering' && v === true) {
          const ok = await extras.requestTilt();
          if (!ok) {
            this.toast('Tilt permission was not granted.');
            render();
            return;
          }
        }
        settings.update({ [name]: v } as Partial<Settings>);
      });
      s.querySelectorAll<HTMLInputElement>('[data-range]').forEach((input) =>
        input.addEventListener('input', () => settings.update({ [input.dataset.range!]: Number(input.value) } as Partial<Settings>)),
      );
      s.querySelector('[data-act="calibrate"]')!.addEventListener('click', () => {
        extras.calibrate();
        this.toast('Tilt centered. Hold the phone the way you want to drive straight.');
      });
      s.querySelector('[data-act="layout"]')!.addEventListener('click', () => extras.editLayout());
      s.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
        settings.reset();
        render();
      });
    };
    render();
  }

  howTo(onBack: () => void): void {
    const s = this.screen(
      'howto',
      `<header><button class="back">&larr; Back</button><h1>Driving School</h1><span></span></header>
       <div class="howto-body">
         <section><h2>Controls</h2>
           <table>
             <tr><th>Action</th><th>Keyboard</th><th>Phone</th></tr>
             <tr><td>Steer</td><td>Arrows or A / D</td><td>Left-side buttons, or tilt</td></tr>
             <tr><td>Gas / Brake</td><td>Up / Down or W / S</td><td>GAS / BRAKE buttons</td></tr>
             <tr><td>Boost</td><td>Shift or Space</td><td>BOOST button</td></tr>
             <tr><td>Camera</td><td>C</td><td>CAM</td></tr>
             <tr><td>Pit this lap</td><td>P</td><td>PIT button (shows near the pits)</td></tr>
             <tr><td>Rear view</td><td>Hold R</td><td>Hold REAR</td></tr>
             <tr><td>Pause</td><td>Esc</td><td>II</td></tr>
           </table>
         </section>
         <section><h2>Steering and braking</h2>
           <p>Brake in a straight line before the corner, then turn in. With the braking guide on, red stripes on the road and a BRAKE warning show where to slow down.</p>
           <p>Grip has a limit. Turning too hard at speed makes the car slide wide. Steering help keeps you pointed down the track and stops most spins. Turn it off for full control.</p>
           <p>Boost adds speed on straights. It refills slowly, and faster when you brake. Following close behind another car gives you a slipstream for extra speed.</p>
         </section>
         <section><h2>Tires</h2>
           <p><b style="color:${COMPOUNDS.soft.color}">Soft</b> is fast but wears quickly. <b style="color:${COMPOUNDS.medium.color}">Medium</b> is balanced. <b style="color:${COMPOUNDS.hard.color}">Hard</b> is slower but lasts.
           <b style="color:${COMPOUNDS.inter.color}">Intermediates</b> are for light rain and <b style="color:${COMPOUNDS.wet.color}">wets</b> for heavy rain.</p>
           <p>Hard braking, sliding, kerbs and running off the track wear tires faster. The tire icon goes from green to yellow to red, and grip drops as it wears. New tires are cold, so take it easy for the first corners.</p>
         </section>
         <section><h2>Pit stops</h2>
           <p>Press P (or the PIT button) to box this lap and pick your next tires. Slow to 80 km/h before the pit limit line or you get a time penalty. At your box, tap when the marker is in the green zone for each wheel. Good timing means a faster stop.</p>
         </section>
         <section><h2>Flags and penalties</h2>
           <p><b class="yel">Yellow flag</b>: an incident ahead. No overtaking in the zone.</p>
           <p>Time penalties (+5s) are given for causing a collision, overtaking under yellow, pit lane speeding, and every third track-limits warning. They are added to your race time.</p>
         </section>
         <section><h2>Weather</h2>
           <p>Rain can start or stop mid-race in Changing weather. The forecast at the top shows what is coming. Wet roads have less grip and standing water. Some drivers are better in the wet.</p>
         </section>
       </div>`,
    );
    s.querySelector('.back')!.addEventListener('click', () => (audio.click(), onBack()));
  }

  pause(h: PauseHandlers, touch: boolean): void {
    const s = this.screen(
      'pause',
      `<div class="panel">
         <h1>Paused</h1>
         <button data-a="resume" class="primary">Resume</button>
         <button data-a="restart">Restart</button>
         <button data-a="settings">Settings</button>
         ${touch ? '<button data-a="layout">Move buttons</button>' : ''}
         <button data-a="quit">Quit to menu</button>
       </div>`,
    );
    s.querySelector('[data-a="resume"]')!.addEventListener('click', () => h.resume());
    s.querySelector('[data-a="restart"]')!.addEventListener('click', () => h.restart());
    s.querySelector('[data-a="settings"]')!.addEventListener('click', () => h.settings());
    s.querySelector('[data-a="quit"]')!.addEventListener('click', () => h.quit());
    s.querySelector('[data-a="layout"]')?.addEventListener('click', () => h.editLayout());
  }

  editLayout(onDone: () => void): void {
    this.root.className = 'menu-layer passthrough';
    this.root.innerHTML = `<div class="layout-bar"><span>Drag the button groups to move them</span><button class="primary">Done</button><button class="ghost reset">Reset</button></div>`;
    this.root.querySelector('.primary')!.addEventListener('click', onDone);
    this.root.querySelector('.reset')!.addEventListener('click', () => settings.update({ touchOffsets: { steer: [0, 0], pedals: [0, 0] } }));
  }

  qualifying(rows: { name: string; team: string; color: string; time: number | null; isPlayer: boolean }[], onStart: () => void, onQuit: () => void): void {
    const s = this.screen(
      'results',
      `<div class="panel wide">
         <h1>Qualifying Result</h1>
         <table class="class">
           <tr><th>Grid</th><th>Driver</th><th>Team</th><th>Time</th></tr>
           ${rows
             .map(
               (r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i class="sw" style="background:${r.color}"></i>${esc(r.name)}</td><td>${esc(r.team)}</td><td>${r.time ? formatTime(r.time) : 'No time'}</td></tr>`,
             )
             .join('')}
         </table>
         <div class="actions"><button class="ghost quit">Main menu</button><button class="primary go">Start Race</button></div>
       </div>`,
    );
    s.querySelector('.go')!.addEventListener('click', () => (audio.click(), onStart()));
    s.querySelector('.quit')!.addEventListener('click', () => (audio.click(), onQuit()));
  }

  results(getRows: () => ClassRow[], fastest: () => string, h: { again: () => void; menu: () => void }): () => void {
    const s = this.screen(
      'results',
      `<div class="panel wide">
         <h1>Race Result</h1>
         <div class="fastest"></div>
         <table class="class"><thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time</th><th>Best lap</th><th>Pits</th><th>Pen.</th></tr></thead><tbody></tbody></table>
         <div class="actions"><button class="ghost menu">Main menu</button><button class="primary again">Race again</button></div>
       </div>`,
    );
    s.querySelector('.again')!.addEventListener('click', () => (audio.click(), h.again()));
    s.querySelector('.menu')!.addEventListener('click', () => (audio.click(), h.menu()));
    const body = s.querySelector('tbody')!;
    const fastestEl = s.querySelector<HTMLElement>('.fastest')!;
    const refresh = () => {
      const rows = getRows();
      body.innerHTML = rows
        .map(
          (r) => `<tr class="${r.car.isPlayer ? 'me' : ''} ${r.finished ? '' : 'running'}"><td>${r.pos}</td>
            <td><i class="sw" style="background:${r.car.entry.team.color}"></i>${esc(r.car.entry.driver.name)}</td>
            <td>${esc(r.car.entry.team.name)}</td><td>${r.gapText}</td><td>${formatTime(r.car.bestLap)}</td>
            <td>${r.car.pitStops}</td><td>${r.car.penalty > 0 ? `+${r.car.penalty}s` : ''}</td></tr>`,
        )
        .join('');
      fastestEl.textContent = fastest();
    };
    refresh();
    return refresh;
  }
}
