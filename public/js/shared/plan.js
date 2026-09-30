// Validation for AI-generated content. Whatever the model (or a hand-edited
// save) returns, these functions produce a complete, balanced, display-safe
// plan. They are idempotent: sanitizing a sanitized plan returns the same plan.

import { ARCHETYPES, THEMED_ARCHETYPES, INVENTABLE_ARCHETYPES, LANDMARK_EFFECTS, BONUSES } from './catalog.js';

export const STYLES = ['futuristic', 'cyberpunk', 'green', 'heritage', 'coastal', 'desert', 'classic'];
export const WATER_TYPES = ['lake', 'river', 'coast', 'none'];
export const GREENERY_LEVELS = ['low', 'medium', 'high'];
export const EVENT_EFFECTS = ['money_bonus', 'money_cost', 'happiness_boost', 'happiness_drop', 'growth_boost', 'traffic_jam'];
export const BUILD_TARGETS = [...THEMED_ARCHETYPES, 'landmark'];

// cmp: how the metric is compared with the target. gate: minimum population
// before the objective counts, so an empty city can't win "low traffic".
export const OBJECTIVES = {
  population: { label: 'Population', min: 100, max: 100000, cmp: '>=' },
  jobs: { label: 'Jobs', min: 50, max: 80000, cmp: '>=' },
  money: { label: 'Treasury', min: 1000, max: 1000000, cmp: '>=', money: true },
  monthly_income: { label: 'Monthly profit', min: 100, max: 60000, cmp: '>=', money: true },
  happiness: { label: 'Happiness', unit: '%', min: 40, max: 95, cmp: '>=', gate: 300 },
  traffic_below: { label: 'Traffic congestion', unit: '%', min: 10, max: 90, cmp: '<=', gate: 800 },
  build: { label: 'Build', min: 1, max: 60, cmp: '>=' },
  transit_share: { label: 'Transit ridership', unit: '%', min: 5, max: 75, cmp: '>=', gate: 500 },
  employment: { label: 'Employment', unit: '%', min: 50, max: 99, cmp: '>=', gate: 300 },
};
export const OBJECTIVE_TYPES = Object.keys(OBJECTIVES);

