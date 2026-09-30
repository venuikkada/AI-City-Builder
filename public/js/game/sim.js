// The city simulation. `analyzeCity` derives everything visible about the city
// right now (connectivity, coverage, traffic, happiness, budget); `simulateMonth`
// advances time: people move in or out, money changes, missions and events fire.

import { Rng } from '../shared/rng.js';
import { THEMED_ARCHETYPES, milestoneFor } from '../shared/catalog.js';
import { DIFFICULTIES, addLog } from './state.js';
import { assignTraffic, ROAD_COST } from './traffic.js';
import { updateMissions } from './missions.js';

export const LABOR_SHARE = 0.55;
const RESIDENT_TAX = 4; // per resident per month at a 100% tax rate
// A road tile counts as jammed from 40% utilisation, fully gridlocked at 120%.
const JAM_START = 0.4;
const JAM_FULL = 1.2;
const BASE_SETTLERS = 150; // people who arrive before there are any jobs
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Share of a home's capacity people want to fill at a given happiness (60+ means full). */
export const desirability = (h) => clamp((h - 10) / 50, 0.2, 1);

export function activeModifiers(state) {
  const mod = { happiness: 0, growth: 1, traffic: 1 };
  for (const m of state.modifiers) {
    if (m.until <= state.month) continue;
    if (m.kind === 'happiness') mod.happiness += m.value;
    else if (m.kind === 'growth') mod.growth *= m.value;
    else if (m.kind === 'traffic') mod.traffic *= m.value;
  }
  return mod;
}

/** Visits every tile within `radius` of (cx, cy); `fn(index, falloff)` with falloff 1 at the centre. */
function stamp(size, cx, cy, radius, fn) {
  const r = Math.ceil(radius);
  for (let y = Math.max(0, cy - r); y <= Math.min(size - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(size - 1, cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) fn(y * size + x, 1 - d / (radius + 1));
    }
  }
}

