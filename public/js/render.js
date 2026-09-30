// Isometric canvas renderer. Everything is drawn procedurally in world units
// (a tile is 64x32); the camera transform handles panning and zoom.

import { TERRAIN } from './game/state.js';
import { paletteFor, shade, mix, rgba, hashColor } from './palettes.js';

export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;
const MAX_BUILDING_HEIGHT = 170;
const MAX_CARS = 260;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.6;
// India, UK, Japan and Singapore drive on the left.
const LEFT_HAND_CURRENCIES = new Set(['₹', '£', '¥', 'S$']);
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const tileHash = (x, y) => (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function diamond(ctx, wx, wy, grow = 0.6) {
  ctx.beginPath();
  ctx.moveTo(wx, wy - grow);
  ctx.lineTo(wx + HW + grow * 2, wy + HH);
  ctx.lineTo(wx, wy + TILE_H + grow);
  ctx.lineTo(wx - HW - grow * 2, wy + HH);
  ctx.closePath();
}

/** Box on a diamond footprint centred at (cx, cy) with half-extents hw/hh and height h. */
function prism(ctx, cx, cy, hw, hh, h, top, left, right) {
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(cx, cy + hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy + hh - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh - h);
  ctx.lineTo(cx + hw, cy - h);
  ctx.lineTo(cx, cy + hh - h);
  ctx.lineTo(cx - hw, cy - h);
  ctx.closePath();
  ctx.fill();
}

function pyramidRoof(ctx, cx, cy, hw, hh, baseH, roofH, color) {
  const apexY = cy - baseH - roofH;
  const faces = [
    [[cx - hw, cy - baseH], [cx, cy - hh - baseH], shade(color, 1.18)],
    [[cx, cy - hh - baseH], [cx + hw, cy - baseH], shade(color, 1.05)],
    [[cx - hw, cy - baseH], [cx, cy + hh - baseH], shade(color, 0.9)],
    [[cx, cy + hh - baseH], [cx + hw, cy - baseH], shade(color, 0.72)],
  ];
  for (const [a, b, fill] of faces) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(cx, apexY);
    ctx.closePath();
    ctx.fill();
  }
}

/** Window grid on both visible faces; `lit` is the share of lit windows. */
function windows(ctx, cx, cy, hw, hh, h, P, lit, seed, perFace = 3, floorH = 6.5) {
  const litPath = new Path2D();
  const offPath = new Path2D();
  let k = 0;
  for (let fy = 5; fy < h - 3; fy += floorH) {
    for (let side = 0; side < 2; side++) {
      const [ax, ay, bx, by] = side === 0 ? [cx - hw, cy, cx, cy + hh] : [cx, cy + hh, cx + hw, cy];
      for (let i = 0; i < perFace; i++) {
        const t = (i + 0.6) / (perFace + 0.2);
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t - fy;
        const on = ((Math.imul(seed + k * 2654435761, 2246822519) >>> 0) % 1000) / 1000 < lit;
        (on ? litPath : offPath).rect(px - 1.5, py - 2.6, 3, 2.6);
        k += 1;
      }
    }
  }
  ctx.fillStyle = P.windowOff;
  ctx.fill(offPath);
  ctx.fillStyle = P.window;
  ctx.fill(litPath);
}

