// Game data: terrain, unit, building and research definitions.
// Everything balance-related lives here so it can be tuned in one place.

export const TILE = 32;
export const STEP = 1 / 60;
export const MAP_SIZE = 80;

export const T = {
  GRASS: 0,
  TREE: 1,
  WATER: 2,
  ROCK: 3,
  STUMP: 4,
  DIRT: 5,
};

export const CARRY_AMOUNT = 10;
export const TREE_WOOD = 40;
export const MINE_GOLD = 10000;
export const MINE_TIME = 2.0;
export const CHOP_TIME = 3.2;
export const DEPOSIT_TIME = 0.35;
export const MAX_FOOD = 100;
export const MAX_QUEUE = 5;

export const PLAYER = 0;
export const ENEMY = 1;
export const NEUTRAL = -1;

export const TEAM_COLORS = {
  [PLAYER]: { main: '#2f6fdb', dark: '#1b3f86', light: '#7fb0ff', name: 'Blue' },
  [ENEMY]: { main: '#c8322b', dark: '#7a1712', light: '#ff8a7a', name: 'Red' },
  [NEUTRAL]: { main: '#b8a36a', dark: '#6d5f3a', light: '#e8d9a8', name: 'Neutral' },
};

export const UNITS = {
  peasant: {
    name: 'Peasant',
    hp: 30,
    armor: 0,
    damage: 3,
    pierce: 1,
    range: 1,
    cooldown: 1.2,
    speed: 2.4,
    sight: 4,
    cost: { gold: 75, wood: 0 },
    food: 1,
    time: 10,
    worker: true,
    hotkey: 'P',
    desc: 'Gathers gold and lumber and constructs buildings.',
  },
  footman: {
    name: 'Footman',
    hp: 60,
    armor: 2,
    damage: 6,
    pierce: 3,
    range: 1,
    cooldown: 1.0,
    speed: 2.2,
    sight: 4,
    cost: { gold: 90, wood: 0 },
    food: 1,
    time: 14,
    requires: ['barracks'],
    hotkey: 'F',
    desc: 'Sturdy infantry armed with sword and shield.',
  },
  archer: {
    name: 'Archer',
    hp: 40,
    armor: 0,
    damage: 3,
    pierce: 6,
    range: 4,
    cooldown: 1.3,
    speed: 2.2,
    sight: 6,
    cost: { gold: 80, wood: 30 },
    food: 1,
    time: 15,
    projectile: 'arrow',
    requires: ['barracks', 'lumbermill'],
    hotkey: 'A',
    desc: 'Ranged attacker. Requires a Lumber Mill.',
  },
  knight: {
    name: 'Knight',
    hp: 100,
    armor: 4,
    damage: 8,
    pierce: 4,
    range: 1,
    cooldown: 1.0,
    speed: 3.4,
    sight: 5,
    cost: { gold: 160, wood: 40 },
    food: 1,
    time: 22,
    requires: ['barracks', 'blacksmith'],
    hotkey: 'K',
    desc: 'Fast, heavily armored cavalry. Requires a Blacksmith.',
  },
};

export const BUILDINGS = {
  townhall: {
    name: 'Town Hall',
    size: 4,
    hp: 1200,
    armor: 5,
    sight: 6,
    cost: { gold: 400, wood: 250 },
    time: 60,
    food: 5,
    depot: ['gold', 'wood'],
    trains: ['peasant'],
    hotkey: 'H',
    desc: 'Trains Peasants. Gold and lumber are delivered here.',
  },
  farm: {
    name: 'Farm',
    size: 2,
    hp: 400,
    armor: 3,
    sight: 3,
    cost: { gold: 80, wood: 30 },
    time: 18,
    food: 4,
    hotkey: 'F',
    desc: 'Provides food for 4 more units.',
  },
  barracks: {
    name: 'Barracks',
    size: 3,
    hp: 800,
    armor: 5,
    sight: 4,
    cost: { gold: 180, wood: 80 },
    time: 35,
    trains: ['footman', 'archer', 'knight'],
    hotkey: 'B',
    desc: 'Trains Footmen, Archers and Knights.',
  },
  lumbermill: {
    name: 'Lumber Mill',
    size: 3,
    hp: 600,
    armor: 5,
    sight: 4,
    cost: { gold: 150, wood: 60 },
    time: 30,
    depot: ['wood'],
    hotkey: 'L',
    desc: 'Lumber can be delivered here. Unlocks Archers and Guard Towers.',
  },
  blacksmith: {
    name: 'Blacksmith',
    size: 3,
    hp: 700,
    armor: 5,
    sight: 4,
    cost: { gold: 180, wood: 100 },
    time: 35,
    requires: ['barracks'],
    research: ['weapons', 'armor'],
    hotkey: 'S',
    desc: 'Researches upgrades. Unlocks Knights.',
  },
  tower: {
    name: 'Guard Tower',
    size: 2,
    hp: 500,
    armor: 8,
    sight: 7,
    cost: { gold: 120, wood: 80 },
    time: 30,
    requires: ['lumbermill'],
    attack: { damage: 4, pierce: 8, range: 6, cooldown: 1.6 },
    hotkey: 'T',
    desc: 'Defensive tower that fires bolts at nearby enemies.',
  },
  goldmine: {
    name: 'Gold Mine',
    size: 3,
    hp: 1,
    armor: 0,
    sight: 0,
    neutral: true,
    desc: 'Send Peasants here to mine gold.',
  },
};

// Order the build menu is shown in.
export const BUILD_MENU = ['farm', 'barracks', 'lumbermill', 'blacksmith', 'tower', 'townhall'];

export const RESEARCH = {
  weapons: {
    name: 'Forged Blades',
    hotkey: 'W',
    desc: '+2 damage for all military units.',
    levels: [
      { gold: 200, wood: 100, time: 40 },
      { gold: 400, wood: 200, time: 55 },
    ],
  },
  armor: {
    name: 'Reinforced Plate',
    hotkey: 'R',
    desc: '+2 armor for all military units.',
    levels: [
      { gold: 200, wood: 120, time: 40 },
      { gold: 400, wood: 240, time: 55 },
    ],
  },
};

export const DIFFICULTY = {
  easy: { label: 'Easy', think: 1.6, workers: 7, firstWave: 420, wave: 4, waveGrowth: 1, gatherBonus: 1.0 },
  normal: { label: 'Normal', think: 1.0, workers: 10, firstWave: 300, wave: 5, waveGrowth: 2, gatherBonus: 1.0 },
  hard: { label: 'Hard', think: 0.6, workers: 13, firstWave: 210, wave: 6, waveGrowth: 2, gatherBonus: 1.25 },
};

export const START_RESOURCES = { gold: 500, wood: 250 };
