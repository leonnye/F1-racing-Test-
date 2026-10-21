import * as THREE from 'three';
import { audio } from './core/audio';
import { Input } from './core/input';
import { isTouchDevice, settings, touchEnabled } from './core/settings';
import { allEntries, findEntry, type Entry } from './data/teams';
import { type Compound, weatherGrip } from './data/tires';
import { getTrack } from './data/tracks';
import { DIFFICULTY_PACE } from './game/ai';
import { RaceSession, formatTime, type RaceConfig, type SessionKind } from './game/race';
import { TrackModel } from './game/trackModel';
import { CameraRig } from './render/cameraRig';
import { CarView } from './render/carView';
import { Effects } from './render/effects';
import { TrackView } from './render/trackView';
import { World } from './render/world';
import { Hud } from './ui/hud';
import { Menus, loadSetup } from './ui/menus';
import './style.css';

type AppState = 'title' | 'menu' | 'race' | 'paused' | 'qualiResult' | 'results' | 'layout';

class App {
  private world: World;
  private input: Input;
  private hud: Hud;
  private menus: Menus;
  private rig: CameraRig;
  private effects = new Effects();
  private session: RaceSession | null = null;
  private trackView: TrackView | null = null;
  private carViews: CarView[] = [];
  private sessionGroup = new THREE.Group();
  private state: AppState = 'title';
  private config: RaceConfig | null = null;
  private grid: Entry[] | null = null;
  private demoFocus = 0;
  private demoTimer = 0;
  private resultsRefresh: (() => void) | null = null;
  private resultsTimer = 0;
  private time = 0;
  private last = performance.now();
  private afterLayout: (() => void) | null = null;

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.world = new World(canvas);
    this.input = new Input(document.getElementById('touch')!);
    this.hud = new Hud(document.getElementById('hud')!, this.input);
    this.menus = new Menus(document.getElementById('ui')!);
    this.rig = new CameraRig(this.world.camera);
    this.world.scene.add(this.sessionGroup);
    this.world.scene.add(this.effects.group);
    document.body.classList.toggle('touch', isTouchDevice());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race') this.pause();
    });
    settings.subscribe(() => {
      if (this.state === 'race' || this.state === 'layout') this.input.setTouchVisible(true);
    });

    this.startDemo();
    this.menus.title(() => {
      audio.init();
      this.showMain();
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  private showMain(): void {
    this.state = 'menu';
    this.input.setTouchVisible(false);
    this.menus.main({
      quickRace: () => this.menus.setup((c) => this.begin(c), () => this.showMain()),
      settings: () => this.showSettings(() => this.showMain()),
      howTo: () => this.menus.howTo(() => this.showMain()),
    });
  }

  private showSettings(back: () => void): void {
    this.menus.settings(back, {
      calibrate: () => this.input.calibrateTilt(),
      editLayout: () => this.editLayout(() => this.showSettings(back)),
      requestTilt: () => this.input.requestTiltPermission(),
    });
  }

  private editLayout(done: () => void): void {
    const prev = this.state;
    this.state = 'layout';
    this.afterLayout = done;
    this.input.setEditLayout(true);
    this.input.setTouchVisible(true);
    this.menus.editLayout(() => {
      this.input.setEditLayout(false);
      this.state = prev;
      if (prev !== 'paused' && prev !== 'race') this.input.setTouchVisible(false);
      this.afterLayout?.();
    });
  }

  private startDemo(): void {
    const config = { ...loadSetup(), weather: 'clear' as const };
    const track = new TrackModel(getTrack('metropolis'));
    const grid = this.shuffle(allEntries());
    this.load('demo', config, track, grid, null);
    this.demoTimer = 0;
  }

  private begin(config: RaceConfig): void {
    this.config = config;
    if (config.qualifying) this.startQualifying(config);
    else {
      this.grid = this.simulatedGrid();
      this.startRace();
    }
  }

  private startQualifying(config: RaceConfig): void {
    const track = new TrackModel(getTrack(config.trackId));
    const player = findEntry(config.teamId, config.driverId);
    this.load('qualifying', config, track, [player], player);
    this.enterRaceState();
    this.session!.onQualifyingDone = (best) => {
      setTimeout(() => this.showQualifyingResult(track, best), 1500);
    };
  }

  private showQualifyingResult(track: TrackModel, best: number | null): void {
    const config = this.config!;
    const player = findEntry(config.teamId, config.driverId);
    const wetness = config.weather === 'heavy' ? 1 : config.weather === 'light' ? 0.5 : 0;
    const compound: Compound = wetness > 0.7 ? 'wet' : wetness > 0.2 ? 'inter' : 'soft';
    const grip = weatherGrip(compound, wetness);
    const rows = allEntries().map((e) => {
      if (e.driver.id === player.driver.id) return { entry: e, time: best };
      const pace = DIFFICULTY_PACE[config.difficulty] * (1 + (e.driver.stats.qualifying - 0.55) * 0.03);
      const wetBonus = 1 + (e.driver.stats.wet - 0.5) * 0.06 * wetness;
      const lap = track.buildProfile(track.cornerV, pace * pace * grip * wetBonus).lap;
      return { entry: e, time: lap * (1 + Math.random() * 0.008) };
    });
    rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    this.grid = rows.map((r) => r.entry);
    this.state = 'qualiResult';
    this.input.setTouchVisible(false);
    this.hud.attach(null);
    this.menus.qualifying(
      rows.map((r) => ({
        name: r.entry.driver.name,
        team: r.entry.team.name,
        color: r.entry.team.color,
        time: r.time,
        isPlayer: r.entry.driver.id === player.driver.id,
      })),
      () => this.startRace(),
      () => this.quitToMenu(),
    );
  }

  private startRace(): void {
    const config = this.config!;
    const track = new TrackModel(getTrack(config.trackId));
    const player = findEntry(config.teamId, config.driverId);
    this.load('race', config, track, this.grid ?? this.simulatedGrid(), player);
    this.enterRaceState();
    this.session!.onPlayerFinished = () => {
      setTimeout(() => {
        if (this.state === 'race' || this.state === 'paused') this.showResults();
      }, 2500);
    };
  }

  private enterRaceState(): void {
    this.state = 'race';
    this.menus.hide();
    this.rig.mode = settings.get().camera;
    this.rig.snap();
    this.input.clearActions();
    this.input.setTouchVisible(true);
    if (touchEnabled() && settings.get().tiltSteering) this.input.calibrateTilt();
  }

  private showResults(): void {
    const session = this.session!;
    this.state = 'results';
    this.input.setTouchVisible(false);
    this.hud.attach(null);
    this.resultsRefresh = this.menus.results(
      () => session.classification(),
      () => (session.fastestCar ? `Fastest lap: ${session.fastestCar.entry.driver.name} ${formatTime(session.fastestLap)}` : ''),
      {
        again: () => {
          this.resultsRefresh = null;
          if (this.config?.qualifying) this.startQualifying(this.config);
          else {
            this.grid = this.simulatedGrid();
            this.startRace();
          }
        },
        menu: () => this.quitToMenu(),
      },
    );
  }

  private pause(): void {
    if (this.state !== 'race') return;
    this.state = 'paused';
    audio.silence();
    this.menus.pause(
      {
        resume: () => this.resume(),
        restart: () => {
          if (this.session?.kind === 'qualifying') this.startQualifying(this.config!);
          else this.startRace();
        },
        settings: () => this.showSettings(() => this.pauseMenuAgain()),
        quit: () => this.quitToMenu(),
        editLayout: () => this.editLayout(() => this.pauseMenuAgain()),
      },
      touchEnabled(),
    );
  }

  private pauseMenuAgain(): void {
    this.state = 'race';
    this.pause();
  }

  private resume(): void {
    this.state = 'race';
    this.menus.hide();
    this.input.clearActions();
    this.last = performance.now();
  }

  private quitToMenu(): void {
    this.resultsRefresh = null;
    this.hud.attach(null);
    this.startDemo();
    this.showMain();
  }

  private simulatedGrid(): Entry[] {
    return allEntries()
      .map((e) => ({ e, score: e.driver.stats.qualifying * 0.5 + Math.random() }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.e);
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private load(kind: SessionKind, config: RaceConfig, track: TrackModel, grid: Entry[], player: Entry | null): void {
    for (const v of this.carViews) {
      this.sessionGroup.remove(v.group, v.trailObject);
      v.dispose();
    }
    this.carViews = [];
    if (this.trackView) {
      this.sessionGroup.remove(this.trackView.group);
      this.trackView.dispose();
    }
    this.effects.clear();

    this.session = new RaceSession(kind, config, track, grid, player);
    this.trackView = new TrackView(track);
    this.sessionGroup.add(this.trackView.group);
    for (const car of this.session.cars) {
      const view = new CarView(car);
      this.carViews.push(view);
      this.sessionGroup.add(view.group, view.trailObject);
    }
    this.hud.attach(kind === 'demo' ? null : this.session);
    this.rig.snap();
  }

  private frame(t: number): void {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.time += dt;
    const session = this.session;
    if (!session) return;

    if (this.state === 'race') {
      if (this.input.consume('pause')) {
        this.pause();
      } else {
        if (this.input.consume('camera')) {
          const mode = this.rig.cycle();
          settings.update({ camera: mode });
        }
        session.update(dt, this.input);
      }
    } else if (this.state === 'paused') {
      if (this.input.consume('pause')) this.resume();
    } else {
      this.input.clearActions();
      if (this.state !== 'layout') session.update(dt, null);
    }

    if (this.state === 'results' && this.resultsRefresh) {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) {
        this.resultsTimer = 0.5;
        this.resultsRefresh();
      }
    }

    let focus = session.focusCar;
    const cinematic = session.kind === 'demo' || this.state === 'results' || this.state === 'qualiResult';
    if (session.kind === 'demo') {
      this.demoTimer -= dt;
      if (this.demoTimer <= 0) {
        this.demoTimer = 11;
        this.demoFocus = Math.floor(Math.random() * Math.min(8, session.order.length));
        this.rig.snap();
      }
      focus = session.order[this.demoFocus] ?? focus;
    }
    this.rig.update(dt, focus, {
      rear: this.state === 'race' && this.input.rear,
      shake: this.state === 'race' ? session.shake : 0,
      cinematic,
    });

    const w = session.weather;
    const cam = this.world.camera.position;
    this.trackView?.update(this.time, w.wetness, w.rain, w.fog, w.cloudy, this.world.scene);
    this.trackView?.setStartLights(session.phase === 'countdown' ? session.lightsOn : 0);
    for (const v of this.carViews) v.update(this.time, w.wetness, cam);
    this.effects.update(dt, cam, w.rain, w.wetness, session.cars, session.sparks);
    this.hud.update(dt);

    const player = session.player;
    if (player && this.state === 'race') {
      audio.update({
        speed: player.speed,
        throttle: player.controls.throttle,
        slide: player.sliding + (player.surface === 'off' ? 2 : 0),
        rain: w.rain,
        boost: player.boosting,
        active: true,
      });
    } else {
      audio.silence();
    }

    this.world.render();
  }
}

new App();
