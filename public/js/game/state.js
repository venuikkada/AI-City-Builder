// Game state: map, terrain, money, missions. Pure data + functions so it runs
// the same in the browser and in Node tests.

import { hashString, Rng } from '../shared/rng.js';
import { buildDefs, INVENTABLE_ARCHETYPES, BONUSES } from '../shared/catalog.js';
import { sanitizePlan, sanitizeMission, sanitizeBuildingIdea, cleanText } from '../shared/plan.js';

export const SAVE_VERSION = 1;
export const MAP_SIZE = 40;
export const TERRAIN = { GRASS: 0, WATER: 1, FOREST: 2, SAND: 3 };
export const MAX_ACTIVE_MISSIONS = 4;

export const DIFFICULTIES = {
  relaxed: { label: 'Relaxed', money: 60000, upkeep: 0.7, growth: 1.25 },
  normal: { label: 'Normal', money: 30000, upkeep: 1, growth: 1 },
  hard: { label: 'Hard', money: 15000, upkeep: 1.25, growth: 0.85 },
};

const START_YEAR = { futuristic: 2080, cyberpunk: 2099 };
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateLabel(state) {
  return `${MONTH_NAMES[state.month % 12]} ${state.startYear + Math.floor(state.month / 12)}`;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0, 1]. */
function valueNoise(w, h, cell, rng) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const g = (xx, yy) => grid[yy * gw + xx];
      const top = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
      const bottom = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
      out[y * w + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** Terrain shaped by the plan: a lake (Hussain Sagar!), a river, a coastline or dry land. */
export function generateTerrain(size, terrainSpec, rng) {
  const { GRASS, WATER, FOREST, SAND } = TERRAIN;
  const t = new Uint8Array(size * size).fill(GRASS);
  const n1 = valueNoise(size, size, 6, rng);
  const n2 = valueNoise(size, size, 3, rng);
  const mid = Math.floor(size / 2);
  const idx = (x, y) => y * size + x;
  const blob = (cx, cy, r) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.15);
        if (d < r + (n2[idx(x, y)] - 0.5) * 3) t[idx(x, y)] = WATER;
      }
    }
  };

  switch (terrainSpec.water) {
    case 'lake': {
      const cx = rng.int(Math.floor(size * 0.35), Math.floor(size * 0.65));
      const cy = mid + (rng.chance(0.5) ? -1 : 1) * rng.int(5, 8);
      blob(cx, cy, rng.range(4.5, 6));
      if (rng.chance(0.5)) blob(rng.int(4, size - 5), rng.chance(0.5) ? rng.int(3, 8) : rng.int(size - 9, size - 4), rng.range(1.6, 2.6));
      break;
    }
    case 'river': {
      const base = rng.int(Math.floor(size * 0.3), Math.floor(size * 0.7));
      const phase = rng.range(0, Math.PI * 2);
      for (let y = 0; y < size; y++) {
        const xc = base + Math.sin(y / 5.5 + phase) * 3.5 + (n1[idx(base, y)] - 0.5) * 3;
        const width = 1.1 + n2[idx(base, y)] * 1.3;
        for (let x = 0; x < size; x++) if (Math.abs(x - xc) < width) t[idx(x, y)] = WATER;
      }
      break;
    }
    case 'coast': {
      for (let y = 0; y < size; y++) {
        const shore = size - 7 + Math.round((n1[idx(size - 6, y)] - 0.5) * 7);
        for (let x = Math.max(0, shore); x < size; x++) t[idx(x, y)] = WATER;
      }
      break;
    }
    default:
      if (rng.chance(0.6)) blob(rng.int(5, size - 6), rng.chance(0.5) ? rng.int(4, 12) : rng.int(size - 13, size - 5), rng.range(1.5, 2.4));
  }

  // Beaches along the shore (always on a coast, sometimes by lakes/rivers).
  const sandChance = terrainSpec.water === 'coast' ? 1 : 0.35;
  const sandWidth = terrainSpec.water === 'coast' ? 2 : 1;
  const isWater = (x, y) => x >= 0 && y >= 0 && x < size && y < size && t[idx(x, y)] === WATER;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (t[idx(x, y)] !== GRASS) continue;
      let near = false;
      for (let dy = -sandWidth; dy <= sandWidth && !near; dy++) {
        for (let dx = -sandWidth; dx <= sandWidth && !near; dx++) near = isWater(x + dx, y + dy);
      }
      if (near && (sandChance === 1 || n2[idx(x, y)] < sandChance)) t[idx(x, y)] = SAND;
    }
  }

  const threshold = { low: 0.78, medium: 0.68, high: 0.58 }[terrainSpec.greenery] ?? 0.68;
  for (let y = 0; y < size; y++) {
    if (Math.abs(y - mid) <= 1) continue; // keep the highway corridor clear
    for (let x = 0; x < size; x++) {
      const i = idx(x, y);
      if (t[i] === GRASS && n1[i] * 0.65 + n2[i] * 0.35 > threshold) t[i] = FOREST;
    }
  }
  return t;
}

