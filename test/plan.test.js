import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePlan,
  sanitizeMission,
  sanitizeMissionBatch,
  sanitizeBuildingIdea,
  sanitizeMissionContext,
  cleanText,
  cleanIcon,
} from '../public/js/shared/plan.js';
import { THEMED_ARCHETYPES } from '../public/js/shared/catalog.js';
import { offlinePlan } from '../public/js/shared/offline.js';

test('sanitizePlan turns garbage into a complete playable plan', () => {
  for (const raw of [null, undefined, 42, 'text', [], {}, { missions: 'nope', landmarks: {}, names: [] }]) {
    const plan = sanitizePlan(raw);
    assert.equal(typeof plan.cityName, 'string');
    assert.ok(plan.cityName.length > 0);
    assert.ok(plan.missions.length >= 3, 'falls back to default missions');
    assert.ok(plan.landmarks.length >= 1, 'always has a landmark');
    for (const id of THEMED_ARCHETYPES) assert.ok(plan.names[id].name, `name for ${id}`);
    assert.ok(['lake', 'river', 'coast', 'none'].includes(plan.terrain.water));
  }
});

test('sanitizePlan maps the AI buildings array onto archetype names', () => {
  const plan = sanitizePlan({
    cityName: 'Neo Hyderabad',
    style: 'FUTURISTIC',
    buildings: [
      { archetype: 'house', name: 'Deccan Smart Villas', description: 'Solar villas', icon: '🏡' },
      { archetype: 'spaceport', name: 'Nope' },
      { archetype: 'metro', name: 'Hyperloop', icon: 'not an emoji' },
    ],
  });
  assert.equal(plan.style, 'futuristic');
  assert.equal(plan.names.house.name, 'Deccan Smart Villas');
  assert.equal(plan.names.metro.name, 'Hyperloop');
  assert.equal(plan.names.metro.icon, '🚇', 'invalid icon falls back to default');
  assert.equal(plan.names.office.name, 'Offices', 'missing archetypes get defaults');
});

test('text is single-line, markup-free and length-limited', () => {
  assert.equal(cleanText('  <script>alert(1)</script>\n hi  ', 100), 'scriptalert(1)/script hi');
  assert.equal(cleanText('a\u202ebc', 10), 'a bc');
  const long = cleanText('word '.repeat(50), 20);
  assert.ok(Array.from(long).length <= 20);
  assert.ok(long.endsWith('…'));
  assert.equal(cleanText(undefined, 10, 'fallback'), 'fallback');
  assert.equal(cleanIcon('🏙️ city', '?'), '🏙️');
  assert.equal(cleanIcon('abc', '?'), '?');
});

test('missions are validated, clamped and gated', () => {
  assert.equal(sanitizeMission({ objective: 'conquer', target: 5 }), null);
  assert.equal(sanitizeMission({ objective: 'build', archetype: 'castle', target: 2 }), null);
  const pop = sanitizeMission({ objective: 'population', target: 99999999, reward: 1e9, title: 'Huge' });
  assert.equal(pop.target, 100000);
  assert.ok(pop.reward <= 25000);
  const traffic = sanitizeMission({ objective: 'traffic_below', target: 0.35, minPopulation: 0 });
  assert.equal(traffic.target, 35, 'fractions become percentages');
  assert.ok(traffic.minPopulation >= 800, 'low-traffic goals need a real city');
  const build = sanitizeMission({ objective: 'build', archetype: 'landmark', target: 9 }, 0, { landmarkCount: 2 });
  assert.equal(build.target, 2);
});

test('mission batches get unique ids with the requested prefix', () => {
  const batch = sanitizeMissionBatch({
    missions: [
      { objective: 'jobs', target: 500, id: 'x' },
      { objective: 'jobs', target: 500 },
      { objective: 'money', target: 10000 },
    ],
    advice: 'Build more offices',
  });
  assert.equal(batch.missions.length, 2, 'duplicates removed');
  assert.deepEqual(batch.missions.map((m) => m.id), ['a1', 'a2']);
  assert.equal(batch.advice, 'Build more offices');
});

test('building ideas fall back to safe defaults', () => {
  const idea = sanitizeBuildingIdea({ name: 'Flying Taxi Port', archetype: 'road', bonus: 'godlike' });
  assert.equal(idea.archetype, 'plaza', 'roads cannot be invented');
  assert.equal(idea.bonus, 'none');
  assert.equal(sanitizeBuildingIdea({ archetype: 'metro', bonus: 'smart' }).archetype, 'metro');
});

test('mission context is whitelisted and clamped', () => {
  const ctx = sanitizeMissionContext({
    cityName: 'X'.repeat(500),
    stats: { population: -5, congestion: 900, secret: 'drop me' },
    counts: { house: 3, evil: 7 },
    completed: ['a', 'b'],
  });
  assert.equal(ctx.stats.population, 0);
  assert.equal(ctx.stats.congestion, 100);
  assert.equal(ctx.stats.secret, undefined);
  assert.equal(ctx.counts.evil, undefined);
  assert.equal(ctx.counts.house, 3);
  assert.ok(ctx.cityName.length <= 32);
});

test('sanitizing is idempotent', () => {
  for (const prompt of ['Build a futuristic Hyderabad.', 'cyberpunk tokyo', 'a quiet green village']) {
    const plan = offlinePlan(prompt);
    assert.deepEqual(sanitizePlan(plan), plan);
  }
});
