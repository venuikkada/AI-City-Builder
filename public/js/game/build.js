// Placement rules: what can go where, and what it costs.

import { TERRAIN } from './state.js';

export const BRIDGE_MULTIPLIER = 4;
export const CLEAR_TREES_COST = 10;
export const MAX_AREA_TILES = 400;

export function inBounds(state, x, y) {
  return x >= 0 && y >= 0 && x < state.size && y < state.size;
}

/** Checks whether `defId` can be built at (x, y). Always returns the cost so the UI can show it. */
export function checkPlacement(state, x, y, defId) {
  const def = state.defs[defId];
  if (!def || def.buildable === false) return { ok: false, reason: 'Not buildable', cost: 0 };
  if (!inBounds(state, x, y)) return { ok: false, reason: 'Outside the map', cost: 0 };
  const i = y * state.size + x;
  const tile = state.tiles[i];
  const terrain = state.terrain[i];
  let cost = def.cost;
  let upgrade = false;

  if (tile) {
    if (defId === 'avenue' && tile.d === 'road') upgrade = true;
    else return { ok: false, reason: tile.d === defId ? 'Already built here' : 'Occupied', cost };
  }
  if (terrain === TERRAIN.WATER) {
    if (def.category !== 'road') return { ok: false, reason: 'Only roads can bridge water', cost };
    if (!upgrade) cost *= BRIDGE_MULTIPLIER;
  }
  if (terrain === TERRAIN.FOREST) cost += CLEAR_TREES_COST;
  if ((def.unlock || 0) > state.maxPop) {
    return { ok: false, reason: `Unlocks at ${def.unlock.toLocaleString('en-US')} population`, cost, locked: true };
  }
  if (def.unique && state.tiles.some((t) => t && t.d === defId)) return { ok: false, reason: 'Already built', cost };
  if (state.money < cost) return { ok: false, reason: 'Not enough money', cost };
  return { ok: true, cost, upgrade };
}

export function placeBuilding(state, x, y, defId) {
  const check = checkPlacement(state, x, y, defId);
  if (!check.ok) return check;
  const i = y * state.size + x;
  const def = state.defs[defId];
  state.tiles[i] = { d: defId, built: state.month, ...(def.residents ? { occ: 0 } : {}) };
  if (state.terrain[i] === TERRAIN.FOREST) state.terrain[i] = TERRAIN.GRASS;
  state.money -= check.cost;
  state.analysis = null;
  return check;
}

export function checkBulldoze(state, x, y) {
  if (!inBounds(state, x, y)) return { ok: false, reason: 'Outside the map', cost: 0 };
  const i = y * state.size + x;
  const tile = state.tiles[i];
  if (!tile) {
    if (state.terrain[i] === TERRAIN.FOREST) {
      if (state.money < CLEAR_TREES_COST) return { ok: false, reason: 'Not enough money', cost: CLEAR_TREES_COST };
      return { ok: true, cost: CLEAR_TREES_COST, refund: 0 };
    }
    return { ok: false, reason: 'Nothing to clear', cost: 0 };
  }
  if (tile.d === 'highway') return { ok: false, reason: 'The highway can’t be removed', cost: 0 };
  const def = state.defs[tile.d];
  // Changed your mind in the same month? Get half the price back.
  const refund = tile.built === state.month && def ? Math.round(def.cost * 0.5) : 0;
  return { ok: true, cost: 0, refund };
}

export function bulldoze(state, x, y) {
  const check = checkBulldoze(state, x, y);
  if (!check.ok) return check;
  const i = y * state.size + x;
  if (state.tiles[i]) state.tiles[i] = null;
  else state.terrain[i] = TERRAIN.GRASS;
  state.money += check.refund - check.cost;
  state.analysis = null;
  return check;
}

/** Tiles on an L-shaped path (long leg first), like dragging a road in classic city builders. */
export function linePath(x0, y0, x1, y1) {
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  const out = [[x, y]];
  const walkX = () => {
    while (x !== x1) out.push([(x += stepX), y]);
  };
  const walkY = () => {
    while (y !== y1) out.push([x, (y += stepY)]);
  };
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    walkX();
    walkY();
  } else {
    walkY();
    walkX();
  }
  return out;
}

/** Tiles in the rectangle spanned by two corners (capped for sanity). */
export function areaTiles(x0, y0, x1, y1) {
  const out = [];
  const [xa, xb] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ya, yb] = y0 <= y1 ? [y0, y1] : [y1, y0];
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      out.push([x, y]);
      if (out.length >= MAX_AREA_TILES) return out;
    }
  }
  return out;
}

/** Previews a multi-tile action: how many tiles succeed and the total cost. */
export function previewMany(state, cells, defId) {
  let total = 0;
  let count = 0;
  let budget = state.money;
  const results = [];
  for (const [x, y] of cells) {
    const r = defId === 'bulldoze' ? checkBulldoze(state, x, y) : checkPlacement({ ...state, money: budget }, x, y, defId);
    results.push({ x, y, ...r });
    if (r.ok) {
      const net = (r.cost || 0) - (r.refund || 0);
      total += net;
      budget -= net;
      count += 1;
    }
  }
  return { results, total, count };
}

/**
 * Applies a tool to many tiles in order, stopping quietly where it can't build.
 * Also returns an `undo` record (see undoBuild) when anything changed.
 */
export function applyMany(state, cells, defId) {
  let spent = 0;
  let count = 0;
  let lastError = null;
  const changes = [];
  const moneyBefore = state.money;
  for (const [x, y] of cells) {
    if (!inBounds(state, x, y)) {
      lastError = 'Outside the map';
      continue;
    }
    const i = y * state.size + x;
    const before = { i, tile: state.tiles[i], terrain: state.terrain[i] };
    const r = defId === 'bulldoze' ? bulldoze(state, x, y) : placeBuilding(state, x, y, defId);
    if (r.ok) {
      spent += (r.cost || 0) - (r.refund || 0);
      count += 1;
      changes.push(before);
    } else {
      lastError = r.reason;
    }
  }
  const undo = count ? { month: state.month, changes, delta: state.money - moneyBefore } : null;
  return { spent, count, lastError, undo };
}

/**
 * Reverts an applyMany action. Only allowed in the same month, so undo can't be
 * used to collect a mission reward and then get the building's price back.
 */
export function undoBuild(state, undo) {
  if (!undo || undo.month !== state.month) return false;
  for (let k = undo.changes.length - 1; k >= 0; k--) {
    const { i, tile, terrain } = undo.changes[k];
    state.tiles[i] = tile;
    state.terrain[i] = terrain;
  }
  state.money -= undo.delta;
  state.analysis = null;
  return true;
}
