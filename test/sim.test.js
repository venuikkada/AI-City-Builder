import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlinePlan } from '../public/js/shared/offline.js';
import { createGame, serializeGame, deserializeGame, addMissions, addCustomBuilding, TERRAIN, DIFFICULTIES } from '../public/js/game/state.js';
import { checkPlacement, placeBuilding, bulldoze, linePath, areaTiles, applyMany, undoBuild, BRIDGE_MULTIPLIER } from '../public/js/game/build.js';
import { simulateMonth, getAnalysis } from '../public/js/game/sim.js';
import { missionStatus } from '../public/js/game/missions.js';

const HIGHWAY_ROW = 20;

/** A game on flat, empty land so tests don't depend on generated terrain. */
function flatGame(prompt = 'Build a futuristic Hyderabad.', options) {
  const state = createGame(offlinePlan(prompt), options);
  state.terrain.fill(TERRAIN.GRASS);
  return state;
}

/** Street heading north from the highway at column x, with homes on the west side and shops on the east. */
function buildStrip(state, x, { homes = 8, shops = 4, homeType = 'house' } = {}) {
  applyMany(state, linePath(x, HIGHWAY_ROW - 1, x, HIGHWAY_ROW - 14), 'road');
  for (let i = 0; i < homes; i++) placeBuilding(state, x - 1, HIGHWAY_ROW - 1 - i, homeType);
  for (let i = 0; i < shops; i++) placeBuilding(state, x + 1, HIGHWAY_ROW - 1 - i, 'shop');
}

test('new games have a highway, money and three active missions', () => {
  const state = createGame(offlinePlan('Build a futuristic Hyderabad.'), { difficulty: 'hard' });
  for (let x = 0; x < state.size; x++) assert.equal(state.tiles[HIGHWAY_ROW * state.size + x].d, 'highway');
  assert.equal(state.money, DIFFICULTIES.hard.money);
  assert.equal(state.missions.filter((m) => m.status === 'active').length, 3);
  assert.equal(state.startYear, 2080, 'futuristic cities start in the future');
  assert.equal(state.defs.house.name, 'Deccan Smart Villas');
});

test('placement rules: water, forest, occupancy, unlocks and money', () => {
  const state = flatGame();
  state.terrain[5 * state.size + 5] = TERRAIN.WATER;
  assert.equal(checkPlacement(state, 5, 5, 'house').ok, false);
  const bridge = checkPlacement(state, 5, 5, 'road');
  assert.equal(bridge.ok, true);
  assert.equal(bridge.cost, state.defs.road.cost * BRIDGE_MULTIPLIER);

  state.terrain[6 * state.size + 6] = TERRAIN.FOREST;
  assert.ok(checkPlacement(state, 6, 6, 'house').cost > state.defs.house.cost, 'clearing trees costs extra');
  placeBuilding(state, 6, 6, 'house');
  assert.equal(state.terrain[6 * state.size + 6], TERRAIN.GRASS);
  assert.equal(checkPlacement(state, 6, 6, 'shop').reason, 'Occupied');

  const locked = checkPlacement(state, 1, 1, 'metro');
  assert.equal(locked.ok, false);
  assert.match(locked.reason, /Unlocks at/);

  state.money = 10;
  assert.equal(checkPlacement(state, 2, 2, 'house').reason, 'Not enough money');
  assert.equal(checkPlacement(state, -1, 2, 'road').ok, false);
});

test('streets can be upgraded to avenues once unlocked', () => {
  const state = flatGame();
  placeBuilding(state, 3, 3, 'road');
  assert.equal(checkPlacement(state, 3, 3, 'avenue').ok, false);
  state.maxPop = 1000;
  const upgrade = checkPlacement(state, 3, 3, 'avenue');
  assert.equal(upgrade.ok, true);
  assert.equal(upgrade.upgrade, true);
});

test('bulldozing protects the highway and refunds same-month mistakes', () => {
  const state = flatGame();
  assert.equal(bulldoze(state, 4, HIGHWAY_ROW).ok, false);
  const before = state.money;
  placeBuilding(state, 4, 4, 'house');
  const r = bulldoze(state, 4, 4);
  assert.equal(r.ok, true);
  assert.equal(state.money, before - state.defs.house.cost + Math.round(state.defs.house.cost * 0.5));
  assert.equal(state.tiles[4 * state.size + 4], null);
});

