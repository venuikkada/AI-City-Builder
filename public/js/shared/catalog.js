// Balanced building archetypes. The AI re-themes these (names, descriptions,
// icons) and invents landmarks/custom variants, but gameplay numbers always
// come from here so every generated city stays playable.

export const CATEGORIES = {
  road: { label: 'Roads', icon: '🛣️' },
  residential: { label: 'Homes', icon: '🏠' },
  commercial: { label: 'Business', icon: '🏪' },
  industrial: { label: 'Industry & Tech', icon: '🏭' },
  service: { label: 'Services', icon: '🏥' },
  transit: { label: 'Transit', icon: '🚇' },
  park: { label: 'Parks', icon: '🌳' },
  landmark: { label: 'Landmarks', icon: '🏛️' },
};

// cost: build price · upkeep: monthly cost · unlock: population needed
// residents/jobs: capacity · bizTax: business tax weight per filled job
// happiness/radius: bonus to nearby homes · pollution/pollutionRadius: emissions
// absorb: pollution soaked up nearby · service: coverage type · transit: share of
// covered commuters who ride instead of drive · capacity: road throughput
export const ARCHETYPES = {
  road: {
    category: 'road', label: 'Street', noun: 'street', icon: '🛣️', cost: 15, upkeep: 0.3, capacity: 180, unlock: 0, drag: 'line',
    blurb: 'Connects buildings to the highway. Carries about 180 commuters.',
  },
  avenue: {
    category: 'road', label: 'Avenue', noun: 'avenue', icon: '🛤️', cost: 70, upkeep: 1.2, capacity: 520, unlock: 500, drag: 'line',
    blurb: 'Three times the capacity of a street. Build over streets to upgrade.',
  },
  highway: {
    category: 'road', label: 'Highway', noun: 'highway', icon: '🛣️', cost: 0, upkeep: 0, capacity: 1300, unlock: Infinity, buildable: false,
    blurb: 'Regional highway. Everything must connect to it.',
  },
  house: {
    category: 'residential', label: 'Homes', noun: 'home', icon: '🏡', cost: 120, upkeep: 0, residents: 30, unlock: 0, drag: 'area', height: 12,
    blurb: 'Low-density homes for 30 residents.',
  },
  apartment: {
    category: 'residential', label: 'Apartments', noun: 'apartment block', icon: '🏢', cost: 480, upkeep: 2, residents: 130, unlock: 400, height: 28,
    blurb: 'Mid-rise homes for 130 residents.',
  },
  tower: {
    category: 'residential', label: 'Sky Towers', noun: 'residential tower', icon: '🏙️', cost: 1700, upkeep: 8, residents: 420, unlock: 3000, height: 62,
    blurb: 'High-rise living for 420 residents. Plan transit nearby!',
  },
  shop: {
    category: 'commercial', label: 'Shops', noun: 'shop', icon: '🏪', cost: 180, upkeep: 0, jobs: 20, amenity: 4, bizTax: 6, unlock: 0,
    drag: 'area', height: 12, blurb: '20 jobs. Nearby homes enjoy the convenience.',
  },
  office: {
    category: 'commercial', label: 'Offices', noun: 'office block', icon: '🏬', cost: 850, upkeep: 4, jobs: 120, bizTax: 7, unlock: 600, height: 40,
    blurb: '120 clean, well-paid jobs.',
  },
  factory: {
    category: 'industrial', label: 'Factory', noun: 'factory', icon: '🏭', cost: 300, upkeep: 1, jobs: 60, bizTax: 5, pollution: 3,
    pollutionRadius: 4, unlock: 0, height: 18, blurb: '60 cheap jobs, but pollutes nearby homes.',
  },
  techpark: {
    category: 'industrial', label: 'Tech Park', noun: 'tech park', icon: '💻', cost: 2400, upkeep: 10, jobs: 360, bizTax: 8, pollution: 0.4,
    pollutionRadius: 2, unlock: 2500, height: 34, blurb: '360 high-value jobs with almost no pollution.',
  },
  school: {
    category: 'service', label: 'School', noun: 'school', icon: '🏫', cost: 800, upkeep: 30, jobs: 15, service: 'education', radius: 8,
    unlock: 200, height: 16, blurb: 'Education coverage keeps families happy.',
  },
  hospital: {
    category: 'service', label: 'Hospital', noun: 'hospital', icon: '🏥', cost: 950, upkeep: 40, jobs: 30, service: 'health', radius: 8,
    unlock: 300, height: 22, blurb: 'Health coverage for the neighbourhood.',
  },
  police: {
    category: 'service', label: 'Police', noun: 'police station', icon: '🚓', cost: 700, upkeep: 28, jobs: 15, service: 'safety', radius: 8,
    unlock: 300, height: 16, blurb: 'Safety coverage for the neighbourhood.',
  },
  park: {
    category: 'park', label: 'Park', noun: 'park', icon: '🌳', cost: 90, upkeep: 1, happiness: 8, radius: 3, absorb: 1.5, unlock: 0,
    drag: 'area', blurb: 'Boosts happiness and soaks up pollution.',
  },
  plaza: {
    category: 'park', label: 'Plaza', noun: 'plaza', icon: '⛲', cost: 450, upkeep: 6, happiness: 14, radius: 5, absorb: 1, unlock: 1500,
    blurb: 'A lively public square. Big happiness boost.',
  },
  bus: {
    category: 'transit', label: 'Bus Stop', noun: 'bus stop', icon: '🚌', cost: 160, upkeep: 5, transit: 0.25, radius: 4, unlock: 150,
    blurb: 'A quarter of nearby commuters leave the car at home.',
  },
  metro: {
    category: 'transit', label: 'Metro Station', noun: 'metro station', icon: '🚇', cost: 2600, upkeep: 50, jobs: 20, transit: 0.5, radius: 7,
    unlock: 2000, height: 20, blurb: 'Half of nearby commuters ride the metro. Put stations near homes and jobs.',
  },
};

