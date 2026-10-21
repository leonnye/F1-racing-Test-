import { allEntries } from '../src/data/teams';
import { TRACKS } from '../src/data/tracks';
import { RaceSession, formatTime, type RaceConfig } from '../src/game/race';
import { TrackModel } from '../src/game/trackModel';

const seconds = Number(process.argv[2] ?? 240);
const weather = (process.argv[3] ?? 'clear') as RaceConfig['weather'];

const only = process.argv[4];

for (const def of TRACKS.filter((t) => t.playable && (!only || t.id === only))) {
  const t0 = performance.now();
  const track = new TrackModel(def);
  const built = performance.now() - t0;
  const config: RaceConfig = {
    trackId: def.id,
    teamId: 'apex',
    driverId: 'sterling',
    difficulty: 'pro',
    lapsMode: 'standard',
    qualifying: false,
    weather,
    startCompound: 'medium',
    wearRate: 'normal',
    rubberBand: false,
  };
  const session = new RaceSession('race', config, track, allEntries(), null);
  const spins = new Map<string, number>();
  const respawns = new Map<string, number>();
  const prevSpin = new Map<string, boolean>();
  const prevGhost = new Map<string, number>();
  const dt = 1 / 60;
  const s0 = performance.now();
  for (let t = 0; t < seconds + 8; t += dt) {
    session.update(dt, null);
    for (const car of session.cars) {
      const id = car.entry.driver.code;
      if (car.spinning && !prevSpin.get(id)) spins.set(id, (spins.get(id) ?? 0) + 1);
      if (car.ghost > (prevGhost.get(id) ?? 0) + 1) respawns.set(id, (respawns.get(id) ?? 0) + 1);
      prevSpin.set(id, car.spinning);
      prevGhost.set(id, car.ghost);
    }
  }
  const simMs = performance.now() - s0;
  console.log(`\n=== ${def.name}  L=${track.L.toFixed(0)}m  N=${track.N}  ideal=${formatTime(track.idealLap)}  build=${built.toFixed(0)}ms  sim=${simMs.toFixed(0)}ms  pitSide=${track.pitSide}`);
  for (const car of session.order) {
    const id = car.entry.driver.code;
    console.log(
      `${String(session.positionOf(car)).padStart(2)} ${id} laps=${car.completed} best=${formatTime(car.bestLap)} wear=${car.wear.toFixed(2)} ${car.compound} pits=${car.pitStops} spins=${spins.get(id) ?? 0} resp=${respawns.get(id) ?? 0} pen=${car.penalty} warn=${car.warnings} fin=${car.finished}`,
    );
  }
}
