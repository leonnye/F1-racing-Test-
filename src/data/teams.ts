export interface DriverStats {
  overtaking: number;
  tireCare: number;
  wet: number;
  consistency: number;
  qualifying: number;
  composure: number;
  starts: number;
}

export type DriverTrait =
  | 'slipstream'
  | 'revenge'
  | 'adapts'
  | 'comeback'
  | 'earlyFocusWeak'
  | 'chaosWeak'
  | 'nightOvertaker';

export interface Driver {
  id: string;
  name: string;
  code: string;
  number: number;
  nationality: string;
  personality: string;
  strong: string;
  weak: string;
  stats: DriverStats;
  traits: DriverTrait[];
}

export interface Team {
  id: string;
  name: string;
  abbr: string;
  colorName: string;
  color: string;
  accent: string;
  body: string;
  drivers: [Driver, Driver];
}

const BASE = 0.55;
const HI = 0.88;
const LO = 0.25;

function stats(overrides: Partial<DriverStats>): DriverStats {
  return {
    overtaking: BASE,
    tireCare: BASE,
    wet: BASE,
    consistency: BASE,
    qualifying: BASE,
    composure: BASE,
    starts: BASE,
    ...overrides,
  };
}

export const TEAMS: Team[] = [
  {
    id: 'apex',
    name: 'Apex Velocity',
    abbr: 'APX',
    colorName: 'Hot red',
    color: '#ff2a4d',
    accent: '#ff8fa3',
    body: '#16070b',
    drivers: [
      {
        id: 'sterling',
        name: 'Jace Sterling',
        code: 'STE',
        number: 7,
        nationality: 'GBR',
        personality: 'Confident golden boy',
        strong: 'Qualifying pace',
        weak: 'Composure under pressure',
        stats: stats({ qualifying: HI, composure: LO }),
        traits: [],
      },
      {
        id: 'kvance',
        name: 'Kaelen Vance',
        code: 'KVA',
        number: 23,
        nationality: 'CAN',
        personality: 'Cold, ruthless rival',
        strong: 'Overtaking',
        weak: 'Tire care',
        stats: stats({ overtaking: HI, tireCare: LO }),
        traits: [],
      },
    ],
  },
  {
    id: 'vanguard',
    name: 'Vanguard Corse',
    abbr: 'VGC',
    colorName: 'Electric blue',
    color: '#2f6bff',
    accent: '#8fb0ff',
    body: '#060a18',
    drivers: [
      {
        id: 'rossi',
        name: 'Marco Rossi',
        code: 'ROS',
        number: 46,
        nationality: 'ITA',
        personality: 'Passionate showman',
        strong: 'Slipstream, starts',
        weak: 'Consistency',
        stats: stats({ starts: HI, consistency: LO }),
        traits: ['slipstream'],
      },
      {
        id: 'moretti',
        name: 'Elena Moretti',
        code: 'MOR',
        number: 12,
        nationality: 'ITA',
        personality: 'Calm tactician',
        strong: 'Tire care, long races',
        weak: 'Risk-taking',
        stats: stats({ tireCare: HI, overtaking: 0.35, consistency: 0.7 }),
        traits: [],
      },
    ],
  },
  {
    id: 'meridian',
    name: 'Meridian Strategy',
    abbr: 'MER',
    colorName: 'Cyan',
    color: '#19f0ff',
    accent: '#a0fbff',
    body: '#04121a',
    drivers: [
      {
        id: 'avance',
        name: 'Arthur Vance',
        code: 'AVA',
        number: 3,
        nationality: 'AUS',
        personality: 'Safe veteran',
        strong: 'Consistency',
        weak: 'Overtaking',
        stats: stats({ consistency: HI, overtaking: LO }),
        traits: [],
      },
      {
        id: 'thorne',
        name: 'Silas Thorne',
        code: 'THO',
        number: 31,
        nationality: 'NOR',
        personality: 'Quiet genius',
        strong: 'Wet weather',
        weak: 'Slow starts',
        stats: stats({ wet: HI, starts: 0.15 }),
        traits: [],
      },
    ],
  },
  {
    id: 'kinetic',
    name: 'Kinetic Strike',
    abbr: 'KIN',
    colorName: 'Orange',
    color: '#ff8a1f',
    accent: '#ffc38f',
    body: '#170b03',
    drivers: [
      {
        id: 'holt',
        name: 'Jaxson Holt',
        code: 'HOL',
        number: 88,
        nationality: 'USA',
        personality: 'Hot-headed daredevil',
        strong: 'Speed after being passed',
        weak: 'Crashes',
        stats: stats({ consistency: 0.2, overtaking: 0.7 }),
        traits: ['revenge'],
      },
      {
        id: 'cross',
        name: 'Renna Cross',
        code: 'CRO',
        number: 5,
        nationality: 'IRL',
        personality: 'Fearless, unpredictable',
        strong: 'Fog and wet weather',
        weak: 'Composure',
        stats: stats({ wet: 0.85, composure: LO }),
        traits: [],
      },
    ],
  },
  {
    id: 'zenith',
    name: 'Zenith Precision',
    abbr: 'ZEN',
    colorName: 'Violet',
    color: '#a64dff',
    accent: '#d6adff',
    body: '#0e0618',
    drivers: [
      {
        id: 'ashford',
        name: 'Leo Ashford',
        code: 'ASH',
        number: 14,
        nationality: 'NZL',
        personality: 'Perfectionist',
        strong: 'Qualifying, clean lines',
        weak: 'Chaotic races',
        stats: stats({ qualifying: HI, consistency: 0.78 }),
        traits: ['chaosWeak'],
      },
      {
        id: 'bennett',
        name: 'Freya Bennett',
        code: 'BEN',
        number: 28,
        nationality: 'SWE',
        personality: 'Analytical rookie',
        strong: 'Adapts during a race',
        weak: 'Low early confidence',
        stats: stats({}),
        traits: ['adapts'],
      },
    ],
  },
  {
    id: 'obsidian',
    name: 'Obsidian Drift',
    abbr: 'OBS',
    colorName: 'Lime on black',
    color: '#b6ff2e',
    accent: '#e2ff9e',
    body: '#020302',
    drivers: [
      {
        id: 'hale',
        name: 'Silas Hale',
        code: 'HAL',
        number: 66,
        nationality: 'GER',
        personality: 'Moody lone wolf',
        strong: 'Night overtaking',
        weak: 'Teamwork',
        stats: stats({ overtaking: 0.85 }),
        traits: ['nightOvertaker'],
      },
      {
        id: 'mercer',
        name: 'Kai Mercer',
        code: 'MRC',
        number: 9,
        nationality: 'RSA',
        personality: 'Laid-back risk-taker',
        strong: 'Comeback speed',
        weak: 'Early-race focus',
        stats: stats({}),
        traits: ['comeback', 'earlyFocusWeak'],
      },
    ],
  },
];

export interface Entry {
  team: Team;
  driver: Driver;
}

export function allEntries(): Entry[] {
  const out: Entry[] = [];
  for (const team of TEAMS) for (const driver of team.drivers) out.push({ team, driver });
  return out;
}

export function findEntry(teamId: string, driverId: string): Entry {
  const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  const driver = team.drivers.find((d) => d.id === driverId) ?? team.drivers[0];
  return { team, driver };
}