export function refreshDefs(state) {
  state.defs = buildDefs(state.plan, state.custom);
  state.analysis = null;
}

/** New game from a (possibly raw) plan. */
export function createGame(rawPlan, { difficulty = 'normal' } = {}) {
  const plan = sanitizePlan(rawPlan);
  const seed = hashString(`${plan.prompt}|${plan.cityName}`);
  const rng = new Rng(seed);
  const size = MAP_SIZE;
  const terrain = generateTerrain(size, plan.terrain, rng);
  const tiles = new Array(size * size).fill(null);
  const row = Math.floor(size / 2);
  for (let x = 0; x < size; x++) {
    const i = row * size + x;
    tiles[i] = { d: 'highway', built: 0 };
    if (terrain[i] === TERRAIN.FOREST) terrain[i] = TERRAIN.GRASS;
  }
  const diff = DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const state = {
    version: SAVE_VERSION,
    plan,
    difficulty: diff,
    size,
    terrain,
    tiles,
    money: DIFFICULTIES[diff].money,
    taxRate: 9,
    month: 0,
    startYear: START_YEAR[plan.style] ?? 2030,
    maxPop: 0,
    rngState: rng.state,
    missions: plan.missions.map((m, i) => ({ ...m, status: i < 3 ? 'active' : 'queued', progress: 0 })),
    missionSeq: 0,
    custom: [],
    modifiers: [],
    lastEventMonth: -99,
    history: [],
    log: [{ month: 0, kind: 'advisor', text: plan.advisorIntro }],
    lastReport: null,
  };
  refreshDefs(state);
  return state;
}

export function addLog(state, kind, text) {
  state.log.push({ month: state.month, kind, text });
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
}

/** Adds an AI-invented building to the toolbox; returns its definition id. */
export function addCustomBuilding(state, idea) {
  const clean = sanitizeBuildingIdea(idea);
  const id = `c${state.custom.length + 1}`;
  state.custom.push({ id, ...clean });
  if (state.custom.length > 12) state.custom.shift();
  refreshDefs(state);
  return id;
}

/** Adds advisor missions with ids that can't collide with earlier batches. */
export function addMissions(state, missions) {
  const added = [];
  const activeCount = () => state.missions.filter((m) => m.status === 'active').length;
  for (const m of missions) {
    state.missionSeq += 1;
    const mission = { ...m, id: `a${state.missionSeq}`, status: activeCount() < MAX_ACTIVE_MISSIONS ? 'active' : 'queued', progress: 0 };
    state.missions.push(mission);
    added.push(mission);
  }
  return added;
}

export function serializeGame(state) {
  const { defs, analysis, ...rest } = state;
  return JSON.stringify({ ...rest, terrain: Array.from(state.terrain) });
}

