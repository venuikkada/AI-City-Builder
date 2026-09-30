import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlinePlan, offlineMissions, offlineBuilding, detectStyle, extractPlaceName } from '../public/js/shared/offline.js';

test('"Build a futuristic Hyderabad" gets the Hyderabad flavour pack', () => {
  const plan = offlinePlan('Build a futuristic Hyderabad.');
  assert.equal(plan.cityName, 'Neo Hyderabad');
  assert.equal(plan.style, 'futuristic');
  assert.equal(plan.terrain.water, 'lake', 'Hussain Sagar');
  assert.equal(plan.currency, '₹');
  assert.equal(plan.highwayName, 'Outer Ring Road Hyperway');
  assert.ok(plan.landmarks.some((l) => l.name.includes('Charminar')));
  assert.equal(plan.names.techpark.name, 'Quantum HITEC Campus');
  assert.ok(plan.missions.length >= 6);
  assert.ok(plan.events.some((e) => e.title.includes('Biryani')));
});

test('offline plans are deterministic per prompt', () => {
  assert.deepEqual(offlinePlan('A green garden city'), offlinePlan('A green garden city'));
});

test('style detection prefers the first keyword', () => {
  assert.equal(detectStyle('A green car-free Amsterdam of 2080'), 'green');
  assert.equal(detectStyle('Cyberpunk Mumbai by the sea'), 'cyberpunk');
  assert.equal(detectStyle('nothing special'), 'classic');
  assert.equal(extractPlaceName('Build a solar Rivendell in the desert'), 'Rivendell');
});

test('coastal cities get a coastline, unknown places keep their name', () => {
  assert.equal(offlinePlan('Cyberpunk mumbai by the sea').terrain.water, 'coast');
  assert.match(offlinePlan('Build a heritage Rivendell').cityName, /Rivendell/);
});

test('offline advisor reacts to the city’s problems', () => {
  const batch = offlineMissions({
    cityName: 'Neo Hyderabad',
    stats: { population: 3000, congestion: 75, employment: 70, happiness: 50, net: -200, money: 1000, transitShare: 5 },
    counts: {},
  });
  assert.ok(batch.missions.length > 0 && batch.missions.length <= 3);
  assert.ok(batch.missions.some((m) => m.objective === 'traffic_below'));
  assert.match(batch.advice, /Traffic/);
});

test('offline inventor maps ideas to archetypes and bonuses', () => {
  assert.deepEqual(
    (({ archetype, bonus }) => ({ archetype, bonus }))(offlineBuilding('a solar powered hyperloop station')),
    { archetype: 'metro', bonus: 'eco' },
  );
  assert.equal(offlineBuilding('giant biryani food court').archetype, 'shop');
  assert.equal(offlineBuilding('quantum research lab').archetype, 'techpark');
});