export function analyzeCity(state) {
  const { size, tiles, defs } = state;
  const n = size * size;
  const mod = activeModifiers(state);
  const difficultyUpkeep = DIFFICULTIES[state.difficulty]?.upkeep ?? 1;

  // 1. Road network and what is connected to the highway.
  const roadCost = new Float32Array(n);
  const capacity = new Float32Array(n);
  const connected = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qt = 0;
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    const def = t && defs[t.d];
    if (def?.category !== 'road') continue;
    roadCost[i] = ROAD_COST[t.d] ?? 1;
    capacity[i] = def.capacity;
    if (t.d === 'highway') {
      connected[i] = 1;
      queue[qt++] = i;
    }
  }
  for (let qh = 0; qh < qt; qh++) {
    const v = queue[qh];
    const x = v % size;
    const visit = (w) => {
      if (roadCost[w] > 0 && !connected[w]) {
        connected[w] = 1;
        queue[qt++] = w;
      }
    };
    if (x > 0) visit(v - 1);
    if (x < size - 1) visit(v + 1);
    if (v >= size) visit(v - size);
    if (v + size < n) visit(v + size);
  }

  // 2. Buildings and their road access (best connected neighbouring road).
  const access = new Int32Array(n).fill(-1);
  const buildings = [];
  const counts = Object.fromEntries([...THEMED_ARCHETYPES, 'landmark'].map((id) => [id, 0]));
  let upkeep = 0;
  let roadTiles = 0;
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    if (!t) continue;
    const def = defs[t.d];
    if (!def) continue;
    upkeep += def.upkeep || 0;
    counts[def.archetype] = (counts[def.archetype] || 0) + 1;
    if (def.category === 'road') {
      roadTiles += 1;
      continue;
    }
    const x = i % size;
    const y = (i / size) | 0;
    let best = -1;
    const consider = (w) => {
      if (connected[w] && (best < 0 || capacity[w] > capacity[best])) best = w;
    };
    if (x > 0) consider(i - 1);
    if (x < size - 1) consider(i + 1);
    if (y > 0) consider(i - size);
    if (y < size - 1) consider(i + size);
    access[i] = best;
    // Parks are reached on foot; everything else needs a road to the highway.
    buildings.push({ i, x, y, def, tile: t, active: best >= 0 || def.category === 'park' });
  }

  // 3. Influence fields.
  const health = new Uint8Array(n);
  const safety = new Uint8Array(n);
  const education = new Uint8Array(n);
  const noTransit = new Float32Array(n).fill(1); // product of (1 - share) of covering stations
  const leisure = new Float32Array(n);
  const pollution = new Float32Array(n);
  const amenity = new Float32Array(n);
  const serviceFields = { health, safety, education };
  for (const b of buildings) {
    if (!b.active) continue;
    const def = b.def;
    if (def.service) {
      const field = serviceFields[def.service];
      stamp(size, b.x, b.y, def.radius, (j) => (field[j] = 1));
    }
    if (def.transit) stamp(size, b.x, b.y, def.radius, (j) => (noTransit[j] *= 1 - def.transit));
    if (def.happiness) stamp(size, b.x, b.y, def.radius || 3, (j, f) => (leisure[j] += def.happiness * f));
    if (def.pollution) stamp(size, b.x, b.y, def.pollutionRadius || 3, (j, f) => (pollution[j] += def.pollution * f));
    if (def.amenity) stamp(size, b.x, b.y, 3, (j) => (amenity[j] += def.amenity));
  }
  for (const b of buildings) {
    if (b.active && b.def.absorb) stamp(size, b.x, b.y, b.def.radius || 2, (j, f) => (pollution[j] -= b.def.absorb * f));
  }
  for (let i = 0; i < n; i++) if (pollution[i] < 0) pollution[i] = 0;

  // 4. Population and jobs.
  let population = 0;
  let housing = 0;
  let jobs = 0;
  let jobsNearTransit = 0;
  let inactive = 0;
  const residential = [];
  const workplaces = [];
  for (const b of buildings) {
    if (!b.active) inactive += 1;
    if (b.def.residents) {
      population += b.tile.occ || 0;
      if (b.active) housing += b.def.residents;
      residential.push(b);
    } else if (b.def.jobs && b.active) {
      jobs += b.def.jobs;
      if (noTransit[b.i] < 1) jobsNearTransit += b.def.jobs;
      workplaces.push(b);
    }
  }
  const labor = population * LABOR_SHARE;
  const employed = Math.min(labor, jobs);
  const employmentRate = labor > 0 ? employed / labor : 1;
  const fillRate = jobs > 0 ? employed / jobs : 0;
  const destinationCoverage = jobs > 0 ? jobsNearTransit / jobs : 0;

  // 5. Commutes: transit riders stay off the roads, drivers get routed.
  const origins = new Map();
  const destinations = new Map();
  let commuters = 0;
  let riders = 0;
  for (const b of residential) {
    if (!b.active || !b.tile.occ) continue;
    const c = b.tile.occ * LABOR_SHARE * employmentRate;
    const originShare = Math.min(0.75, 1 - noTransit[b.i]);
    const share = originShare * (0.4 + 0.6 * destinationCoverage);
    commuters += c;
    riders += c * share;
    const cars = c * (1 - share) * (b.def.trafficFactor ?? 1) * mod.traffic;
    origins.set(access[b.i], (origins.get(access[b.i]) || 0) + cars);
  }
  for (const b of workplaces) {
    destinations.set(access[b.i], (destinations.get(access[b.i]) || 0) + b.def.jobs * (b.def.trafficFactor ?? 1));
  }
  const { load } = assignTraffic({ size, roadCost, capacity, origins, destinations });
  let totalLoad = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    if (capacity[i] <= 0 || load[i] <= 0) continue;
    totalLoad += load[i];
    weighted += load[i] * clamp((load[i] / capacity[i] - JAM_START) / (JAM_FULL - JAM_START), 0, 1);
  }
  const congestion = totalLoad > 0 ? weighted / totalLoad : 0;
  const transitShare = commuters > 0 ? riders / commuters : 0;

  // 6. Happiness of each home.
  const taxEffect = clamp(-(state.taxRate - 8) * 2, -30, 8);
  const unemploymentPenalty = population > 50 ? (1 - employmentRate) * 25 : 0;
  const trafficPenalty = clamp((congestion - 0.3) * 30, 0, 15);
  const brokePenalty = state.money < 0 ? 10 : 0;
  const expectsServices = population > 800;
  const happinessTile = new Float32Array(n);
  let hSum = 0;
  let hWeight = 0;
  for (const b of residential) {
    const i = b.i;
    let h = 55 + taxEffect - unemploymentPenalty - trafficPenalty - brokePenalty + mod.happiness;
    h += health[i] ? 8 : expectsServices ? -4 : 0;
    h += safety[i] ? 8 : expectsServices ? -4 : 0;
    h += education[i] ? 8 : expectsServices ? -3 : 0;
    h += Math.min(25, leisure[i]);
    h += Math.min(6, amenity[i]);
    h += noTransit[i] < 1 ? 3 : 0;
    h -= Math.min(30, pollution[i] * 6);
    if (b.active) {
      const u = load[access[i]] / capacity[access[i]];
      if (u > 0.9) h -= Math.min(10, (u - 0.9) * 12);
    } else {
      h -= 20;
    }
    h = clamp(h, 0, 100);
    happinessTile[i] = h;
    const w = Math.max(b.tile.occ || 0, 1);
    hSum += h * w;
    hWeight += w;
  }
  const happiness = hWeight > 0 ? hSum / hWeight : 50;

  // 7. Budget for this month.
  const tax = state.taxRate / 100;
  const congestionDrag = 1 - 0.35 * clamp((congestion - 0.5) / 0.5, 0, 1);
  const resTax = population * tax * RESIDENT_TAX;
  let bizTax = 0;
  let tourism = 0;
  for (const b of workplaces) bizTax += b.def.jobs * fillRate * tax * (b.def.bizTax || 0) * congestionDrag;
  for (const b of buildings) {
    if (b.active && b.def.tourism) tourism += b.def.tourism * (0.5 + happiness / 200) * (1 + population / 25000);
  }
  const income = resTax + bizTax + tourism;
  // Bigger cities cost more to run (wages, maintenance crews, administration).
  upkeep *= difficultyUpkeep * (1 + population / 40000);

  // 8. Growth pressure: how many people the job market can support vs. housing.
  const supported = jobs / LABOR_SHARE * 1.1 + BASE_SETTLERS;
  let desirableHousing = 0;
  for (const b of residential) {
    if (b.active) desirableHousing += b.def.residents * desirability(happinessTile[b.i]);
  }
  const demand = {
    homes: clamp((supported - desirableHousing) / Math.max(200, desirableHousing), 0, 1),
    jobs: clamp((desirableHousing - supported) / Math.max(200, supported), 0, 1),
  };

  return {
    month: state.month,
    connected,
    access,
    capacity,
    load,
    health,
    safety,
    education,
    noTransit,
    leisure,
    pollution,
    happinessTile,
    population,
    housing,
    jobs,
    labor,
    employed,
    employmentRate,
    fillRate,
    congestion,
    transitShare,
    commuters,
    riders,
    happiness,
    inactive,
    roadTiles,
    counts,
    supported,
    desirableHousing,
    demand,
    budget: { resTax, bizTax, tourism, income, upkeep, net: income - upkeep },
    net: income - upkeep,
    milestone: milestoneFor(Math.max(state.maxPop, population)),
  };
}

