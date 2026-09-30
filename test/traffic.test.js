import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignTraffic } from '../public/js/game/traffic.js';

function network(size, roads) {
  const roadCost = new Float32Array(size * size);
  const capacity = new Float32Array(size * size);
  for (const [x, y] of roads) {
    roadCost[y * size + x] = 1;
    capacity[y * size + x] = 100;
  }
  return { roadCost, capacity };
}

test('trips load every tile on the path between home and work', () => {
  const size = 10;
  const roads = [];
  for (let x = 0; x < 10; x++) roads.push([x, 5]);
  const { roadCost, capacity } = network(size, roads);
  const origins = new Map([[5 * size + 0, 50]]);
  const destinations = new Map([[5 * size + 9, 1]]);
  const { load, routed, unrouted } = assignTraffic({ size, roadCost, capacity, origins, destinations });
  for (let x = 0; x < 10; x++) assert.ok(Math.abs(load[5 * size + x] - 50) < 1e-6, `tile ${x} carries all 50 trips`);
  assert.ok(Math.abs(routed - 50) < 1e-6);
  assert.equal(unrouted, 0);
});

test('unreachable jobs leave trips unrouted', () => {
  const size = 10;
  const { roadCost, capacity } = network(size, [[0, 0], [1, 0], [8, 8], [9, 8]]);
  const { routed, unrouted } = assignTraffic({
    size,
    roadCost,
    capacity,
    origins: new Map([[0, 30]]),
    destinations: new Map([[8 * size + 9, 1]]),
  });
  assert.equal(routed, 0);
  assert.ok(Math.abs(unrouted - 30) < 1e-6);
});

test('a parallel street relieves a congested one', () => {
  const size = 12;
  // Two routes from (0,5) to (11,5): the direct street, and a slightly longer detour via row 7.
  const direct = [];
  for (let x = 0; x < 12; x++) direct.push([x, 5]);
  const detour = [[0, 6], [0, 7], [11, 6], [11, 7]];
  for (let x = 1; x < 11; x++) detour.push([x, 7]);
  const trips = 400; // 4x the capacity of one street
  const run = (roads) => {
    const { roadCost, capacity } = network(size, roads);
    return assignTraffic({ size, roadCost, capacity, origins: new Map([[5 * size, trips]]), destinations: new Map([[5 * size + 11, 1]]) }).load;
  };
  const single = run(direct);
  const both = run([...direct, ...detour]);
  const mid = 5 * size + 5;
  assert.ok(Math.abs(single[mid] - trips) < 1e-6);
  assert.ok(both[mid] < single[mid], 'some drivers take the detour');
  assert.ok(both[7 * size + 5] > 0, 'the detour carries traffic');
});