export const LIMITS = {
  prompt: 300,
  cityName: 32,
  tagline: 90,
  vision: 420,
  name: 40,
  description: 200,
  title: 48,
  missionDescription: 200,
  advisorName: 32,
  advisorIntro: 360,
  advice: 320,
  missions: 8,
  landmarks: 3,
  events: 6,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const roundTo = (v, step) => Math.round(v / step) * step;

// Control characters, bidi overrides and zero-width characters.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** Coerces to a short, single-line, markup-free string. */
export function cleanText(value, max, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  let s = String(value).replace(UNSAFE_CHARS, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return fallback;
  const chars = Array.from(s);
  if (chars.length > max) {
    let cut = chars.slice(0, max - 1).join('');
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > max * 0.6) cut = cut.slice(0, lastSpace);
    s = cut.replace(/[\s.,;:!-]+$/, '') + '…';
  }
  return s;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** Returns the first emoji of `value`, or `fallback` if it has none. */
export function cleanIcon(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s || !PICTOGRAPHIC.test(s)) return fallback;
  const first = segmenter ? segmenter.segment(s)[Symbol.iterator]().next().value?.segment : Array.from(s)[0];
  if (!first || !PICTOGRAPHIC.test(first) || /[A-Za-z0-9<>]/.test(first) || first.length > 16) return fallback;
  return first;
}

function toNumber(value, fallback) {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

/** A sensible reward for a mission, used to keep AI rewards in proportion. */
export function suggestedReward(m) {
  const cost = ARCHETYPES[m.archetype]?.cost ?? 6000;
  const byType = {
    population: m.target * 0.6,
    jobs: m.target * 0.8,
    money: m.target * 0.15,
    monthly_income: m.target * 4,
    happiness: 1500 + m.minPopulation * 0.3,
    traffic_below: 2000 + m.minPopulation * 0.5,
    build: 500 + cost * m.target * 0.5,
    transit_share: 1500 + m.target * 60,
    employment: 1000 + m.minPopulation * 0.3,
  };
  return clamp(roundTo(byType[m.objective] ?? 1000, 50), 300, 25000);
}

function niceTarget(objective, target) {
  if (['happiness', 'traffic_below', 'transit_share', 'employment', 'build'].includes(objective)) return Math.round(target);
  if (target >= 10000) return roundTo(target, 500);
  if (target >= 1000) return roundTo(target, 50);
  return roundTo(target, 10);
}

/** Sanitizes one mission; returns null when it can't be made playable. */
export function sanitizeMission(raw, index = 0, { landmarkCount = 3 } = {}) {
  if (!isObject(raw)) return null;
  const objective = pickEnum(raw.objective, OBJECTIVE_TYPES, null);
  if (!objective) return null;
  const spec = OBJECTIVES[objective];

  let archetype = 'none';
  if (objective === 'build') {
    archetype = pickEnum(raw.archetype, BUILD_TARGETS, null);
    if (!archetype) return null;
    if (archetype === 'landmark' && landmarkCount < 1) return null;
  }

  let target = toNumber(raw.target, NaN);
  if (!Number.isFinite(target)) return null;
  // Percent objectives are sometimes given as fractions (0.4 instead of 40).
  if (spec.unit === '%' && target > 0 && target <= 1) target *= 100;
  let maxTarget = spec.max;
  if (archetype === 'landmark') maxTarget = Math.max(1, landmarkCount);
  target = niceTarget(objective, clamp(target, spec.min, maxTarget));

  let minPopulation = clamp(Math.round(toNumber(raw.minPopulation, 0)), 0, 60000);
  if (spec.gate) minPopulation = Math.max(minPopulation, spec.gate);

  const mission = {
    id: cleanText(raw.id, 24, '') || `m${index + 1}`,
    title: cleanText(raw.title, LIMITS.title, `${spec.label} goal`),
    description: cleanText(raw.description, LIMITS.missionDescription, ''),
    objective,
    target,
    archetype,
    minPopulation,
    reward: 0,
  };
  const suggested = suggestedReward(mission);
  const reward = toNumber(raw.reward, suggested);
  mission.reward = clamp(roundTo(clamp(reward, suggested * 0.5, suggested * 2), 50), 250, 25000);
  return mission;
}

function missionKey(m) {
  return `${m.objective}:${m.archetype}:${m.target}`;
}

export function sanitizeMissions(list, { landmarkCount = 3, max = LIMITS.missions, idPrefix = 'm' } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const m = sanitizeMission(raw, out.length, { landmarkCount });
    if (!m || seen.has(missionKey(m))) continue;
    seen.add(missionKey(m));
    if (!/^[\w-]+$/.test(m.id) || !m.id.startsWith(idPrefix)) m.id = `${idPrefix}${out.length + 1}`;
    out.push(m);
    if (out.length >= max) break;
  }
  // Ids must be unique inside a batch even if the model repeated one.
  const ids = new Set();
  out.forEach((m, i) => {
    if (ids.has(m.id)) m.id = `${idPrefix}${i + 1}x`;
    ids.add(m.id);
  });
  return out;
}

export function sanitizeLandmarks(list) {
  const out = [];
  const names = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isObject(raw)) continue;
    const name = cleanText(raw.name, LIMITS.name, '');
    if (!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    out.push({
      name,
      description: cleanText(raw.description, LIMITS.description, ''),
      icon: cleanIcon(raw.icon, '🏛️'),
      effect: pickEnum(raw.effect, LANDMARK_EFFECTS, 'tourism'),
      unlockPopulation: roundTo(clamp(toNumber(raw.unlockPopulation, 1000), 0, 40000), 50),
    });
    if (out.length >= LIMITS.landmarks) break;
  }
  out.sort((a, b) => a.unlockPopulation - b.unlockPopulation);
  return out.map((lm, i) => ({ id: `L${i + 1}`, ...lm }));
}

export function sanitizeEvents(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isObject(raw)) continue;
    const title = cleanText(raw.title, LIMITS.title, '');
    const effect = pickEnum(raw.effect, EVENT_EFFECTS, null);
    if (!title || !effect) continue;
    out.push({
      title,
      description: cleanText(raw.description, LIMITS.description, ''),
      effect,
      magnitude: clamp(Math.round(toNumber(raw.magnitude, 1)), 1, 3),
    });
    if (out.length >= LIMITS.events) break;
  }
  return out;
}

/** Themed names per archetype, from either the AI shape (`buildings` array) or a saved plan (`names`). */
function sanitizeNames(raw) {
  const source = {};
  if (isObject(raw.names)) Object.assign(source, raw.names);
  if (Array.isArray(raw.buildings)) {
    for (const b of raw.buildings) {
      if (!isObject(b)) continue;
      const id = pickEnum(b.archetype, THEMED_ARCHETYPES, null);
      if (id && !source[id]) source[id] = b;
    }
  }
  const names = {};
  for (const id of THEMED_ARCHETYPES) {
    const base = ARCHETYPES[id];
    const b = isObject(source[id]) ? source[id] : {};
    names[id] = {
      name: cleanText(b.name, LIMITS.name, base.label),
      description: cleanText(b.description, LIMITS.description, base.blurb || ''),
      icon: cleanIcon(b.icon, base.icon),
    };
  }
  return names;
}

function sanitizeCurrency(value) {
  const s = cleanText(value, 4, '').replace(/[\s0-9]/g, '');
  return s || '$';
}

