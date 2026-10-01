// Talks to the game server's AI endpoints. If the server is missing (e.g. the
// game is hosted as static files) or fails, the same offline planner runs in
// the browser, so players never get stuck.

import { offlinePlan, offlineMissions, offlineBuilding } from './shared/offline.js';
import { sanitizePlan, sanitizeMissionBatch, sanitizeBuildingIdea } from './shared/plan.js';

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function postJson(url, body, { timeoutMs, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new RequestError(data.error || `Request failed (${res.status})`, res.status);
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

// Set once /api/status answers: false means static hosting, so requests go
// straight to the offline planner instead of waiting on a server that isn't there.
let hasServer = null;

export async function fetchStatus() {
  try {
    const res = await fetch('api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (typeof data?.ai !== 'boolean') throw new Error('Not the game server');
    hasServer = true;
    return { server: true, ai: data.ai, model: data.model || null };
  } catch {
    hasServer = false;
    return { server: false, ai: false, model: null };
  }
}

/** Static hosts can answer unknown routes with the HTML page; only trust real API answers. */
function expect(condition) {
  if (!condition) throw new Error('Unexpected response from the server');
}

const OFFLINE_NOTICE = 'Couldn’t reach the AI server, so the offline planner designed this city.';

export async function requestPlan(prompt, { signal } = {}) {
  if (hasServer === false) return { plan: offlinePlan(prompt), source: 'offline', notice: '' };
  try {
    const data = await postJson('api/plan', { prompt }, { timeoutMs: 150_000, signal });
    expect(data.plan && typeof data.plan === 'object');
    return { plan: sanitizePlan(data.plan, { prompt }), source: data.source === 'ai' ? 'ai' : 'offline', notice: data.notice || '' };
  } catch (err) {
    if (err instanceof RequestError && err.status === 400) throw err;
    return { plan: offlinePlan(prompt), source: 'offline', notice: signal?.aborted ? '' : OFFLINE_NOTICE };
  }
}

export async function requestMissions(context, { landmarkCount = 3 } = {}) {
  if (hasServer === false) return { ...offlineMissions(context), source: 'offline', notice: '' };
  try {
    const data = await postJson('api/missions', { context }, { timeoutMs: 90_000 });
    expect(Array.isArray(data.missions));
    return { ...sanitizeMissionBatch(data, { landmarkCount }), source: data.source === 'ai' ? 'ai' : 'offline', notice: data.notice || '' };
  } catch {
    return { ...offlineMissions(context), source: 'offline', notice: '' };
  }
}

export async function requestBuilding(idea, city) {
  if (hasServer === false) return { building: offlineBuilding(idea, city), source: 'offline', notice: '' };
  try {
    const data = await postJson('api/building', { idea, cityName: city.cityName, style: city.style }, { timeoutMs: 90_000 });
    expect(data.building && typeof data.building === 'object');
    return { building: sanitizeBuildingIdea(data.building), source: data.source === 'ai' ? 'ai' : 'offline', notice: data.notice || '' };
  } catch (err) {
    if (err instanceof RequestError && err.status === 400) throw err;
    return { building: offlineBuilding(idea, city), source: 'offline', notice: '' };
  }
}
