// The living city behind the start, loading and plan screens: a fully built
// city from the offline planner, with traffic, drifting slowly. Picking an
// example (or typing a style like "cyberpunk") restyles it to match.

import { offlinePlan, detectStyle } from './shared/offline.js';
import { createGame, TERRAIN } from './game/state.js';
import { placeBuilding, linePath, applyMany } from './game/build.js';
import { getAnalysis } from './game/sim.js';
import { Renderer } from './render.js';

const DEFAULT_PROMPT = 'Build a futuristic Hyderabad.';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Deterministic showcase city: a street grid, three landmarks and mixed districts. */
export function createDemoCity(prompt = DEFAULT_PROMPT) {
  const g = createGame(offlinePlan(prompt));
  g.money = 1e9;
  g.maxPop = 1e6; // everything unlocked
  const S = g.size;
  for (let x = 4; x <= 34; x += 3) applyMany(g, linePath(x, 6, x, 34), x % 9 === 1 ? 'avenue' : 'road');
  for (let y = 6; y <= 34; y += 4) if (y !== 18 && y !== 22) applyMany(g, linePath(4, y, 34, y), 'road');
  const spots = [
    [12, 16],
    [21, 24],
    [27, 13],
  ];
  g.plan.landmarks.forEach((lm, i) => spots[i] && placeBuilding(g, ...spots[i], lm.id));
  for (let y = 5; y <= 35; y++) {
    for (let x = 3; x <= 35; x++) {
      const i = y * S + x;
      if (g.tiles[i] || g.terrain[i] === TERRAIN.WATER) continue;
      const r = (x * 7 + y * 13) % 23;
      let d;
      if (x < 13) d = r < 6 ? 'tower' : r < 14 ? 'apartment' : r < 19 ? 'house' : r < 21 ? 'park' : r === 21 ? 'school' : 'bus';
      else if (x < 25) d = r < 5 ? 'office' : r < 9 ? 'shop' : r < 13 ? 'apartment' : r < 16 ? 'tower' : r < 18 ? 'plaza' : r === 18 ? 'hospital' : r === 19 ? 'police' : r === 20 ? 'metro' : 'park';
      else d = r < 7 ? 'techpark' : r < 12 ? 'office' : r < 15 ? 'factory' : r < 18 ? 'park' : r === 18 ? 'metro' : 'shop';
      placeBuilding(g, x, y, d);
    }
  }
  for (const t of g.tiles) if (t && g.defs[t.d].residents) t.occ = Math.round(g.defs[t.d].residents * 0.85);
  g.analysis = null;
  return g;
}

export class BackgroundCity {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, { maxDpr: 1.5 });
    this.state = null;
    this.analysis = null;
    this.style = null;
    this.running = false;
    this.t = 0;
    this.last = 0;
    this.zoom = 1;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = this.frame.bind(this);
  }

  /** Restyles the city when a prompt names a different look ("cyberpunk", "green", …). */
  show(prompt) {
    const style = detectStyle(prompt || '', null);
    if (this.state && (!style || style === this.style)) return;
    const build = () => {
      this.state = createDemoCity(style ? prompt : DEFAULT_PROMPT);
      this.style = this.state.plan.style;
      this.analysis = getAnalysis(this.state);
      this.renderer.attach(this.state);
      this.draw(0);
      this.canvas.style.opacity = '';
    };
    clearTimeout(this.swapTimer);
    if (!this.state) return build();
    this.canvas.style.opacity = '0';
    this.swapTimer = setTimeout(build, 280);
  }

  start() {
    if (this.running) return;
    if (!this.state) this.show(DEFAULT_PROMPT);
    this.resize();
    if (this.reduced) return; // one still frame is enough
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  setInsets(insets) {
    this.insets = insets;
    this.resize();
  }

  resize() {
    const r = this.renderer;
    r.resize();
    r.setInsets(this.insets);
    const w = r.width - r.insets.left - r.insets.right;
    const h = r.height - r.insets.top - r.insets.bottom;
    // Fill tall phone screens with city instead of showing the edge of the map.
    this.zoom = clamp(Math.max(w / 900, h / 1000), 0.55, 1.15);
    this.draw(0);
  }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = (now - this.last) / 1000;
    if (dt < 1 / 32) return; // a backdrop doesn't need 60 fps
    this.last = now;
    this.draw(Math.min(dt, 0.1));
  }

  draw(dt) {
    if (!this.state) return;
    const r = this.renderer;
    this.t += dt;
    const t = this.t;
    r.camera.x = Math.sin(t * 0.05) * 240;
    r.camera.y = 660 + Math.sin(t * 0.033) * 120;
    r.camera.zoom = this.zoom * (1 + 0.05 * Math.sin(t * 0.04));
    r.render(dt, this.analysis);
  }
}