/** Recomputes the analysis if the city changed since the last one. */
export function getAnalysis(state) {
  if (!state.analysis) state.analysis = analyzeCity(state);
  return state.analysis;
}

function applyEvent(state, event, population) {
  const mag = event.magnitude;
  const until = state.month + (event.effect === 'traffic_jam' ? 3 : 6);
  let effect;
  switch (event.effect) {
    case 'money_bonus': {
      const amount = Math.round(((800 + population * 0.6) * mag) / 50) * 50;
      state.money += amount;
      effect = `+${amount.toLocaleString('en-US')} to the treasury`;
      break;
    }
    case 'money_cost': {
      const amount = Math.round(((500 + population * 0.4) * mag) / 50) * 50;
      state.money -= amount;
      effect = `−${amount.toLocaleString('en-US')} from the treasury`;
      break;
    }
    case 'happiness_boost':
      state.modifiers.push({ kind: 'happiness', value: 4 * mag, until });
      effect = `+${4 * mag} happiness for 6 months`;
      break;
    case 'happiness_drop':
      state.modifiers.push({ kind: 'happiness', value: -4 * mag, until: state.month + 4 });
      effect = `−${4 * mag} happiness for 4 months`;
      break;
    case 'growth_boost':
      state.modifiers.push({ kind: 'growth', value: 1 + 0.25 * mag, until });
      effect = 'People are flocking in — faster growth for 6 months';
      break;
    case 'traffic_jam':
      state.modifiers.push({ kind: 'traffic', value: 1 + 0.2 * mag, until });
      effect = `${20 * mag}% more cars on the road for 3 months`;
      break;
    default:
      effect = '';
  }
  addLog(state, 'event', `${event.title}: ${effect}`);
  return { ...event, effectText: effect };
}