/** Archetypes the AI may re-theme (everything the player can build). */
export const THEMED_ARCHETYPES = Object.keys(ARCHETYPES).filter((id) => ARCHETYPES[id].buildable !== false);

/** Archetypes a custom "invented" building can be based on. */
export const INVENTABLE_ARCHETYPES = THEMED_ARCHETYPES.filter((id) => ARCHETYPES[id].category !== 'road');

export const ROAD_TYPES = ['road', 'avenue', 'highway'];

export const LANDMARK_EFFECTS = ['tourism', 'happiness', 'transit', 'tech', 'green'];

export const BONUSES = {
  none: { label: 'Standard', blurb: 'Same stats as the base building.' },
  eco: { label: 'Eco', blurb: '70% less pollution and a small happiness bonus.' },
  efficient: { label: 'Efficient', blurb: '40% lower upkeep.' },
  dense: { label: 'Dense', blurb: '25% more residents or jobs, but costs more.' },
  iconic: { label: 'Iconic', blurb: 'Draws visitors and cheers up the neighbourhood.' },
  smart: { label: 'Smart', blurb: '20% fewer car trips thanks to smart mobility.' },
};

export const MILESTONES = [
  { pop: 0, title: 'Settlement' },
  { pop: 250, title: 'Village' },
  { pop: 1000, title: 'Town' },
  { pop: 4000, title: 'City' },
  { pop: 12000, title: 'Metropolis' },
  { pop: 30000, title: 'Megacity' },
];

export function milestoneFor(pop) {
  let current = MILESTONES[0];
  for (const m of MILESTONES) if (pop >= m.pop) current = m;
  return current;
}

