import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer, createRateLimiter } from '../server/index.js';
import { offlinePlan } from '../public/js/shared/offline.js';

const quiet = { info() {}, warn() {}, error() {} };
let publicDir;

before(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aicb-'));
  publicDir = path.join(root, 'public');
  await mkdir(path.join(publicDir, 'js'), { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>test</title>');
  await writeFile(path.join(publicDir, 'js', 'app.js'), 'console.log(1)');
  await writeFile(path.join(root, 'secret.txt'), 'top secret');
});

after(async () => {
  await rm(path.dirname(publicDir), { recursive: true, force: true });
});

async function withServer(options, fn) {
  const server = createAppServer({ publicDir, logger: quiet, env: {}, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, route, body) =>
  fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const offlineAi = { enabled: false, model: 'claude-opus-5-5' };

test('serves the game with security headers and blocks path traversal', async () => {
  await withServer({ ai: offlineAi }, async (base) => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    const js = await fetch(base + '/js/app.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    for (const evil of ['/../secret.txt', '/%2e%2e/secret.txt', '/js/../../secret.txt', '/%00']) {
      const r = await fetch(base + evil);
      assert.ok([400, 403, 404].includes(r.status), `${evil} -> ${r.status}`);
      assert.doesNotMatch(await r.text(), /top secret/);
    }
    assert.equal((await fetch(base + '/nope.js')).status, 404);
  });
});

test('without an API key every endpoint uses the offline planner', async () => {
  await withServer({ ai: offlineAi }, async (base) => {
    assert.deepEqual(await (await fetch(base + '/api/status')).json(), { ai: false, model: null });

    const plan = await (await post(base, '/api/plan', { prompt: 'Build a futuristic Hyderabad.' })).json();
    assert.equal(plan.source, 'offline');
    assert.equal(plan.plan.cityName, 'Neo Hyderabad');

    const missions = await (await post(base, '/api/missions', { context: { cityName: 'X', stats: { population: 2000, congestion: 80 } } })).json();
    assert.equal(missions.source, 'offline');
    assert.ok(missions.missions.length > 0);

    const building = await (await post(base, '/api/building', { idea: 'hyperloop station', cityName: 'X', style: 'futuristic' })).json();
    assert.equal(building.building.archetype, 'metro');
  });
});

test('bad requests get clear errors', async () => {
  await withServer({ ai: offlineAi }, async (base) => {
    assert.equal((await post(base, '/api/plan', { prompt: '   ' })).status, 400);
    assert.equal((await post(base, '/api/plan', '{not json')).status, 400);
    assert.equal((await post(base, '/api/plan', '[1,2]')).status, 400);
    assert.equal((await post(base, '/api/plan', { prompt: 'x'.repeat(40000) })).status, 413);
    assert.equal((await fetch(base + '/api/nope')).status, 404);
    assert.equal((await fetch(base + '/api/plan')).status, 404, 'GET on a POST route');
  });
});

test('AI results are used when available, with offline fallback on failure', async () => {
  const good = { enabled: true, model: 'm', plan: async (prompt) => ({ ...offlinePlan(prompt), source: 'ai', cityName: 'AI City' }) };
  await withServer({ ai: good }, async (base) => {
    const r = await (await post(base, '/api/plan', { prompt: 'a city' })).json();
    assert.equal(r.source, 'ai');
    assert.equal(r.plan.cityName, 'AI City');
  });

  const failing = {
    enabled: true,
    model: 'm',
    plan: async () => {
      throw Object.assign(new Error('declined'), { name: 'AiRefusalError' });
    },
  };
  await withServer({ ai: failing }, async (base) => {
    const r = await (await post(base, '/api/plan', { prompt: 'Build a futuristic Hyderabad.' })).json();
    assert.equal(r.source, 'offline');
    assert.match(r.notice, /offline planner/);
    assert.equal(r.plan.cityName, 'Neo Hyderabad');
  });
});

test('rate limiting falls back to offline instead of spending more', async () => {
  let calls = 0;
  const ai = { enabled: true, model: 'm', building: async () => (calls++, { name: 'AI Tower', archetype: 'tower', bonus: 'none', icon: '🏙️', description: '' }) };
  await withServer({ ai, limiter: createRateLimiter({ max: 2 }) }, async (base) => {
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await (await post(base, '/api/building', { idea: 'a tall tower' })).json());
    assert.deepEqual(results.map((r) => r.source), ['ai', 'ai', 'offline']);
    assert.equal(calls, 2);
  });
});

test('rate limiter resets per window and enforces a daily cap', () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, dailyMax: 3, now: () => now });
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('a'), false);
  now = 1500;
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('b'), false, 'daily cap reached');
});
