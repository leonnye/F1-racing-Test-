export type ThemeId = 'city' | 'coast' | 'desert' | 'rooftop' | 'glacier' | 'power' | 'pier' | 'canyon' | 'forest' | 'speedway';

export interface Theme {
  id: ThemeId;
  sky: [string, string];
  fog: string;
  ground: string;
  grid: string;
  edgeA: string;
  edgeB: string;
  runoff: string;
  stars: boolean;
}

export type TrackFeature =
  | { type: 'tunnel'; from: number; to: number }
  | { type: 'bridge'; at: number }
  | { type: 'patches'; kind: 'sand' | 'ice'; count: number; drift: boolean };

export interface TrackDef {
  id: string;
  num: number;
  name: string;
  setting: string;
  hazards: string;
  pitDesc: string;
  laps: number;
  playable: boolean;
  theme: ThemeId;
  points?: [number, number][];
  halfWidth?: number;
  runoff?: number;
  /** Tire load multiplier for this circuit. */
  tireLoad?: number;
  /** 0 cold, 0.5 normal, 1 hot. */
  temperature?: number;
  /** Pit lane entry/exit distance in meters from the start line. */
  pitEntry?: number;
  pitExit?: number;
  features?: TrackFeature[];
  /** Max banking angle in degrees, applied in fast corners. */
  banking?: number;
  slipstream?: number;
  baseFog?: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  city: { id: 'city', sky: ['#1a0838', '#020107'], fog: '#12071f', ground: '#06050b', grid: '#ff2bd6', edgeA: '#ff2bd6', edgeB: '#19f0ff', runoff: '#0d0b16', stars: true },
  coast: { id: 'coast', sky: ['#082038', '#010308'], fog: '#06121c', ground: '#03080d', grid: '#19c8ff', edgeA: '#19c8ff', edgeB: '#ff6bd6', runoff: '#0a1016', stars: true },
  desert: { id: 'desert', sky: ['#3a0f2b', '#05020a'], fog: '#1d0a17', ground: '#120806', grid: '#ff8a1f', edgeA: '#ff8a1f', edgeB: '#ff2bd6', runoff: '#1c120c', stars: true },
  rooftop: { id: 'rooftop', sky: ['#20103a', '#020107'], fog: '#110a1f', ground: '#05040a', grid: '#a64dff', edgeA: '#a64dff', edgeB: '#19f0ff', runoff: '#0d0b16', stars: true },
  glacier: { id: 'glacier', sky: ['#0b2a44', '#01040a'], fog: '#0e2033', ground: '#0a1520', grid: '#7fe7ff', edgeA: '#7fe7ff', edgeB: '#a64dff', runoff: '#14212e', stars: true },
  power: { id: 'power', sky: ['#14213a', '#010207'], fog: '#0a1220', ground: '#04060b', grid: '#b6ff2e', edgeA: '#b6ff2e', edgeB: '#19f0ff', runoff: '#0b0e14', stars: false },
  pier: { id: 'pier', sky: ['#0a1e3a', '#010309'], fog: '#071322', ground: '#020610', grid: '#2f6bff', edgeA: '#2f6bff', edgeB: '#ffd400', runoff: '#0a0f18', stars: true },
  canyon: { id: 'canyon', sky: ['#2d0d12', '#040103'], fog: '#1a0709', ground: '#0e0505', grid: '#ff2a4d', edgeA: '#ff2a4d', edgeB: '#ff8a1f', runoff: '#170c0b', stars: true },
  forest: { id: 'forest', sky: ['#0b2a1c', '#010604'], fog: '#06170f', ground: '#030a06', grid: '#2ee86b', edgeA: '#2ee86b', edgeB: '#19f0ff', runoff: '#08120c', stars: true },
  speedway: { id: 'speedway', sky: ['#24083a', '#020107'], fog: '#14071f', ground: '#05040b', grid: '#19f0ff', edgeA: '#19f0ff', edgeB: '#ff2bd6', runoff: '#0d0b16', stars: true },
};