test('undo reverts the last build or clear, but only in the same month', () => {
  const state = flatGame();
  state.terrain[3 * state.size + 9] = TERRAIN.FOREST;
  const start = state.money;
  const road = applyMany(state, linePath(5, 3, 9, 3), 'road');
  assert.equal(road.count, 5);
  assert.equal(state.terrain[3 * state.size + 9], TERRAIN.GRASS, 'building clears the trees');
  assert.equal(undoBuild(state, road.undo), true);
  assert.equal(state.money, start);
  for (let x = 5; x <= 9; x++) assert.equal(state.tiles[3 * state.size + x], null);
  assert.equal(state.terrain[3 * state.size + 9], TERRAIN.FOREST, 'and undo brings them back');

  // Clearing refunds same-month builds; undoing the clear takes the refund back.
  applyMany(state, [[4, 4], [5, 4]], 'house');
  const afterHomes = state.money;
  const clear = applyMany(state, [[4, 4], [5, 4], [6, 4]], 'bulldoze');
  assert.equal(clear.count, 2);
  assert.ok(state.money > afterHomes);
  assert.equal(undoBuild(state, clear.undo), true);
  assert.equal(state.money, afterHomes);
  assert.equal(state.tiles[4 * state.size + 4].d, 'house');

  // Nothing built means nothing to undo, and undo expires when the month ends.
  assert.equal(applyMany(state, [[4, 4]], 'house').undo, null);
  const late = applyMany(state, [[8, 8]], 'shop');
  simulateMonth(state);
  assert.equal(undoBuild(state, late.undo), false);
  assert.equal(state.tiles[8 * state.size + 8].d, 'shop');
});

test('line and area helpers cover the dragged tiles', () => {
  assert.deepEqual(linePath(0, 0, 3, 1), [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]]);
  assert.deepEqual(linePath(2, 2, 2, 2), [[2, 2]]);
  assert.deepEqual(linePath(0, 0, 1, -3), [[0, 0], [0, -1], [0, -2], [0, -3], [1, -3]]);
  assert.equal(areaTiles(0, 0, 2, 1).length, 6);
  assert.equal(areaTiles(0, 0, 100, 100).length, 400, 'area is capped');
});

test('buildings need a road connected to the highway', () => {
  const state = flatGame();
  placeBuilding(state, 10, 5, 'house');
  placeBuilding(state, 11, 5, 'road'); // road island, not connected
  let a = getAnalysis(state);
  assert.equal(a.inactive, 1);
  applyMany(state, linePath(11, 6, 11, HIGHWAY_ROW - 1), 'road');
  a = getAnalysis(state);
  assert.equal(a.inactive, 0);
});

test('a connected neighbourhood grows, earns money and completes missions', () => {
  const state = flatGame();
  buildStrip(state, 10, { homes: 14, shops: 5 });
  placeBuilding(state, 12, HIGHWAY_ROW - 2, 'factory');
  placeBuilding(state, 12, HIGHWAY_ROW - 3, 'factory');
  const moneyAfterBuilding = state.money;
  let completed = [];
  for (let m = 0; m < 24; m++) completed = completed.concat(simulateMonth(state).completed);
  const a = getAnalysis(state);
  assert.ok(a.population >= 200, `population grew to ${a.population}`);
  assert.ok(a.jobs > 0);
  assert.ok(a.happiness > 40 && a.happiness <= 100);
  assert.ok(state.money > moneyAfterBuilding, 'taxes exceed upkeep');
  assert.equal(state.month, 24);
  assert.equal(state.history.length, 24);
  assert.ok(completed.some((m) => m.objective === 'population'), 'first population mission completes');
  assert.ok(state.maxPop >= a.population);
});