/** Restores a saved game, validating everything that came from storage. */
export function deserializeGame(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.version !== SAVE_VERSION) throw new Error('Unsupported save version');
  const size = data.size === MAP_SIZE ? MAP_SIZE : null;
  if (!size || !Array.isArray(data.terrain) || data.terrain.length !== size * size) throw new Error('Corrupt map');
  if (!Array.isArray(data.tiles) || data.tiles.length !== size * size) throw new Error('Corrupt map');
  const plan = sanitizePlan(data.plan);
  const custom = (Array.isArray(data.custom) ? data.custom : [])
    .filter((c) => c && /^c\d+$/.test(c.id))
    .map((c) => ({ id: c.id, ...sanitizeBuildingIdea(c) }))
    .filter((c) => INVENTABLE_ARCHETYPES.includes(c.archetype) && BONUSES[c.bonus]);
  const defs = buildDefs(plan, custom);
  const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const tiles = data.tiles.map((t) => {
    if (!t || typeof t !== 'object' || !defs[t.d]) return null;
    const tile = { d: t.d, built: num(t.built, 0, 1e6, 0) };
    if (defs[t.d].residents) tile.occ = Math.round(num(t.occ, 0, defs[t.d].residents, 0));
    return tile;
  });
  const statuses = new Set(['active', 'queued', 'done']);
  const missions = (Array.isArray(data.missions) ? data.missions : [])
    .map((m, i) => {
      const clean = sanitizeMission(m, i, { landmarkCount: plan.landmarks.length });
      if (!clean) return null;
      return {
        ...clean,
        id: /^[am]\d+x?$/.test(m.id) ? m.id : clean.id,
        status: statuses.has(m.status) ? m.status : 'queued',
        progress: num(m.progress, 0, 1, 0),
        ...(Number.isFinite(m.completedMonth) ? { completedMonth: m.completedMonth } : {}),
      };
    })
    .filter(Boolean);
  const state = {
    version: SAVE_VERSION,
    plan,
    difficulty: DIFFICULTIES[data.difficulty] ? data.difficulty : 'normal',
    size,
    terrain: Uint8Array.from(data.terrain, (v) => (v >= 0 && v <= 3 ? v : 0)),
    tiles,
    money: num(data.money, -1e9, 1e10, 0),
    taxRate: Math.round(num(data.taxRate, 0, 20, 9)),
    month: Math.round(num(data.month, 0, 1e6, 0)),
    startYear: Math.round(num(data.startYear, 1900, 3000, 2030)),
    maxPop: num(data.maxPop, 0, 1e8, 0),
    rngState: num(data.rngState, 0, 4294967295, 1) >>> 0,
    missions,
    missionSeq: Math.round(num(data.missionSeq, 0, 1e6, 0)),
    custom,
    modifiers: (Array.isArray(data.modifiers) ? data.modifiers : [])
      .filter((m) => m && ['happiness', 'growth', 'traffic'].includes(m.kind))
      .map((m) => ({ kind: m.kind, value: num(m.value, -50, 50, 0), until: num(m.until, 0, 1e6, 0) })),
    lastEventMonth: num(data.lastEventMonth, -99, 1e6, -99),
    history: (Array.isArray(data.history) ? data.history : []).slice(-240).filter((h) => h && Number.isFinite(h.m)),
    log: (Array.isArray(data.log) ? data.log : [])
      .slice(-60)
      .map((e) => ({ month: num(e?.month, 0, 1e6, 0), kind: cleanText(e?.kind, 12, 'info'), text: cleanText(e?.text, 400, '') }))
      .filter((e) => e.text),
    lastReport:
      data.lastReport && typeof data.lastReport === 'object'
        ? Object.fromEntries(
            ['month', 'resTax', 'bizTax', 'tourism', 'income', 'upkeep', 'net'].map((k) => [k, num(data.lastReport[k], -1e9, 1e9, 0)]),
          )
        : null,
  };
  refreshDefs(state);
  return state;
}