export function sanitizePlan(raw, { prompt } = {}) {
  const r = isObject(raw) ? raw : {};
  const terrain = isObject(r.terrain) ? r.terrain : {};
  const landmarks = sanitizeLandmarks(r.landmarks);
  if (!landmarks.length) {
    landmarks.push({
      id: 'L1',
      name: 'Grand Civic Tower',
      description: 'A shining symbol of your city that draws visitors from afar.',
      icon: '🏛️',
      effect: 'tourism',
      unlockPopulation: 1500,
    });
  }
  let missions = sanitizeMissions(r.missions, { landmarkCount: landmarks.length });
  if (missions.length < 3) {
    missions = sanitizeMissions([...missions, ...DEFAULT_MISSIONS], { landmarkCount: landmarks.length });
  }
  return {
    version: 1,
    prompt: cleanText(prompt ?? r.prompt, LIMITS.prompt, ''),
    cityName: cleanText(r.cityName, LIMITS.cityName, 'New City'),
    tagline: cleanText(r.tagline, LIMITS.tagline, 'A city built from a single idea.'),
    vision: cleanText(r.vision, LIMITS.vision, ''),
    style: pickEnum(r.style, STYLES, 'classic'),
    currency: sanitizeCurrency(r.currency),
    terrain: {
      water: pickEnum(terrain.water, WATER_TYPES, 'none'),
      greenery: pickEnum(terrain.greenery, GREENERY_LEVELS, 'medium'),
    },
    highwayName: cleanText(r.highwayName, LIMITS.name, 'Regional Highway'),
    names: sanitizeNames(r),
    landmarks,
    missions,
    events: sanitizeEvents(r.events),
    advisorName: cleanText(r.advisorName, LIMITS.advisorName, 'City Advisor'),
    advisorIntro: cleanText(r.advisorIntro, LIMITS.advisorIntro, 'Welcome, Mayor! Start by laying streets off the highway, then add homes and jobs.'),
    source: pickEnum(r.source, ['ai', 'offline'], 'offline'),
  };
}

export const DEFAULT_MISSIONS = [
  { title: 'First Neighbours', description: 'Attract your first residents.', objective: 'population', target: 300, archetype: 'none', minPopulation: 0 },
  { title: 'Get to Work', description: 'Give people places to work.', objective: 'jobs', target: 250, archetype: 'none', minPopulation: 0 },
  { title: 'Growing Town', description: 'Grow into a proper town.', objective: 'population', target: 1500, archetype: 'none', minPopulation: 0 },
  { title: 'Smooth Commutes', description: 'Keep traffic flowing as the town grows.', objective: 'traffic_below', target: 45, archetype: 'none', minPopulation: 1500 },
  { title: 'Big City Dreams', description: 'Become a real city.', objective: 'population', target: 5000, archetype: 'none', minPopulation: 0 },
];

/** Response of the "ask the advisor for new missions" call. */
export function sanitizeMissionBatch(raw, { landmarkCount = 3, idPrefix = 'a' } = {}) {
  const r = isObject(raw) ? raw : {};
  return {
    missions: sanitizeMissions(r.missions, { landmarkCount, max: 4, idPrefix }),
    advice: cleanText(r.advice, LIMITS.advice, ''),
  };
}

/** Response of the "invent a building" call. */
export function sanitizeBuildingIdea(raw) {
  const r = isObject(raw) ? raw : {};
  const archetype = pickEnum(r.archetype, INVENTABLE_ARCHETYPES, 'plaza');
  return {
    name: cleanText(r.name, LIMITS.name, 'Mystery Building'),
    description: cleanText(r.description, LIMITS.description, ''),
    icon: cleanIcon(r.icon, ARCHETYPES[archetype].icon),
    archetype,
    bonus: pickEnum(r.bonus, Object.keys(BONUSES), 'none'),
  };
}

const CONTEXT_NUMBERS = {
  month: [0, 100000],
  population: [0, 1e7],
  jobs: [0, 1e7],
  money: [-1e8, 1e9],
  net: [-1e7, 1e7],
  happiness: [0, 100],
  congestion: [0, 100],
  transitShare: [0, 100],
  employment: [0, 100],
  pollution: [0, 100],
  inactive: [0, 5000],
};

/** Whitelists the city snapshot the browser sends when asking for missions. */
export function sanitizeMissionContext(raw) {
  const r = isObject(raw) ? raw : {};
  const stats = {};
  const rs = isObject(r.stats) ? r.stats : {};
  for (const [key, [lo, hi]] of Object.entries(CONTEXT_NUMBERS)) {
    stats[key] = Math.round(clamp(toNumber(rs[key], 0), lo, hi));
  }
  const counts = {};
  const rc = isObject(r.counts) ? r.counts : {};
  for (const id of BUILD_TARGETS) counts[id] = Math.round(clamp(toNumber(rc[id], 0), 0, 5000));
  const titles = (list) =>
    (Array.isArray(list) ? list : []).slice(0, 12).map((t) => cleanText(t, LIMITS.title, '')).filter(Boolean);
  return {
    cityName: cleanText(r.cityName, LIMITS.cityName, 'the city'),
    style: pickEnum(r.style, STYLES, 'classic'),
    vision: cleanText(r.vision, LIMITS.vision, ''),
    landmarks: (Array.isArray(r.landmarks) ? r.landmarks : []).slice(0, 3).map((t) => cleanText(t, LIMITS.name, '')).filter(Boolean),
    stats,
    counts,
    completed: titles(r.completed),
    active: titles(r.active),
  };
}