/** Advances the city by one month. Returns what happened, for toasts and the news feed. */
export function simulateMonth(state) {
  const a = analyzeCity(state);
  const growth = (DIFFICULTIES[state.difficulty]?.growth ?? 1) * activeModifiers(state).growth;
  const report = { completed: [], unlocked: [], events: [], milestone: null, warnings: [] };

  // People move towards the target occupancy of each home.
  const cityTarget = Math.min(a.desirableHousing, a.supported);
  const ratio = a.desirableHousing > 0 ? cityTarget / a.desirableHousing : 0;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    const def = t && state.defs[t.d];
    if (!def?.residents) continue;
    const active = a.access[i] >= 0;
    const target = active ? def.residents * desirability(a.happinessTile[i]) * ratio : 0;
    const occ = t.occ || 0;
    if (target > occ) t.occ = Math.min(Math.round(target), occ + Math.max(1, Math.round((target - occ) * 0.2 * growth)));
    else if (target < occ) t.occ = Math.max(Math.round(target), occ - Math.max(1, Math.round((occ - target) * 0.12)));
  }

  // Money.
  state.money += a.budget.net;
  state.lastReport = { month: state.month, ...a.budget };

  // Time passes; everything below sees the new month.
  state.month += 1;
  state.modifiers = state.modifiers.filter((m) => m.until > state.month);
  state.analysis = null;
  const after = getAnalysis(state);

  const previousMax = state.maxPop;
  state.maxPop = Math.max(state.maxPop, after.population);
  for (const def of Object.values(state.defs)) {
    if (def.buildable === false || !def.unlock) continue;
    if (def.unlock > previousMax && def.unlock <= state.maxPop) {
      report.unlocked.push(def);
      addLog(state, 'unlock', `Unlocked: ${def.name}`);
    }
  }
  const oldMilestone = milestoneFor(previousMax);
  const newMilestone = milestoneFor(state.maxPop);
  if (newMilestone.pop > oldMilestone.pop) {
    report.milestone = newMilestone;
    addLog(state, 'milestone', `${state.plan.cityName} is now a ${newMilestone.title}!`);
  }

  report.completed = updateMissions(state, after);

  // Plan events: the AI's festivals, booms and monsoons.
  const rng = new Rng(state.rngState);
  if (state.plan.events.length && state.month >= 8 && state.month - state.lastEventMonth >= 10 && rng.chance(0.07)) {
    state.lastEventMonth = state.month;
    report.events.push(applyEvent(state, rng.pick(state.plan.events), after.population));
    state.analysis = null;
  }
  state.rngState = rng.state;

  if (state.money < 0 && state.month % 6 === 0) {
    report.warnings.push('The treasury is empty! Raise taxes a little or cut upkeep.');
    addLog(state, 'warning', 'The treasury is empty — construction is frozen until the books recover.');
  }

  const latest = getAnalysis(state);
  state.history.push({
    m: state.month,
    pop: latest.population,
    money: Math.round(state.money),
    happiness: Math.round(latest.happiness),
    congestion: Math.round(latest.congestion * 100),
    net: Math.round(a.budget.net),
  });
  if (state.history.length > 240) state.history.splice(0, state.history.length - 240);
  return report;
}