function tree(ctx, x, y, s, color) {
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 0.9 * s, y - 3.5 * s, 1.8 * s, 3.5 * s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - 7 * s, 4.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(color, 1.25);
  ctx.beginPath();
  ctx.arc(x - 1.4 * s, y - 8.4 * s, 1.8 * s, 0, Math.PI * 2);
  ctx.fill();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.overlay = 'none';
    this.hover = null; // { x, y }
    this.ghost = null; // { def, ok }
    this.preview = null; // [{ x, y, ok }]
    this.radius = null; // { x, y, r }
    this.selected = null; // { x, y }
    this.time = 0;
    this.cars = [];
    this.carSource = null;
  }

  attach(state) {
    this.state = state;
    this.palette = paletteFor(state.plan.style);
    this.leftHand = LEFT_HAND_CURRENCIES.has(state.plan.currency);
    this.cars = [];
    this.carSource = null;
    this.fitToMap();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  fitToMap() {
    const size = this.state.size;
    this.camera.x = 0;
    this.camera.y = size * HH + 20;
    this.camera.zoom = clamp(Math.min(this.width / (size * TILE_W), this.height / (size * TILE_H + 120)) * 1.05, MIN_ZOOM, 1.2);
  }

  screenToWorld(sx, sy) {
    const z = this.camera.zoom;
    return [(sx - this.width / 2) / z + this.camera.x, (sy - this.height / 2) / z + this.camera.y];
  }

  worldToScreen(wx, wy) {
    const z = this.camera.zoom;
    return [(wx - this.camera.x) * z + this.width / 2, (wy - this.camera.y) * z + this.height / 2];
  }

  tileToScreen(x, y) {
    return this.worldToScreen((x - y) * HW, (x + y) * HH + HH);
  }

  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const u = wx / HW;
    const v = wy / HH;
    const x = Math.floor((u + v) / 2);
    const y = Math.floor((v - u) / 2);
    if (x < 0 || y < 0 || x >= this.state.size || y >= this.state.size) return null;
    return { x, y };
  }

  pan(dx, dy) {
    const z = this.camera.zoom;
    const size = this.state.size;
    this.camera.x = clamp(this.camera.x - dx / z, -size * HW, size * HW);
    this.camera.y = clamp(this.camera.y - dy / z, 0, size * TILE_H);
  }

  zoomAt(factor, sx, sy) {
    const [bx, by] = this.screenToWorld(sx, sy);
    this.camera.zoom = clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const [ax, ay] = this.screenToWorld(sx, sy);
    this.camera.x += bx - ax;
    this.camera.y += by - ay;
  }

  isRoad(i) {
    const t = this.state.tiles[i];
    return Boolean(t && this.state.defs[t.d]?.category === 'road');
  }

  render(dt, analysis) {
    const { ctx, state, palette: P, camera } = this;
    if (!state) return;
    this.time += dt;
    const z = camera.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, P.skyTop);
    sky.addColorStop(1, P.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.width / 2 - camera.x * z), this.dpr * (this.height / 2 - camera.y * z));

    const view = {
      left: camera.x - this.width / 2 / z - HW,
      right: camera.x + this.width / 2 / z + HW,
      top: camera.y - this.height / 2 / z - TILE_H,
      bottom: camera.y + this.height / 2 / z + MAX_BUILDING_HEIGHT,
    };
    const size = state.size;
    const visible = (x, y) => {
      const wx = (x - y) * HW;
      const wy = (x + y) * HH;
      return wx >= view.left && wx <= view.right && wy >= view.top && wy <= view.bottom;
    };

    this.drawSlab();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (visible(x, y)) this.drawGround(x, y, analysis);
    }
    this.drawGroundOverlays(analysis, visible);
    this.updateCars(dt, analysis);
    this.drawCars();

    const dimmed = this.overlay !== 'none' && this.overlay !== 'traffic';
    for (let d = 0; d <= 2 * (size - 1); d++) {
      for (let x = Math.max(0, d - size + 1); x <= Math.min(size - 1, d); x++) {
        const y = d - x;
        if (!visible(x, y)) continue;
        const i = y * size + x;
        const t = state.tiles[i];
        if (t) {
          const def = state.defs[t.d];
          if (def && def.category !== 'road') {
            ctx.globalAlpha = dimmed ? 0.35 : 1;
            this.drawBuilding(def, t, x, y, i, analysis);
            ctx.globalAlpha = 1;
          }
        } else if (state.terrain[i] === TERRAIN.FOREST) {
          ctx.globalAlpha = dimmed ? 0.35 : 1;
          this.drawForest(x, y);
          ctx.globalAlpha = 1;
        }
      }
    }
    this.drawMarkers(analysis, visible);
    this.drawGhost();
  }

  drawSlab() {
    const { ctx, state, palette: P } = this;
    const s = state.size;
    const depth = 14;
    const left = [-s * HW, s * HH];
    const bottom = [0, s * TILE_H];
    const right = [s * HW, s * HH];
    ctx.fillStyle = shade(P.slab, 0.95);
    ctx.beginPath();
    ctx.moveTo(left[0], left[1]);
    ctx.lineTo(bottom[0], bottom[1]);
    ctx.lineTo(bottom[0], bottom[1] + depth);
    ctx.lineTo(left[0], left[1] + depth);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(P.slab, 0.7);
    ctx.beginPath();
    ctx.moveTo(bottom[0], bottom[1]);
    ctx.lineTo(right[0], right[1]);
    ctx.lineTo(right[0], right[1] + depth);
    ctx.lineTo(bottom[0], bottom[1] + depth);
    ctx.closePath();
    ctx.fill();
  }

  drawGround(x, y, analysis) {
    const { ctx, state, palette: P } = this;
    const size = state.size;
    const i = y * size + x;
    const wx = (x - y) * HW;
    const wy = (x + y) * HH;
    const terrain = state.terrain[i];
    const tile = state.tiles[i];
    const def = tile && state.defs[tile.d];
    const h = tileHash(x, y);

    if (terrain === TERRAIN.WATER) {
      const wave = 0.5 + 0.5 * Math.sin(this.time * 1.4 + x * 0.7 + y * 0.45);
      ctx.fillStyle = mix(P.water[0], P.water[1], wave * 0.8);
    } else if (terrain === TERRAIN.SAND) {
      ctx.fillStyle = shade(P.sand, 0.97 + (h % 7) / 100);
    } else {
      ctx.fillStyle = P.grass[h % P.grass.length];
    }
    diamond(ctx, wx, wy);
    ctx.fill();

    if (def?.category === 'road') this.drawRoad(x, y, wx, wy, tile, terrain === TERRAIN.WATER, analysis);
    else if (def?.category === 'park') {
      ctx.fillStyle = shade(P.categories.park, tile.d === 'plaza' || def.archetype === 'plaza' ? 1.45 : 1);
      diamond(ctx, wx, wy, -2);
      ctx.fill();
    } else if (def) {
      ctx.fillStyle = rgba('#000000', 0.12);
      diamond(ctx, wx, wy, -3);
      ctx.fill();
    }
  }

  drawRoad(x, y, wx, wy, tile, bridge, analysis) {
    const { ctx, state, palette: P } = this;
    const size = state.size;
    const color = tile.d === 'highway' ? P.highway : tile.d === 'avenue' ? P.avenue : P.road;
    if (bridge) {
      ctx.fillStyle = rgba('#000000', 0.25);
      diamond(ctx, wx, wy + 4, -2);
      ctx.fill();
    }
    ctx.fillStyle = color;
    diamond(ctx, wx, wy, bridge ? -2 : 0.6);
    ctx.fill();

    const cx = wx;
    const cy = wy + HH;
    // Neighbours: [dx, dy, edge midpoint, edge endpoints]
    const edges = [
      [0, -1, wx + HW / 2, wy + HH / 2, [wx, wy], [wx + HW, wy + HH]],
      [1, 0, wx + HW / 2, wy + HH * 1.5, [wx + HW, wy + HH], [wx, wy + TILE_H]],
      [0, 1, wx - HW / 2, wy + HH * 1.5, [wx, wy + TILE_H], [wx - HW, wy + HH]],
      [-1, 0, wx - HW / 2, wy + HH / 2, [wx - HW, wy + HH], [wx, wy]],
    ];
    const links = [];
    ctx.lineWidth = bridge ? 1.6 : 1.1;
    ctx.strokeStyle = bridge ? shade(P.roadLine, 0.9) : rgba('#ffffff', 0.22);
    for (const [dx, dy, mx, my, a, b] of edges) {
      const nx = x + dx;
      const ny = y + dy;
      const connected = nx >= 0 && ny >= 0 && nx < size && ny < size && this.isRoad(ny * size + nx);
      if (connected || ((nx < 0 || nx >= size) && tile.d === 'highway')) links.push([mx, my]);
      else {
        // kerb (or railing on bridges) along edges without a road neighbour
        ctx.beginPath();
        ctx.moveTo(a[0] + (cx - a[0]) * 0.08, a[1] + (cy - a[1]) * 0.08);
        ctx.lineTo(b[0] + (cx - b[0]) * 0.08, b[1] + (cy - b[1]) * 0.08);
        ctx.stroke();
      }
    }

    let lineColor = tile.d === 'highway' ? P.highwayLine : P.roadLine;
    if (this.overlay === 'traffic' && analysis) {
      const u = analysis.capacity[y * size + x] ? analysis.load[y * size + x] / analysis.capacity[y * size + x] : 0;
      ctx.fillStyle = u < 0.4 ? rgba('#2ecc71', 0.55) : u < 0.8 ? rgba('#f1c40f', 0.65) : u < 1.1 ? rgba('#ff8c1a', 0.75) : rgba('#ff3b4e', 0.85);
      diamond(ctx, wx, wy, -1);
      ctx.fill();
      lineColor = '#ffffff';
    }
    ctx.strokeStyle = lineColor;
    ctx.lineCap = 'round';
    if (!links.length) {
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (tile.d === 'road') {
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3.5, 3.5]);
    } else {
      ctx.lineWidth = tile.d === 'highway' ? 1.4 : 2.2;
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    for (const [mx, my] of links) {
      if (tile.d === 'highway') {
        // two parallel lines
        const dx = mx - cx;
        const dy = my - cy;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * 1.6;
        const oy = (dx / len) * 1.6;
        ctx.moveTo(cx + ox, cy + oy);
        ctx.lineTo(mx + ox, my + oy);
        ctx.moveTo(cx - ox, cy - oy);
        ctx.lineTo(mx - ox, my - oy);
      } else {
        ctx.moveTo(cx, cy);
        ctx.lineTo(mx, my);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawGroundOverlays(analysis, visible) {
    const { ctx, state } = this;
    const size = state.size;
    const overlay = this.overlay;
    if (overlay !== 'none' && overlay !== 'traffic' && analysis) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!visible(x, y)) continue;
          const i = y * size + x;
          let color = null;
          if (overlay === 'happiness') {
            const t = state.tiles[i];
            if (t && state.defs[t.d]?.residents) {
              const h = analysis.happinessTile[i] / 100;
              color = h > 0.66 ? rgba('#2ecc71', 0.7) : h > 0.45 ? rgba('#f1c40f', 0.7) : rgba('#ff3b4e', 0.7);
            }
          } else if (overlay === 'pollution') {
            const p = analysis.pollution[i];
            if (p > 0.05) color = rgba('#8e44ad', clamp(p / 3.5, 0.12, 0.75));
          } else if (overlay === 'services') {
            const n = analysis.health[i] + analysis.safety[i] + analysis.education[i];
            color = n === 3 ? rgba('#2ecc71', 0.5) : n === 2 ? rgba('#a3d977', 0.45) : n === 1 ? rgba('#f39c12', 0.4) : rgba('#e74c3c', 0.22);
          } else if (overlay === 'transit') {
            const s = 1 - analysis.noTransit[i];
            if (s > 0) color = rgba('#3498db', clamp(s * 1.3, 0.2, 0.7));
          }
          if (color) {
            ctx.fillStyle = color;
            diamond(ctx, (x - y) * HW, (x + y) * HH, -1.5);
            ctx.fill();
          }
        }
      }
    }

    if (this.radius) {
      const { x: rx, y: ry, r } = this.radius;
      ctx.fillStyle = rgba('#ffffff', 0.16);
      for (let y = Math.max(0, ry - r); y <= Math.min(size - 1, ry + r); y++) {
        for (let x = Math.max(0, rx - r); x <= Math.min(size - 1, rx + r); x++) {
          if (Math.hypot(x - rx, y - ry) <= r) {
            diamond(ctx, (x - y) * HW, (x + y) * HH, -1);
            ctx.fill();
          }
        }
      }
    }

    const cells = this.preview || (this.hover ? [{ ...this.hover, ok: this.ghost ? this.ghost.ok : true }] : []);
    for (const c of cells) {
      ctx.fillStyle = c.ok ? rgba('#2ecc71', 0.35) : rgba('#ff3b4e', 0.35);
      ctx.strokeStyle = c.ok ? '#b8ffcf' : '#ffb3bb';
      ctx.lineWidth = 1.2;
      diamond(ctx, (c.x - c.y) * HW, (c.x + c.y) * HH, -1);
      ctx.fill();
      ctx.stroke();
    }
    if (this.selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      diamond(ctx, (this.selected.x - this.selected.y) * HW, (this.selected.x + this.selected.y) * HH, -1);
      ctx.stroke();
    }
  }

  drawForest(x, y) {
    const P = this.palette;
    const wx = (x - y) * HW;
    const wy = (x + y) * HH;
    const h = tileHash(x, y);
    const spots = [
      [-8, 13],
      [9, 15],
      [0, 22],
      [-1, 9],
    ];
    const count = 2 + (h % 3);
    for (let k = 0; k < count; k++) {
      const [ox, oy] = spots[(h + k) % spots.length];
      tree(this.ctx, wx + ox, wy + oy, 0.95 + ((h >> (k + 3)) % 4) / 10, P.forest[(h >> k) % P.forest.length]);
    }
  }

  drawBuilding(def, tile, x, y, i, analysis) {
    const { ctx, palette: P } = this;
    const wx = (x - y) * HW;
    const cy = (x + y) * HH + HH;
    const cx = wx;
    const seed = tileHash(x, y);
    const base = def.custom ? hashColor(def.name) : P.categories[def.category] || '#cccccc';
    const top = shade(base, 1.12);
    const left = shade(base, 0.9);
    const right = shade(base, 0.72);
    const occupancy = def.residents ? (tile.occ || 0) / def.residents : 1;
    const lit = P.night ? 0.25 + 0.7 * occupancy : 0.12 + 0.25 * occupancy;
    const H = def.height || 16;

    switch (def.archetype) {
      case 'house': {
        const hw = HW * 0.55;
        const hh = HH * 0.55;
        prism(ctx, cx, cy + 2, hw, hh, H * 0.75, top, left, right);
        pyramidRoof(ctx, cx, cy + 2, hw + 1.5, hh + 0.75, H * 0.75, 9, def.custom ? shade(base, 0.8) : P.roof);
        ctx.fillStyle = P.night ? P.window : P.windowOff;
        ctx.fillRect(cx - hw * 0.55, cy + 2 - 5, 3, 3);
        break;
      }
      case 'apartment':
      case 'tower': {
        const tall = def.archetype === 'tower';
        const hw = HW * (tall ? 0.62 : 0.7);
        const hh = HH * (tall ? 0.62 : 0.7);
        prism(ctx, cx, cy, hw, hh, H, top, left, right);
        windows(ctx, cx, cy, hw, hh, H, P, lit, seed, tall ? 3 : 3, tall ? 7 : 6.5);
        if (tall) {
          prism(ctx, cx, cy - H, hw * 0.45, hh * 0.45, 7, shade(base, 1.2), shade(base, 0.85), shade(base, 0.65));
          ctx.strokeStyle = P.night ? P.glow : shade(base, 0.6);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, cy - H - 7);
          ctx.lineTo(cx, cy - H - 20);
          ctx.stroke();
          if (P.night && Math.sin(this.time * 3 + seed) > 0) {
            ctx.fillStyle = '#ff4757';
            ctx.beginPath();
            ctx.arc(cx, cy - H - 20, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          prism(ctx, cx - 4, cy - H, 5, 2.5, 4, shade(base, 1.2), shade(base, 0.8), shade(base, 0.6));
        }
        break;
      }
      case 'shop': {
        const hw = HW * 0.72;
        const hh = HH * 0.72;
        prism(ctx, cx, cy, hw, hh, H, top, left, right);
        // awning stripe
        const awning = P.night ? P.glow : shade(P.categories.transit, 0.95);
        ctx.fillStyle = awning;
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy - H * 0.55);
        ctx.lineTo(cx, cy + hh - H * 0.55);
        ctx.lineTo(cx, cy + hh - H * 0.55 - 3);
        ctx.lineTo(cx - hw, cy - H * 0.55 - 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = P.night ? P.window : shade(P.window, 0.95);
        ctx.fillRect(cx + hw * 0.25, cy - 5, 5, 3.5);
        break;
      }
      case 'office': {
        const hw = HW * 0.66;
        const hh = HH * 0.66;
        const glass = def.custom ? base : mix(base, '#9fd3ff', 0.35);
        prism(ctx, cx, cy, hw, hh, H, shade(glass, 1.15), shade(glass, 0.92), shade(glass, 0.7));
        windows(ctx, cx, cy, hw, hh, H, P, P.night ? 0.8 : 0.35, seed, 4, 5);
        break;
      }
      case 'factory': {
        const hw = HW * 0.78;
        const hh = HH * 0.78;
        prism(ctx, cx, cy, hw, hh, H * 0.7, top, left, right);
        // sawtooth roof
        ctx.fillStyle = shade(base, 1.25);
        for (let k = 0; k < 3; k++) {
          const t = (k + 0.5) / 3;
          const px = cx - hw + hw * t;
          const py = cy - H * 0.7 + hh * t;
          ctx.beginPath();
          ctx.moveTo(px - 4, py);
          ctx.lineTo(px + 6, py + 3);
          ctx.lineTo(px + 6, py - 4);
          ctx.closePath();
          ctx.fill();
        }
        // chimney + smoke
        const chx = cx + hw * 0.45;
        const chy = cy - hh * 0.2;
        prism(ctx, chx, chy, 3, 1.5, H + 10, shade('#8a8f98', 1.1), '#7b8088', '#5f636b');
        if (!def.bonus || def.bonus !== 'eco') {
          for (let k = 0; k < 3; k++) {
            const phase = (this.time * 0.6 + k / 3 + (seed % 100) / 100) % 1;
            ctx.fillStyle = rgba('#d0d4da', 0.45 * (1 - phase));
            ctx.beginPath();
            ctx.arc(chx + phase * 6, chy - H - 12 - phase * 18, 2.5 + phase * 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'techpark': {
        const hw = HW * 0.8;
        const hh = HH * 0.8;
        const glass = def.custom ? base : mix(base, '#b3f0ff', 0.3);
        prism(ctx, cx, cy, hw, hh, H * 0.55, shade(glass, 1.1), shade(glass, 0.9), shade(glass, 0.7));
        windows(ctx, cx, cy, hw, hh, H * 0.55, P, P.night ? 0.85 : 0.4, seed, 4, 5);
        prism(ctx, cx + 4, cy - H * 0.55 - 2, hw * 0.5, hh * 0.5, H * 0.45, shade(glass, 1.2), shade(glass, 0.95), shade(glass, 0.75));
        ctx.fillStyle = P.categories.park;
        ctx.beginPath();
        ctx.ellipse(cx - hw * 0.45, cy - H * 0.55 + 1, 5, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'school':
      case 'hospital':
      case 'police': {
        const hw = HW * 0.74;
        const hh = HH * 0.74;
        prism(ctx, cx, cy, hw, hh, H, top, left, right);
        windows(ctx, cx, cy, hw, hh, H, P, P.night ? 0.7 : 0.3, seed, 4, 6);
        const accent = def.archetype === 'hospital' ? '#e74c3c' : def.archetype === 'police' ? '#2e86de' : '#f39c12';
        if (def.archetype === 'hospital') {
          ctx.fillStyle = accent;
          ctx.fillRect(cx - 5, cy - H - 1.5, 10, 3);
          ctx.fillRect(cx - 1.5, cy - H - 5, 3, 10);
        } else if (def.archetype === 'police') {
          ctx.fillStyle = Math.sin(this.time * 6 + seed) > 0 ? '#2e86de' : '#ff4757';
          ctx.beginPath();
          ctx.arc(cx, cy - H - 3, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.moveTo(cx - hw, cy - H * 0.45);
          ctx.lineTo(cx, cy + hh - H * 0.45);
          ctx.lineTo(cx, cy + hh - H * 0.45 - 2.5);
          ctx.lineTo(cx - hw, cy - H * 0.45 - 2.5);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#555';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(cx + hw * 0.5, cy - H - 1);
          ctx.lineTo(cx + hw * 0.5, cy - H - 14);
          ctx.stroke();
          ctx.fillStyle = accent;
          ctx.fillRect(cx + hw * 0.5, cy - H - 14, 6, 4);
        }
        break;
      }
      case 'park':
      case 'plaza': {
        const plaza = def.archetype === 'plaza';
        if (plaza) {
          ctx.fillStyle = shade(P.categories.service, 0.92);
          ctx.beginPath();
          ctx.ellipse(cx, cy, HW * 0.45, HH * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = mix(P.water[0], P.water[1], 0.5 + 0.5 * Math.sin(this.time * 3));
          ctx.beginPath();
          ctx.ellipse(cx, cy, HW * 0.25, HH * 0.25, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba('#ffffff', 0.8);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy - 6 - Math.sin(this.time * 5) * 1.5);
          ctx.stroke();
          tree(ctx, cx - HW * 0.55, cy + 2, 0.8, P.forest[0]);
          tree(ctx, cx + HW * 0.55, cy + 2, 0.8, P.forest[1]);
        } else {
          tree(ctx, cx - 9, cy + 1, 0.95, def.custom ? base : P.forest[1]);
          tree(ctx, cx + 8, cy + 3, 0.85, P.forest[0]);
          tree(ctx, cx, cy + 8, 0.9, def.custom ? shade(base, 0.8) : P.forest[1]);
          ctx.fillStyle = '#ffe066';
          ctx.fillRect(cx + 1, cy - 3, 1.5, 1.5);
          ctx.fillStyle = '#ff6b9a';
          ctx.fillRect(cx - 4, cy + 4, 1.5, 1.5);
        }
        break;
      }
      case 'bus': {
        prism(ctx, cx + 2, cy + 2, 8, 4, 7, shade(base, 1.15), rgba('#dfe9f5', 0.9), rgba('#b7c6d6', 0.9));
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy + 4);
        ctx.lineTo(cx - 10, cy - 12);
        ctx.stroke();
        ctx.fillStyle = base;
        ctx.fillRect(cx - 13, cy - 16, 6, 6);
        break;
      }
      case 'metro': {
        const hw = HW * 0.75;
        const hh = HH * 0.75;
        prism(ctx, cx, cy, hw, hh, H * 0.7, top, left, right);
        // curved glass roof
        ctx.fillStyle = rgba(P.night ? P.glow : '#bfe6ff', 0.75);
        ctx.beginPath();
        ctx.ellipse(cx, cy - H * 0.7, hw * 0.8, hh * 0.9 + 4, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(cx + hw * 0.55, cy - H * 0.7 - 10, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 6px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('M', cx + hw * 0.55, cy - H * 0.7 - 9.6);
        break;
      }
      case 'landmark':
        this.drawLandmark(def, cx, cy, seed);
        break;
      default:
        prism(ctx, cx, cy, HW * 0.7, HH * 0.7, H, top, left, right);
    }

    if (def.custom) {
      ctx.fillStyle = '#ffd84d';
      ctx.font = `8px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', cx, cy - H - 10);
    }
  }

  drawLandmark(def, cx, cy, seed) {
    const { ctx, palette: P } = this;
    const gold = P.categories.landmark;
    const H = def.height || 70;
    const glowPulse = 0.35 + 0.25 * Math.sin(this.time * 2 + seed);
    // aura
    ctx.fillStyle = rgba(gold, P.night ? glowPulse : glowPulse * 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, HW * 0.95, HH * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    const hw = HW * 0.8;
    const hh = HH * 0.8;
    const stone = shade(gold, 1.05);
    switch (def.effect) {
      case 'tech': {
        prism(ctx, cx, cy, hw * 0.6, hh * 0.6, H * 1.25, shade('#bfe9ff', 1.1), mix('#9fd3ff', gold, 0.2), mix('#6fa8d6', gold, 0.2));
        windows(ctx, cx, cy, hw * 0.6, hh * 0.6, H * 1.25, P, 0.9, seed, 3, 5);
        ctx.strokeStyle = P.night ? P.glow : gold;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy - H * 0.9, hw * 0.95, hh * 0.95, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'green': {
        prism(ctx, cx, cy, hw, hh, 8, shade(stone, 1.1), shade(stone, 0.9), shade(stone, 0.7));
        const dome = ctx.createRadialGradient(cx - 6, cy - 30, 3, cx, cy - 18, 30);
        dome.addColorStop(0, '#b8f5c8');
        dome.addColorStop(1, P.categories.park);
        ctx.fillStyle = dome;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 8, hw * 0.85, 30, 0, Math.PI, 0);
        ctx.fill();
        tree(ctx, cx - hw * 0.8, cy + 4, 0.8, P.forest[0]);
        tree(ctx, cx + hw * 0.8, cy + 4, 0.8, P.forest[1]);
        break;
      }
      case 'transit': {
        prism(ctx, cx, cy, hw, hh, 14, shade(stone, 1.1), shade(stone, 0.9), shade(stone, 0.72));
        ctx.strokeStyle = P.night ? P.glow : shade(gold, 0.7);
        ctx.lineWidth = 3;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(cx - 8 + k * 8, cy - 14 + k * 2, 10, 16, 0, Math.PI, 0);
          ctx.stroke();
        }
        break;
      }
      default: {
        // Arch with four minarets and a dome — a nod to the Charminar and friends.
        prism(ctx, cx, cy, hw * 0.8, hh * 0.8, H * 0.45, shade(stone, 1.12), shade(stone, 0.92), shade(stone, 0.72));
        ctx.fillStyle = rgba('#000000', 0.35);
        ctx.beginPath();
        ctx.ellipse(cx - hw * 0.4, cy + hh * 0.35 - H * 0.12, 5, 9, 0, Math.PI, 0);
        ctx.ellipse(cx + hw * 0.4, cy + hh * 0.35 - H * 0.12, 5, 9, 0, Math.PI, 0);
        ctx.fill();
        const corners = [
          [cx, cy - hh * 0.8],
          [cx - hw * 0.8, cy],
          [cx + hw * 0.8, cy],
          [cx, cy + hh * 0.8],
        ];
        for (const [mx, my] of corners) {
          prism(ctx, mx, my, 3.2, 1.6, H, shade(stone, 1.15), shade(stone, 0.95), shade(stone, 0.75));
          ctx.fillStyle = shade(stone, 1.2);
          ctx.beginPath();
          ctx.arc(mx, my - H - 1, 3.4, Math.PI, 0);
          ctx.fill();
        }
        ctx.fillStyle = shade(stone, 1.25);
        ctx.beginPath();
        ctx.ellipse(cx, cy - H * 0.45, hw * 0.35, 12, 0, Math.PI, 0);
        ctx.fill();
      }
    }
  }

  drawMarkers(analysis, visible) {
    const { ctx, state } = this;
    const size = state.size;
    const z = this.camera.zoom;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const t = state.tiles[i];
        if (!t || !visible(x, y)) continue;
        const def = state.defs[t.d];
        if (!def || def.category === 'road') continue;
        const cx = (x - y) * HW;
        const cy = (x + y) * HH + HH;
        if (analysis && analysis.access[i] < 0 && def.category !== 'park') {
          const bob = Math.sin(this.time * 4 + i) * 1.5;
          const my = cy - (def.height || 16) - 14 + bob;
          ctx.fillStyle = '#ff3b4e';
          ctx.beginPath();
          ctx.arc(cx, my, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', cx, my + 0.5);
        } else if (def.archetype === 'landmark' && z > 0.45) {
          const bob = Math.sin(this.time * 1.5 + i) * 2;
          ctx.font = `16px ${EMOJI_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.icon, cx, cy - (def.effect === 'tech' ? 115 : 92) + bob);
        }
      }
    }
  }

  drawGhost() {
    if (!this.ghost || !this.hover || this.preview) return;
    const { def } = this.ghost;
    if (!def || def.category === 'road') return;
    const { x, y } = this.hover;
    this.ctx.globalAlpha = 0.55;
    this.drawBuilding(def, { d: def.id, occ: def.residents || 0 }, x, y, -1, null);
    this.ctx.globalAlpha = 1;
  }

  // --- traffic particles -------------------------------------------------

  rebuildCarTable(analysis) {
    const tiles = [];
    const cumulative = [];
    let total = 0;
    let load = 0;
    for (let i = 0; i < analysis.capacity.length; i++) {
      if (analysis.capacity[i] <= 0) continue;
      const w = analysis.load[i] + (this.state.tiles[i]?.d === 'highway' ? 20 : 0);
      load += analysis.load[i];
      if (w <= 0) continue;
      total += w;
      tiles.push(i);
      cumulative.push(total);
    }
    this.carTable = { tiles, cumulative, total };
    this.carTarget = Math.min(MAX_CARS, Math.round(load / 22) + 12);
    this.carSource = analysis;
    this.cars = this.cars.filter((c) => this.isRoad(c.from) && this.isRoad(c.to));
  }

  roadNeighbours(i) {
    const size = this.state.size;
    const x = i % size;
    const out = [];
    if (x > 0 && this.isRoad(i - 1)) out.push(i - 1);
    if (x < size - 1 && this.isRoad(i + 1)) out.push(i + 1);
    if (i >= size && this.isRoad(i - size)) out.push(i - size);
    if (i + size < size * size && this.isRoad(i + size)) out.push(i + size);
    return out;
  }

  spawnCar() {
    const { tiles, cumulative, total } = this.carTable;
    const r = Math.random() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const from = tiles[lo];
    const next = this.roadNeighbours(from);
    if (!next.length) return;
    const P = this.palette;
    this.cars.push({
      from,
      to: next[Math.floor(Math.random() * next.length)],
      t: Math.random(),
      life: 6 + Math.floor(Math.random() * 14),
      color: P.cars[Math.floor(Math.random() * P.cars.length)],
    });
  }

  updateCars(dt, analysis) {
    if (!analysis) return;
    if (this.carSource !== analysis) this.rebuildCarTable(analysis);
    if (!this.carTable.total) {
      this.cars = [];
      return;
    }
    if (this.cars.length < this.carTarget && Math.random() < 0.6) this.spawnCar();
    const size = this.state.size;
    for (const car of this.cars) {
      const u = analysis.capacity[car.to] ? analysis.load[car.to] / analysis.capacity[car.to] : 0;
      const speed = 1.5 / (1 + 3 * Math.max(0, u - 0.5) ** 2);
      car.t += dt * speed;
      if (car.t >= 1) {
        car.t -= 1;
        const options = this.roadNeighbours(car.to).filter((n) => n !== car.from);
        const straight = car.to + (car.to - car.from);
        const next = options.includes(straight) && Math.random() < 0.6 ? straight : options[Math.floor(Math.random() * options.length)];
        if (next === undefined) {
          [car.from, car.to] = [car.to, car.from];
        } else {
          car.from = car.to;
          car.to = next;
        }
        car.life -= 1;
      }
      if (car.to < 0 || car.to >= size * size) car.life = 0;
    }
    this.cars = this.cars.filter((c) => c.life > 0);
    if (this.cars.length > this.carTarget + 10) this.cars.length = this.carTarget;
  }

  drawCars() {
    const { ctx, state, palette: P } = this;
    const size = state.size;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.6;
    for (const car of this.cars) {
      const fx = car.from % size;
      const fy = (car.from / size) | 0;
      const tx = car.to % size;
      const ty = (car.to / size) | 0;
      const ax = (fx - fy) * HW;
      const ay = (fx + fy) * HH + HH;
      const bx = (tx - ty) * HW;
      const by = (tx + ty) * HH + HH;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const side = this.leftHand ? -1 : 1;
      const px = ax + dx * car.t - uy * 3.2 * side;
      const py = ay + dy * car.t + ux * 3.2 * side;
      ctx.strokeStyle = car.color;
      ctx.beginPath();
      ctx.moveTo(px - ux * 2.4, py - uy * 2.4);
      ctx.lineTo(px + ux * 2.4, py + uy * 2.4);
      ctx.stroke();
      if (P.night) {
        ctx.fillStyle = '#fff6b0';
        ctx.fillRect(px + ux * 3 - 0.6, py + uy * 3 - 0.6, 1.2, 1.2);
      }
    }
  }

  /** PNG snapshot of the current view (for sharing). */
  snapshot() {
    return this.canvas.toDataURL('image/png');
  }
}