export function nextMilestone(pop) {
  return MILESTONES.find((m) => m.pop > pop) || null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundTo = (v, step) => Math.round(v / step) * step;

/** Gameplay stats for a plan landmark; scales with how late it unlocks. */
export function landmarkStats(landmark) {
  const f = clamp((landmark.unlockPopulation || 0) / 20000, 0, 1);
  const stats = {
    category: 'landmark',
    cost: roundTo(5000 + 25000 * f, 500),
    upkeep: Math.round(15 + 45 * f),
    unlock: landmark.unlockPopulation || 0,
    happiness: 16,
    radius: 6,
    tourism: Math.round(120 + 600 * f),
    jobs: 40,
    bizTax: 5,
    height: 70,
    unique: true,
  };
  switch (landmark.effect) {
    case 'tourism':
      stats.tourism *= 2;
      break;
    case 'happiness':
      stats.happiness = 26;
      stats.radius = 8;
      break;
    case 'transit':
      stats.transit = 0.4;
      stats.radius = 9;
      break;
    case 'tech':
      stats.jobs += Math.round(300 + 900 * f);
      stats.bizTax = 8;
      break;
    case 'green':
      stats.absorb = 4;
      stats.happiness = 20;
      stats.radius = 7;
      break;
    default:
      break;
  }
  return stats;
}

/** Stats for an AI-invented building: a base archetype plus one bounded bonus. */
export function customStats(archetypeId, bonus) {
  const base = ARCHETYPES[archetypeId];
  const s = { ...base };
  delete s.drag;
  switch (bonus) {
    case 'eco':
      if (s.pollution) s.pollution *= 0.3;
      if (s.absorb) s.absorb *= 1.5;
      s.happiness = (s.happiness || 0) + 3;
      s.radius = s.radius || 2;
      s.cost = Math.round(s.cost * 1.15);
      break;
    case 'efficient':
      s.upkeep = +(s.upkeep * 0.6).toFixed(2);
      s.cost = Math.round(s.cost * 1.1);
      break;
    case 'dense':
      if (s.residents) s.residents = Math.round(s.residents * 1.25);
      if (s.jobs) s.jobs = Math.round(s.jobs * 1.25);
      if (s.happiness) s.happiness = Math.round(s.happiness * 1.25);
      if (s.height) s.height = Math.round(s.height * 1.3);
      s.cost = Math.round(s.cost * 1.3);
      break;
    case 'iconic':
      s.happiness = (s.happiness || 0) + 5;
      s.radius = Math.max(s.radius || 0, 3);
      s.tourism = (s.tourism || 0) + 40;
      s.cost = Math.round(s.cost * 1.25);
      break;
    case 'smart':
      s.trafficFactor = 0.8;
      s.cost = Math.round(s.cost * 1.2);
      break;
    default:
      break;
  }
  return s;
}

/**
 * Builds the definition table used by the game: one entry per buildable
 * archetype (with the plan's themed names), plus landmarks and custom buildings.
 * Tiles store a definition id (`tile.d`).
 */
export function buildDefs(plan, custom = []) {
  const defs = {};
  for (const [id, base] of Object.entries(ARCHETYPES)) {
    const themed = plan?.names?.[id];
    defs[id] = {
      ...base,
      id,
      archetype: id,
      name: themed?.name || base.label,
      description: themed?.description || base.blurb || '',
      icon: themed?.icon || base.icon,
    };
  }
  for (const lm of plan?.landmarks || []) {
    defs[lm.id] = {
      ...landmarkStats(lm),
      id: lm.id,
      archetype: 'landmark',
      effect: lm.effect,
      name: lm.name,
      description: lm.description,
      icon: lm.icon,
    };
  }
  for (const c of custom) {
    defs[c.id] = {
      ...customStats(c.archetype, c.bonus),
      id: c.id,
      archetype: c.archetype,
      bonus: c.bonus,
      custom: true,
      name: c.name,
      description: c.description,
      icon: c.icon,
    };
  }
  return defs;
}