test('transit takes cars off the road', () => {
  const run = (withTransit) => {
    const state = flatGame();
    state.maxPop = 5000; // unlock everything
    state.money = 1e6;
    buildStrip(state, 8, { homes: 10, shops: 0, homeType: 'apartment' });
    buildStrip(state, 30, { homes: 0, shops: 0 });
    for (let i = 0; i < 8; i++) placeBuilding(state, 31, HIGHWAY_ROW - 1 - i, 'office');
    if (withTransit) {
      placeBuilding(state, 9, HIGHWAY_ROW - 4, 'metro');
      placeBuilding(state, 29, HIGHWAY_ROW - 4, 'metro');
    }
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i];
      if (t && state.defs[t.d].residents) t.occ = state.defs[t.d].residents;
    }
    state.analysis = null;
    return getAnalysis(state);
  };
  const cars = run(false);
  const transit = run(true);
  assert.ok(transit.transitShare > 0.3, `transit share ${transit.transitShare}`);
  const total = (a) => a.load.reduce((s, v) => s + v, 0);
  assert.ok(total(transit) < total(cars) * 0.75, 'fewer car trips on the network');
  assert.ok(transit.congestion <= cars.congestion);
});

test('factories pollute nearby homes and parks help', () => {
  const state = flatGame();
  buildStrip(state, 10, { homes: 6, shops: 0 });
  placeBuilding(state, 11, HIGHWAY_ROW - 2, 'factory');
  const polluted = getAnalysis(state).pollution[(HIGHWAY_ROW - 2) * state.size + 9];
  assert.ok(polluted > 0);
  placeBuilding(state, 8, HIGHWAY_ROW - 2, 'park');
  const cleaner = getAnalysis(state).pollution[(HIGHWAY_ROW - 2) * state.size + 9];
  assert.ok(cleaner < polluted);
});

test('traffic missions only count once the city is big enough', () => {
  const state = flatGame();
  const a = getAnalysis(state);
  const m = { objective: 'traffic_below', target: 40, minPopulation: 1500, archetype: 'none' };
  const s = missionStatus(state, a, m);
  assert.equal(s.met, false, 'an empty city does not win a traffic mission');
  assert.ok(s.progress < 0.5);
});

test('advisor missions and invented buildings join the game', () => {
  const state = flatGame();
  const added = addMissions(state, [{ id: 'a1', title: 'Jobs', objective: 'jobs', target: 100, archetype: 'none', minPopulation: 0, reward: 500 }]);
  assert.equal(added[0].id, 'a1');
  const again = addMissions(state, [{ id: 'a1', title: 'Jobs 2', objective: 'jobs', target: 200, archetype: 'none', minPopulation: 0, reward: 500 }]);
  assert.notEqual(again[0].id, added[0].id, 'ids stay unique across batches');

  const id = addCustomBuilding(state, { name: 'Biryani Palace', archetype: 'shop', bonus: 'dense', icon: '🍛' });
  const def = state.defs[id];
  assert.equal(def.name, 'Biryani Palace');
  assert.ok(def.jobs > state.defs.shop.jobs, 'dense bonus adds jobs');
  assert.equal(placeBuilding(state, 3, 3, id).ok, true);
});

test('save and load round-trips and the simulation continues identically', () => {
  const state = flatGame();
  buildStrip(state, 10, { homes: 8, shops: 4 });
  addCustomBuilding(state, { name: 'Holo Bazaar', archetype: 'shop', bonus: 'eco' });
  for (let m = 0; m < 6; m++) simulateMonth(state);
  const copy = deserializeGame(serializeGame(state));
  assert.equal(copy.plan.cityName, state.plan.cityName);
  assert.equal(copy.money, state.money);
  assert.deepEqual(Array.from(copy.terrain), Array.from(state.terrain));
  for (let m = 0; m < 6; m++) {
    simulateMonth(state);
    simulateMonth(copy);
  }
  assert.equal(copy.money, state.money);
  assert.equal(getAnalysis(copy).population, getAnalysis(state).population);
});

test('loading rejects corrupt saves and drops unknown buildings', () => {
  assert.throws(() => deserializeGame('{"version":99}'));
  assert.throws(() => deserializeGame({ version: 1, size: 40, terrain: [], tiles: [] }));
  const state = flatGame();
  const data = JSON.parse(serializeGame(state));
  data.tiles[0] = { d: 'death-star' };
  data.money = 'lots';
  const loaded = deserializeGame(data);
  assert.equal(loaded.tiles[0], null);
  assert.equal(loaded.money, 0);
});