export const TRACKS: TrackDef[] = [
  {
    id: 'metropolis',
    num: 1,
    name: 'Neon Metropolis Circuit',
    setting: 'City',
    hazards: 'Hairpin under a bridge, flickering tunnel',
    pitDesc: 'Main straight, low time loss',
    laps: 8,
    playable: true,
    theme: 'city',
    halfWidth: 7,
    runoff: 5,
    tireLoad: 1.0,
    temperature: 0.55,
    pitEntry: 300,
    pitExit: 300,
    points: [
      [0, 0], [250, 0], [420, 0], [500, 50], [520, 160], [470, 250], [380, 280], [330, 350],
      [360, 450], [460, 520], [520, 620], [470, 700], [380, 690], [250, 600], [120, 620], [40, 720],
      [-80, 760], [-220, 700], [-300, 600], [-260, 480], [-150, 420], [-120, 320], [-220, 250], [-380, 240],
      [-480, 160], [-470, 50], [-400, 0], [-200, 0],
    ],
    features: [
      { type: 'tunnel', from: 15, to: 17 },
      { type: 'bridge', at: 22 },
    ],
  },
  {
    id: 'harborlight',
    num: 2,
    name: 'Harborlight Street GP',
    setting: 'Coastal',
    hazards: 'Wet dock plates, crosswinds',
    pitDesc: 'Narrow, behind harbor wall',
    laps: 8,
    playable: false,
    theme: 'coast',
  },
  {
    id: 'mirage',
    num: 3,
    name: 'Mirage Dunes Raceway',
    setting: 'Desert',
    hazards: 'Drifting sand, blind crests',
    pitDesc: 'Wide, easy entry',
    laps: 6,
    playable: true,
    theme: 'desert',
    halfWidth: 8,
    runoff: 12,
    tireLoad: 1.15,
    temperature: 0.9,
    pitEntry: 320,
    pitExit: 300,
    points: [
      [0, 0], [300, 0], [500, 0], [650, 60], [700, 200], [620, 330], [480, 360], [400, 460],
      [450, 600], [600, 680], [700, 800], [650, 950], [480, 1000], [300, 940], [200, 820], [60, 780],
      [-100, 860], [-260, 900], [-420, 820], [-450, 660], [-330, 560], [-380, 420], [-520, 360], [-600, 220],
      [-560, 80], [-420, 0], [-200, 0],
    ],
    features: [{ type: 'patches', kind: 'sand', count: 14, drift: true }],
  },
  {
    id: 'skyline',
    num: 4,
    name: 'Skyline Loop',
    setting: 'Rooftops',
    hazards: 'No runoff, moving barriers',
    pitDesc: 'Lower level, ramp access',
    laps: 10,
    playable: false,
    theme: 'rooftop',
  },
  {
    id: 'glacier',
    num: 5,
    name: 'Glacier Run',
    setting: 'Frozen mountain',
    hazards: 'Ice patches, low visibility',
    pitDesc: 'Standard, cold tires matter',
    laps: 7,
    playable: true,
    theme: 'glacier',
    halfWidth: 7.5,
    runoff: 9,
    tireLoad: 0.85,
    temperature: 0.05,
    pitEntry: 300,
    pitExit: 280,
    baseFog: 0.0045,
    points: [
      [0, 0], [250, 0], [450, 0], [560, 80], [560, 220], [450, 300], [300, 300], [200, 380],
      [220, 520], [350, 600], [520, 600], [640, 700], [620, 860], [480, 940], [300, 900], [150, 800],
      [0, 820], [-150, 920], [-320, 900], [-400, 760], [-330, 620], [-420, 500], [-560, 450], [-620, 300],
      [-560, 140], [-420, 30], [-220, 0],
    ],
    features: [{ type: 'patches', kind: 'ice', count: 12, drift: false }],
  },
  {
    id: 'voltage',
    num: 6,
    name: 'Voltage Park',
    setting: 'Power plant',
    hazards: 'Timed laser gates, chicanes',
    pitDesc: 'Cuts through the circuit',
    laps: 9,
    playable: false,
    theme: 'power',
  },
  {
    id: 'tidal',
    num: 7,
    name: 'Tidal Pier Circuit',
    setting: 'Over water',
    hazards: 'Spray, narrow pier',
    pitDesc: 'Short, tight garages',
    laps: 10,
    playable: false,
    theme: 'pier',
  },
  {
    id: 'obsidian',
    num: 8,
    name: 'Obsidian Canyon',
    setting: 'Canyon',
    hazards: 'Rockfall, fast sweepers',
    pitDesc: 'Longest pit lane',
    laps: 5,
    playable: false,
    theme: 'canyon',
  },
  {
    id: 'lumen',
    num: 9,
    name: 'Lumen Forest GP',
    setting: 'Glowing forest',
    hazards: 'Branches, fog patches',
    pitDesc: 'Hidden among trees',
    laps: 6,
    playable: false,
    theme: 'forest',
  },
  {
    id: 'infinity',
    num: 10,
    name: 'Apex Infinity Speedway',
    setting: 'High-speed ring',
    hazards: 'Banked turns, slipstream battles',
    pitDesc: 'Fastest pit lane',
    laps: 8,
    playable: true,
    theme: 'speedway',
    halfWidth: 9,
    runoff: 4,
    tireLoad: 1.1,
    temperature: 0.6,
    pitEntry: 360,
    pitExit: 360,
    banking: 12,
    slipstream: 1.6,
    points: [
      [0, 0], [300, 0], [550, 0], [700, 40], [790, 150], [800, 300], [730, 420], [570, 490],
      [330, 505], [130, 500], [40, 455], [-40, 455], [-130, 500], [-330, 505], [-570, 490], [-730, 420],
      [-800, 300], [-790, 150], [-700, 40], [-550, 0], [-300, 0],
    ],
  },
];

export function getTrack(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id && t.playable) ?? TRACKS[0];
}
