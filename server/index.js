// HTTP server: serves the game from /public and exposes three AI endpoints.
// With no API key (or when Claude is unavailable) every endpoint answers with
// the offline planner instead, so the game always works.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAi } from './ai.js';
import { offlinePlan, offlineMissions, offlineBuilding } from '../public/js/shared/offline.js';
import { cleanText, sanitizeMissionContext, STYLES, LIMITS } from '../public/js/shared/plan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY_BYTES = 32 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'",
};

/** Fixed-window limiter per client plus a whole-server daily cap to bound API spend. */
export function createRateLimiter({ windowMs = 15 * 60_000, max = 40, dailyMax = 2000, now = Date.now } = {}) {
  const hits = new Map();
  let day = Math.floor(now() / 86_400_000);
  let dayCount = 0;
  return {
    allow(key) {
      const t = now();
      const today = Math.floor(t / 86_400_000);
      if (today !== day) {
        day = today;
        dayCount = 0;
      }
      if (dayCount >= dailyMax) return false;
      let entry = hits.get(key);
      if (!entry || t >= entry.reset) {
        entry = { count: 0, reset: t + windowMs };
        hits.set(key, entry);
      }
      if (entry.count >= max) return false;
      entry.count += 1;
      dayCount += 1;
      if (hits.size > 10_000) {
        for (const [k, e] of hits) if (t >= e.reset) hits.delete(k);
      }
      return true;
    },
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

async function serveStatic(req, res, publicDir) {
  const { pathname } = new URL(req.url, 'http://localhost');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir + path.sep) || relative.includes('\0')) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return send(res, 200, req.method === 'HEAD' ? undefined : body, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  } catch {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

export function createAppServer({ ai = createAi(), publicDir = PUBLIC_DIR, limiter, env = process.env, logger = console } = {}) {
  const rateLimiter =
    limiter ||
    createRateLimiter({
      max: Number(env.AI_MAX_REQUESTS_PER_IP) || 40,
      dailyMax: Number(env.AI_MAX_REQUESTS_PER_DAY) || 2000,
    });
  const trustProxy = env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true';
  let warnedAboutProxy = false;

  const clientKey = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && !trustProxy && !warnedAboutProxy) {
      warnedAboutProxy = true;
      logger.warn('Requests arrive through a proxy. Set TRUST_PROXY=1 so AI rate limits apply per player, not to everyone at once.');
    }
    return (trustProxy && forwarded ? String(forwarded).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  };

  /** Runs the AI call when possible, otherwise (or on failure) the offline equivalent. */
  async function withFallback(req, kind, aiCall, offlineCall) {
    if (!ai.enabled) return { ...offlineCall(), source: 'offline' };
    if (!rateLimiter.allow(clientKey(req))) {
      return { ...offlineCall(), source: 'offline', notice: 'AI limit reached — the offline planner is filling in for a few minutes.' };
    }
    try {
      return { ...(await aiCall()), source: 'ai' };
    } catch (err) {
      logger.warn(`[ai] ${kind} failed: ${err.name}: ${err.message}`);
      const notice =
        err.name === 'AiRefusalError'
          ? 'The AI couldn’t work with that description, so the offline planner stepped in.'
          : 'The AI planner is unavailable right now, so the offline planner stepped in.';
      return { ...offlineCall(), source: 'offline', notice };
    }
  }

  const routes = {
    'GET /api/status': async () => ({ ai: ai.enabled, model: ai.enabled ? ai.model : null }),

    'POST /api/plan': async (req, body) => {
      const prompt = cleanText(body.prompt, LIMITS.prompt, '');
      if (!prompt) throw new HttpError(400, 'Describe the city you want to build');
      return withFallback(
        req,
        'plan',
        async () => ({ plan: await ai.plan(prompt) }),
        () => ({ plan: offlinePlan(prompt) }),
      );
    },

    'POST /api/missions': async (req, body) => {
      const context = sanitizeMissionContext(body.context);
      return withFallback(
        req,
        'missions',
        () => ai.missions(context),
        () => offlineMissions(context),
      );
    },

    'POST /api/building': async (req, body) => {
      const idea = cleanText(body.idea, 160, '');
      if (!idea) throw new HttpError(400, 'Describe the building you want');
      const city = {
        cityName: cleanText(body.cityName, LIMITS.cityName, 'the city'),
        style: STYLES.includes(body.style) ? body.style : 'classic',
      };
      return withFallback(
        req,
        'building',
        async () => ({ building: await ai.building(idea, city) }),
        () => ({ building: offlineBuilding(idea, city) }),
      );
    },
  };

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return serveStatic(req, res, publicDir);
    }
    const handler = routes[`${req.method} ${pathname}`];
    try {
      if (!handler) throw new HttpError(404, 'Unknown API route');
      const body = req.method === 'POST' ? await readJson(req) : {};
      sendJson(res, 200, await handler(req, body));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) logger.error(err);
      sendJson(res, status, { error: status === 500 ? 'Something went wrong' : err.message });
    }
    logger.info(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
  });
}
