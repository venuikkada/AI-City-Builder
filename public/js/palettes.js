// Colour palettes per city style. "night" palettes glow: lit windows, neon road lines.

export const PALETTES = {
  futuristic: {
    night: true,
    skyTop: '#070b1f',
    skyBottom: '#16244a',
    grass: ['#2c5e4c', '#29584a', '#2f6450'],
    forest: ['#1c4d3b', '#23604a'],
    water: ['#1e5f9e', '#2b7fc4'],
    sand: '#b9a578',
    slab: '#1a2238',
    road: '#262b38',
    avenue: '#1f232f',
    highway: '#191c26',
    roadLine: '#5ee7ff',
    highwayLine: '#ffd84d',
    categories: {
      residential: '#8fb8ff',
      commercial: '#56d9c1',
      industrial: '#a58cff',
      service: '#e3ecff',
      transit: '#ffcb57',
      park: '#2fae74',
      landmark: '#ffd166',
    },
    roof: '#33405e',
    window: '#aef3ff',
    windowOff: '#23324d',
    glow: '#5ee7ff',
    cars: ['#5ee7ff', '#ff6bd6', '#ffd84d', '#ffffff'],
  },
  cyberpunk: {
    night: true,
    skyTop: '#12041f',
    skyBottom: '#2a0b3d',
    grass: ['#27233d', '#2b2644', '#241f38'],
    forest: ['#1d3b3a', '#224a45'],
    water: ['#15345e', '#1f4b85'],
    sand: '#6d5a78',
    slab: '#1b1030',
    road: '#221b30',
    avenue: '#1c1629',
    highway: '#150f20',
    roadLine: '#ff3fd0',
    highwayLine: '#39f5ff',
    categories: {
      residential: '#ff5fa2',
      commercial: '#39f5ff',
      industrial: '#9d6bff',
      service: '#d7d0ff',
      transit: '#ffe14d',
      park: '#35d49a',
      landmark: '#ff9f1c',
    },
    roof: '#2e2143',
    window: '#ffd6f5',
    windowOff: '#2a1f3d',
    glow: '#ff3fd0',
    cars: ['#39f5ff', '#ff3fd0', '#ffe14d', '#ffffff'],
  },
  green: {
    night: false,
    skyTop: '#bfe8ff',
    skyBottom: '#eaf8ef',
    grass: ['#7cc766', '#74bf5f', '#83cd6c'],
    forest: ['#3f9a4a', '#4fae57'],
    water: ['#3c9fd6', '#5ab5e6'],
    sand: '#e7d9a4',
    slab: '#8a6a45',
    road: '#6f7478',
    avenue: '#61666b',
    highway: '#55595e',
    roadLine: '#f4f4ea',
    highwayLine: '#ffd84d',
    categories: {
      residential: '#f4e3c3',
      commercial: '#9fd8e6',
      industrial: '#c9c2a4',
      service: '#ffffff',
      transit: '#ffd166',
      park: '#4cbf5c',
      landmark: '#ffd166',
    },
    roof: '#4f9f5a',
    window: '#fff4c2',
    windowOff: '#6f8fa3',
    glow: '#ffffff',
    cars: ['#ffffff', '#e74c3c', '#3498db', '#f1c40f'],
  },
  heritage: {
    night: false,
    skyTop: '#ffd9a8',
    skyBottom: '#fff1dc',
    grass: ['#9cc463', '#94bb5c', '#a3cb6a'],
    forest: ['#5e9a3c', '#6fae45'],
    water: ['#3f93c2', '#5aa9d6'],
    sand: '#ead2a0',
    slab: '#8d5f3a',
    road: '#a8987f',
    avenue: '#9a8a72',
    highway: '#7f7465',
    roadLine: '#f7ecd6',
    highwayLine: '#ffffff',
    categories: {
      residential: '#f0c998',
      commercial: '#e39d5c',
      industrial: '#c9ad8c',
      service: '#fff4e2',
      transit: '#d9a441',
      park: '#5ea84a',
      landmark: '#f4c95d',
    },
    roof: '#b4533a',
    window: '#fff0c9',
    windowOff: '#7a5a43',
    glow: '#fff0c9',
    cars: ['#ffffff', '#c0392b', '#2c3e50', '#f39c12'],
  },
  coastal: {
    night: false,
    skyTop: '#a8e6ff',
    skyBottom: '#f0fbff',
    grass: ['#8fd07a', '#86c873', '#97d782'],
    forest: ['#3d9e5c', '#4db26a'],
    water: ['#1aa3c7', '#36bfdf'],
    sand: '#f1e0b0',
    slab: '#9c7b52',
    road: '#7d858c',
    avenue: '#6e767d',
    highway: '#5f666d',
    roadLine: '#ffffff',
    highwayLine: '#ffd84d',
    categories: {
      residential: '#ffffff',
      commercial: '#7fd3f7',
      industrial: '#b8c4cc',
      service: '#fff7e6',
      transit: '#ffc947',
      park: '#4cc27a',
      landmark: '#ffcf56',
    },
    roof: '#2f86c8',
    window: '#fffbe0',
    windowOff: '#5f93b3',
    glow: '#ffffff',
    cars: ['#ffffff', '#ff6b6b', '#2e86de', '#feca57'],
  },
  desert: {
    night: false,
    skyTop: '#ffcf8f',
    skyBottom: '#fff2d9',
    grass: ['#e2c48c', '#dcbd84', '#e8cb95'],
    forest: ['#7d9a4a', '#8fae55'],
    water: ['#1fa6b5', '#3cc2cf'],
    sand: '#f0d7a3',
    slab: '#a0703e',
    road: '#9b8f7d',
    avenue: '#8d8171',
    highway: '#7d7265',
    roadLine: '#fff6e3',
    highwayLine: '#ffffff',
    categories: {
      residential: '#f6e2bd',
      commercial: '#e9b872',
      industrial: '#d2bfa0',
      service: '#fffaf0',
      transit: '#ffd166',
      park: '#7fb34d',
      landmark: '#ffcf56',
    },
    roof: '#c96a3b',
    window: '#fff5d6',
    windowOff: '#8e6d4c',
    glow: '#fff5d6',
    cars: ['#ffffff', '#d35400', '#34495e', '#f1c40f'],
  },
  classic: {
    night: false,
    skyTop: '#a9d8ff',
    skyBottom: '#e8f4ff',
    grass: ['#7cc36b', '#74bb63', '#84ca73'],
    forest: ['#3f8f45', '#4ba352'],
    water: ['#4a9ee0', '#63b1ea'],
    sand: '#ecdca8',
    slab: '#7a5a3a',
    road: '#6b7078',
    avenue: '#5d626a',
    highway: '#4f545b',
    roadLine: '#ffffff',
    highwayLine: '#ffd84d',
    categories: {
      residential: '#f2d7a6',
      commercial: '#8ec5ff',
      industrial: '#c8b89a',
      service: '#ffffff',
      transit: '#ffcb57',
      park: '#4caf50',
      landmark: '#ffd166',
    },
    roof: '#c0504d',
    window: '#fff6cf',
    windowOff: '#5b7a99',
    glow: '#ffffff',
    cars: ['#ffffff', '#e74c3c', '#3498db', '#f1c40f'],
  },
};

export function paletteFor(style) {
  return PALETTES[style] || PALETTES.classic;
}

const cache = new Map();

function parseHex(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Multiplies a colour's brightness (0.8 = darker, 1.2 = lighter). Returns hex, cached. */
export function shade(hex, factor) {
  const key = `${hex}|${factor}`;
  let out = cache.get(key);
  if (!out) {
    const [r, g, b] = parseHex(hex);
    const f = (c) => Math.max(0, Math.min(255, Math.round(factor >= 1 ? c + (255 - c) * (factor - 1) : c * factor)));
    out = toHex(f(r), f(g), f(b));
    cache.set(key, out);
  }
  return out;
}

/** Blends two hex colours; returns hex so the result can be shaded again. */
export function mix(a, b, t) {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return toHex(m(r1, r2), m(g1, g2), m(b1, b2));
}

export function rgba(hex, alpha) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Stable pseudo-random colour for invented buildings. */
export function hashColor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 65, 62);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return toHex(f(0), f(8), f(4));
}
