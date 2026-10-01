// DOM building blocks for the HUD, build menu and panels. AI-generated text is
// only ever inserted as text nodes, never as HTML.

import { BONUSES, milestoneFor, nextMilestone } from './shared/catalog.js';
import { OBJECTIVES } from './shared/plan.js';
import { missionStatus, describeObjective } from './game/missions.js';
import { dateLabel } from './game/state.js';
import { formatMoney, formatSignedMoney, formatNumber, formatCompact, percent } from './format.js';
import { icon } from './icons.js';

export const STYLE_AVATARS = {
  futuristic: '🤖',
  cyberpunk: '👾',
  green: '🌿',
  heritage: '🎩',
  coastal: '⚓',
  desert: '🐪',
  classic: '👔',
};

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (id) => document.getElementById(id);

/** replaceChildren that skips null/false entries (used for optional sections). */
export function setChildren(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};

const SERVICE_LABELS = { education: 'School', health: 'Health', safety: 'Safety' };
const EFFECT_LABELS = { tourism: 'Tourism magnet', happiness: 'Happiness boost', transit: 'Transit hub', tech: 'Tech jobs', green: 'Clean air' };

/** One-line gameplay summary of a building definition. */
export function statsLine(def, currency) {
  const parts = [`${formatMoney(def.cost, currency)}`];
  if (def.upkeep) parts.push(`${formatMoney(def.upkeep, currency)}/mo`);
  if (def.residents) parts.push(`${def.residents} residents`);
  if (def.jobs) parts.push(`${def.jobs} jobs`);
  if (def.capacity) parts.push(`${def.capacity} cars`);
  if (def.service) parts.push(`${SERVICE_LABELS[def.service] || def.service} cover, radius ${def.radius}`);
  if (def.transit) parts.push(`${Math.round(def.transit * 100)}% ride transit (radius ${def.radius})`);
  if (def.happiness) parts.push(`+${def.happiness} happiness`);
  if (def.pollution && def.pollution >= 1) parts.push('pollutes');
  if (def.absorb) parts.push('cleans air');
  if (def.tourism) parts.push('tourism');
  if (def.bonus && def.bonus !== 'none') parts.push(`${BONUSES[def.bonus].label} bonus`);
  return parts.join(' · ');
}

/** The single most useful number for a build card. */
export function keyStat(def) {
  if (def.category === 'road') return `${def.capacity} cars`;
  if (def.residents) return `${def.residents} residents`;
  if (def.archetype === 'landmark') return EFFECT_LABELS[def.effect] || 'Landmark';
  if (def.transit) return `${Math.round(def.transit * 100)}% ride transit`;
  if (def.service) return `${SERVICE_LABELS[def.service] || 'Service'} cover`;
  if (def.jobs) return `${def.jobs} jobs`;
  if (def.happiness) return `+${def.happiness} happiness`;
  return '';
}

// --- start, loading & reveal ------------------------------------------------

// [emoji, short chip label, the prompt it fills in]
export const EXAMPLE_PROMPTS = [
  ['🚀', 'Futuristic Hyderabad', 'Build a futuristic Hyderabad.'],
  ['🌃', 'Cyberpunk Mumbai', 'Cyberpunk Mumbai by the sea'],
  ['🌿', 'Green Bengaluru', 'A green, car-free Bengaluru garden city'],
  ['🏰', 'Heritage Jaipur', 'Heritage Jaipur with a modern metro'],
  ['🗼', 'Tokyo 2099', 'Tokyo in the year 2099'],
  ['🏜️', 'Desert oasis', 'A solar-powered desert oasis'],
];

export function renderChips(container, onPick) {
  setChildren(
    container,
    ...EXAMPLE_PROMPTS.map(([emoji, label, prompt]) =>
      el(
        'button',
        { type: 'button', class: 'chip', title: prompt, onclick: () => onPick(prompt) },
        el('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, emoji),
        label,
      ),
    ),
  );
}

export const LOADING_STEPS = [
  'Reading your vision',
  'Shaping the land and water',
  'Zoning neighbourhoods',
  'Designing landmarks',
  'Writing your missions',
  'Hiring a city advisor',
];

export function renderLoadingSteps(container, active) {
  setChildren(
    container,
    ...LOADING_STEPS.map((text, i) => {
      const state = i < active ? 'done' : i === active ? 'active' : 'todo';
      return el('li', { dataset: { state } }, el('span', { class: 'step-dot' }, state === 'done' ? icon('check', { size: 13, stroke: 3.2 }) : null), text);
    }),
  );
}

export function renderReveal(plan, meta) {
  $('reveal-name').textContent = plan.cityName;
  $('reveal-tagline').textContent = plan.tagline;
  $('reveal-vision').textContent = plan.vision;
  const source = $('reveal-source');
  setChildren(source, icon(meta.source === 'ai' ? 'sparkles' : 'city', { size: 14 }), meta.source === 'ai' ? 'Designed by Claude' : 'Offline planner');
  source.className = `badge ${meta.source === 'ai' ? 'badge-ai' : ''}`;
  $('reveal-style').textContent = `${plan.style} · ${plan.terrain.water === 'none' ? 'dry land' : plan.terrain.water}`;
  const notice = $('reveal-notice');
  notice.hidden = !meta.notice;
  notice.textContent = meta.notice || '';
  setChildren(
    $('reveal-landmarks'),
    ...plan.landmarks.map((l) =>
      el(
        'li',
        { class: 'landmark' },
        el('span', { class: 'landmark-icon', 'aria-hidden': 'true' }, l.icon),
        el('strong', {}, l.name),
        el('p', {}, l.description),
        el('small', {}, `${EFFECT_LABELS[l.effect] || 'Landmark'} · ${l.unlockPopulation ? `unlocks at ${formatNumber(l.unlockPopulation)} people` : 'ready from day one'}`),
      ),
    ),
  );
  setChildren(
    $('reveal-missions'),
    ...plan.missions.map((m) => el('li', {}, el('strong', {}, m.title), el('p', {}, m.description || describeObjective(m, null, plan.currency)))),
  );
  setChildren(
    $('reveal-buildings'),
    ...Object.values(plan.names).map((n) => el('li', { class: 'building-chip', title: n.description }, el('span', { 'aria-hidden': 'true' }, n.icon), n.name)),
  );
}

// --- build menu ---------------------------------------------------------------

const CATEGORY_COLORS = {
  road: '#9aa6bf',
  residential: '#7cc4ff',
  commercial: '#2dd4bf',
  industrial: '#f6ad55',
  service: '#ff8fa3',
  transit: '#ffb238',
  park: '#4ade80',
  landmark: '#ffd166',
};

export const BUILD_TABS = [
  { id: 'road', label: 'Roads', emoji: '🛣️', ids: ['road', 'avenue'] },
  { id: 'residential', label: 'Homes', emoji: '🏠', ids: ['house', 'apartment', 'tower'] },
  { id: 'commercial', label: 'Business', emoji: '🏪', ids: ['shop', 'office'] },
  { id: 'industrial', label: 'Industry', emoji: '🏭', ids: ['factory', 'techpark'] },
  { id: 'service', label: 'Services', emoji: '🏥', ids: ['school', 'hospital', 'police'] },
  { id: 'transit', label: 'Transit', emoji: '🚇', ids: ['bus', 'metro'] },
  { id: 'park', label: 'Parks', emoji: '🌳', ids: ['park', 'plaza'] },
  { id: 'landmark', label: 'Landmarks', emoji: '🏛️' },
  { id: 'ideas', label: 'Ideas', emoji: '💡' },
];

/** Which tab a building lives in (used to jump to newly unlocked buildings). */
export function tabFor(game, id) {
  const def = game.defs[id];
  if (!def) return 'road';
  if (def.archetype === 'landmark') return 'landmark';
  return BUILD_TABS.some((t) => t.id === def.category) ? def.category : 'ideas';
}

export function isLocked(game, def) {
  return (def.unlock || 0) > game.maxPop;
}

export function isBuilt(game, def) {
  return Boolean(def.unique && game.tiles.some((t) => t && t.d === def.id));
}

/** Category tabs plus a grid of cards. Returns a small controller. */
export function createBuildMenu({ tabs, grid, info }, game, handlers) {
  const currency = game.plan.currency;
  let category = handlers.category || 'road';
  let selected = handlers.selected || 'inspect';
  const cards = new Map();

  const idsFor = (tab) => {
    if (tab.id === 'landmark') return game.plan.landmarks.map((l) => l.id);
    if (tab.id === 'ideas') return game.custom.map((c) => c.id);
    return [...tab.ids, ...game.custom.filter((c) => game.defs[c.id]?.category === tab.id).map((c) => c.id)];
  };

  function renderTabs() {
    setChildren(
      tabs,
      ...BUILD_TABS.map((tab) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `cat-tab${tab.id === category ? ' active' : ''}`,
            'aria-selected': String(tab.id === category),
            dataset: { cat: tab.id },
            onclick: () => setCategory(tab.id),
          },
          el('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, tab.emoji),
          tab.label,
        ),
      ),
    );
  }

  function card(id) {
    const def = game.defs[id];
    const node = el(
      'button',
      {
        type: 'button',
        class: `tool-card${def.custom ? ' custom' : ''}`,
        dataset: { tool: id },
        title: def.description,
        onclick: () => handlers.onSelect(id),
        onmouseenter: () => showInfo(id),
        onfocus: () => showInfo(id),
      },
      el('span', { class: 'tool-emoji', 'aria-hidden': 'true' }, def.icon),
      el('span', { class: 'tool-name' }, def.name),
      el('span', { class: 'tool-stat' }, keyStat(def)),
      el('span', { class: 'tool-cost' }, formatMoney(def.cost, currency)),
      el('span', { class: 'tool-badge', hidden: true }),
    );
    node.style.setProperty('--cat', CATEGORY_COLORS[def.category] || CATEGORY_COLORS.commercial);
    cards.set(id, node);
    return node;
  }

  function renderGrid() {
    cards.clear();
    const tab = BUILD_TABS.find((t) => t.id === category) || BUILD_TABS[0];
    const children = idsFor(tab).map(card);
    if (tab.id === 'ideas') {
      children.unshift(
        el(
          'button',
          { type: 'button', class: 'tool-card tool-invent', onclick: () => handlers.onInvent() },
          el('span', { class: 'tool-emoji', 'aria-hidden': 'true' }, '✨'),
          el('span', { class: 'invent-text' }, el('span', { class: 'tool-name' }, 'Invent a building'), el('span', { class: 'tool-stat' }, 'Describe any idea and AI turns it into a new building')),
        ),
      );
    }
    setChildren(grid, ...children);
    grid.scrollTop = 0;
    update(selected);
  }

  function setCategory(id) {
    category = BUILD_TABS.some((t) => t.id === id) ? id : 'road';
    handlers.onCategory?.(category);
    renderTabs();
    renderGrid();
    // Scroll only the tab strip: scrollIntoView would also scroll the page while the sheet is off-screen.
    const active = tabs.querySelector('.active');
    if (active) tabs.scrollLeft = Math.max(0, active.offsetLeft - 12);
  }

  function showInfo(id) {
    if (!info) return;
    const def = game.defs[id];
    if (!def) {
      setChildren(
        info,
        el('strong', {}, id === 'bulldoze' ? 'Clear' : 'Explore'),
        el(
          'p',
          {},
          id === 'bulldoze'
            ? 'Drag over buildings, roads or trees to clear them. Same-month demolitions refund half the cost.'
            : 'Drag to move the map, click a tile to see details. Right-drag always pans.',
        ),
      );
      return;
    }
    setChildren(
      info,
      el('strong', {}, `${def.icon} ${def.name}`),
      el('p', {}, def.description),
      el('small', { class: 'stats' }, statsLine(def, currency)),
      isLocked(game, def) ? el('small', { class: 'locked-note' }, `Unlocks at ${formatNumber(def.unlock)} population`) : null,
    );
  }

  function update(sel = selected) {
    if (sel !== selected) {
      selected = sel;
      showInfo(sel);
    }
    for (const [id, node] of cards) {
      const def = game.defs[id];
      const locked = isLocked(game, def);
      const built = !locked && isBuilt(game, def);
      node.classList.toggle('active', id === sel);
      node.setAttribute('aria-pressed', String(id === sel));
      const state = locked ? 'locked' : built ? 'built' : '';
      if (node.dataset.state === state) continue;
      node.dataset.state = state;
      node.classList.toggle('locked', locked);
      node.classList.toggle('built', built);
      const badge = node.querySelector('.tool-badge');
      badge.hidden = !state;
      if (locked) setChildren(badge, icon('lock', { size: 11, stroke: 2.6 }), formatCompact(def.unlock));
      else if (built) setChildren(badge, icon('check', { size: 11, stroke: 3 }), 'Built');
    }
  }

  grid.onmouseleave = () => showInfo(selected);
  renderTabs();
  renderGrid();
  showInfo(selected);
  return {
    update,
    setCategory,
    get category() {
      return category;
    },
  };
}

// --- HUD -------------------------------------------------------------------

const MOODS = [
  [70, 'happy', 'good'],
  [45, 'neutral', 'warn'],
  [0, 'sad', 'bad'],
];

export function updateHud(game, a) {
  const currency = game.plan.currency;
  const pop = Math.max(game.maxPop, a.population);
  setText($('hud-name'), game.plan.cityName);
  setText($('hud-milestone'), milestoneFor(pop).title);
  setText($('hud-date'), dateLabel(game));
  const next = nextMilestone(pop);
  $('hud-milestone').title = next ? `Next: ${next.title} at ${formatNumber(next.pop)} people` : 'Top milestone reached';
  setText($('hud-money'), formatMoney(game.money, currency));
  $('stat-money').dataset.level = game.money < 0 ? 'bad' : '';
  const net = $('hud-net');
  setText(net, `${formatSignedMoney(a.budget.net, currency)}/mo`);
  net.dataset.sign = a.budget.net < 0 ? 'neg' : 'pos';
  setText($('hud-pop'), formatCompact(a.population));
  setText($('hud-jobs'), formatCompact(a.jobs));
  setText($('hud-happy'), percent(a.happiness / 100));
  const [, mood, level] = MOODS.find(([min]) => a.happiness >= min) || MOODS[2];
  const moodIcon = $('hud-happy-icon');
  if (moodIcon.dataset.mood !== mood) {
    moodIcon.dataset.mood = mood;
    moodIcon.replaceChildren(icon(mood, { size: 16 }));
  }
  $('stat-happy').dataset.level = level;
  setText($('hud-traffic'), percent(a.congestion));
  $('stat-traffic').dataset.level = a.congestion > 0.6 ? 'bad' : a.congestion > 0.35 ? 'warn' : 'good';
}

// --- missions --------------------------------------------------------------

function formatMissionValue(m, value, currency) {
  const spec = OBJECTIVES[m.objective];
  if (spec.money) return formatMoney(value, currency);
  if (spec.unit === '%') return `${Math.round(value)}%`;
  return formatNumber(value);
}

function missionCard(m, game) {
  const currency = game.plan.currency;
  const bar = el('div', { class: 'bar' });
  const progress = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': m.title }, bar);
  const value = el('div', { class: 'm-value' });
  const node = el(
    'article',
    { class: 'mission' },
    el('header', {}, el('span', { class: 'm-title' }, m.title), el('span', { class: 'm-reward' }, `+${formatMoney(m.reward, currency)}`)),
    m.description ? el('p', { class: 'm-desc' }, m.description) : null,
    el('div', { class: 'm-goal' }, icon('target', { size: 15 }), describeObjective(m, game.defs, currency)),
    progress,
    value,
  );
  return { node, bar, progress, value };
}

/** Mission cards are built once and updated in place, so buttons keep working while the game ticks. */
export function renderMissions(container, game, a, { advisorBusy, onAsk }) {
  const currency = game.plan.currency;
  const advisorName = game.plan.advisorName;
  let r = container._missions;
  if (!r || r.game !== game) {
    const count = el('span', { class: 'muted small' });
    const list = el('div', { class: 'mission-list' });
    const askLabel = el('span');
    const ask = el('button', { type: 'button', class: 'btn btn-teal btn-block', onclick: () => onAsk() }, icon('sparkles', { size: 18 }), askLabel);
    const doneWrap = el('div');
    setChildren(container, el('div', { class: 'section-head' }, el('h3', {}, 'Missions'), count), list, ask, doneWrap);
    r = container._missions = { game, count, list, ask, askLabel, doneWrap, key: null, doneKey: null, cards: new Map() };
  }
  const active = game.missions.filter((m) => m.status === 'active');
  const queued = game.missions.filter((m) => m.status === 'queued');
  const done = game.missions.filter((m) => m.status === 'done');
  setText(r.count, `${done.length} done${queued.length ? ` · ${queued.length} queued` : ''}`);

  const key = active.map((m) => m.id).join(',');
  if (key !== r.key) {
    r.key = key;
    r.cards = new Map(active.map((m) => [m.id, missionCard(m, game)]));
    setChildren(r.list, ...(active.length ? [...r.cards.values()].map((c) => c.node) : [el('p', { class: 'empty' }, 'All missions complete! Ask your advisor for more.')]));
  }
  for (const m of active) {
    const c = r.cards.get(m.id);
    const s = missionStatus(game, a, m);
    const spec = OBJECTIVES[m.objective];
    const pct = Math.round(s.progress * 100);
    c.bar.style.width = `${pct}%`;
    c.progress.setAttribute('aria-valuenow', String(pct));
    const valueText =
      spec.cmp === '<=' ? `Now ${formatMissionValue(m, s.value, currency)}` : `${formatMissionValue(m, s.value, currency)} / ${formatMissionValue(m, m.target, currency)}`;
    setText(c.value, s.gateMet || !m.minPopulation ? valueText : `Needs ${formatNumber(m.minPopulation)} residents first`);
  }

  r.ask.disabled = advisorBusy;
  setText(r.askLabel, advisorBusy ? `${advisorName} is thinking…` : `Ask ${advisorName} for new missions`);

  const doneKey = done.map((m) => m.id).join(',');
  if (doneKey !== r.doneKey) {
    r.doneKey = doneKey;
    const wasOpen = Boolean(r.doneWrap.querySelector('details')?.open);
    setChildren(
      r.doneWrap,
      done.length
        ? el(
            'details',
            { class: 'done-list', open: wasOpen },
            el('summary', {}, `Completed (${done.length})`),
            el('ul', {}, ...done.slice().reverse().map((m) => el('li', {}, icon('ok', { size: 16 }), m.title, el('span', { class: 'muted' }, `+${formatMoney(m.reward, currency)}`)))),
          )
        : null,
    );
  }
}

// --- advisor ---------------------------------------------------------------

const TIP_ICONS = { warn: 'warn', info: 'info', good: 'ok' };
const NEWS_ICONS = { mission: '🏆', event: '⚡', unlock: '🔓', milestone: '🎉', warning: '⚠️', advisor: '💬' };

export function renderAdvisor(container, game, tips, advice) {
  const news = game.log.slice(-14).reverse();
  const key = JSON.stringify([advice, tips.map((t) => t.text), news.length, news[0]?.text, game.month]);
  if (container._key === key && container._game === game) return;
  container._key = key;
  container._game = game;
  setChildren(
    container,
    el(
      'div',
      { class: 'advisor-card' },
      el('div', { class: 'avatar', 'aria-hidden': 'true' }, STYLE_AVATARS[game.plan.style] || '🤖'),
      el('div', {}, el('div', { class: 'advisor-name' }, game.plan.advisorName), el('p', { class: 'bubble' }, advice || game.plan.advisorIntro)),
    ),
    el('h4', {}, 'Right now'),
    el('ul', { class: 'tips' }, ...tips.map((t) => el('li', { class: `tip tip-${t.level}` }, icon(TIP_ICONS[t.level] || 'info', { size: 16 }), el('span', {}, t.text)))),
    el('h4', {}, 'City news'),
    el('ul', { class: 'news' }, ...news.map((n) => el('li', {}, el('span', { class: 'news-icon', 'aria-hidden': 'true' }, NEWS_ICONS[n.kind] || '•'), el('span', {}, n.text)))),
  );
}

// --- budget ----------------------------------------------------------------

function sparkline(canvas, values, color, fromZero) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 240;
  const h = canvas.clientHeight || 54;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const min = fromZero ? Math.min(0, ...values) : Math.min(...values);
  const max = Math.max(...values, min + 1);
  const points = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 4, h - 5 - ((v - min) / (max - min || 1)) * (h - 10)]);
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, `${color}55`);
  fill.addColorStop(1, `${color}00`);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(points[points.length - 1][0], h);
  ctx.lineTo(points[0][0], h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function renderBudget(container, game, a, { onTax }) {
  const c = game.plan.currency;
  // Built once per game and then updated in place, so the tax slider keeps
  // working while the simulation ticks.
  let r = container._budget;
  if (!r || r.game !== game) {
    const cell = () => el('td', { class: 'num' });
    const rows = { resTax: cell(), bizTax: cell(), tourism: cell(), upkeep: cell(), net: cell() };
    const totalRow = el('tr', { class: 'total' }, el('td', {}, 'Monthly profit'), rows.net);
    const tax = el('input', { type: 'range', min: 0, max: 20, step: 1, id: 'tax-slider', 'aria-label': 'Tax rate' });
    const taxOut = el('output', { for: 'tax-slider' });
    tax.addEventListener('input', () => {
      taxOut.textContent = `${tax.value}%`;
      onTax(Number(tax.value));
    });
    const homesBar = el('div', { class: 'bar bar-homes' });
    const jobsBar = el('div', { class: 'bar bar-jobs' });
    const popChart = el('canvas', { class: 'spark', 'aria-label': 'Population history' });
    const moneyChart = el('canvas', { class: 'spark', 'aria-label': 'Treasury history' });
    setChildren(
      container,
      el('div', { class: 'section-head' }, el('h3', {}, 'Budget'), el('span', { class: 'muted small' }, 'per month')),
      el(
        'table',
        { class: 'budget' },
        el(
          'tbody',
          {},
          el('tr', {}, el('td', {}, 'Resident taxes'), rows.resTax),
          el('tr', {}, el('td', {}, 'Business taxes'), rows.bizTax),
          el('tr', {}, el('td', {}, 'Tourism'), rows.tourism),
          el('tr', { class: 'cost' }, el('td', {}, 'Upkeep'), rows.upkeep),
          totalRow,
        ),
      ),
      el('label', { class: 'tax-label', for: 'tax-slider' }, 'Tax rate', taxOut),
      tax,
      el('p', { class: 'muted small' }, 'Lower taxes make residents happier; higher taxes fill the treasury.'),
      el('h4', {}, 'Demand'),
      el('div', { class: 'demand-row', title: 'Unfilled jobs waiting for residents' }, el('span', {}, 'Homes'), el('div', { class: 'progress' }, homesBar)),
      el('div', { class: 'demand-row', title: 'Unemployed residents looking for work' }, el('span', {}, 'Jobs'), el('div', { class: 'progress' }, jobsBar)),
      el('h4', {}, 'Population'),
      popChart,
      el('h4', {}, 'Treasury'),
      moneyChart,
    );
    r = container._budget = { game, rows, totalRow, tax, taxOut, homesBar, jobsBar, popChart, moneyChart, historyLength: -1 };
  }
  const b = a.budget;
  setText(r.rows.resTax, formatSignedMoney(b.resTax, c));
  setText(r.rows.bizTax, formatSignedMoney(b.bizTax, c));
  setText(r.rows.tourism, formatSignedMoney(b.tourism, c));
  setText(r.rows.upkeep, formatSignedMoney(-b.upkeep, c));
  setText(r.rows.net, formatSignedMoney(b.net, c));
  r.totalRow.classList.toggle('negative', b.net < 0);
  if (document.activeElement !== r.tax) r.tax.value = String(game.taxRate);
  setText(r.taxOut, `${game.taxRate}%`);
  r.homesBar.style.width = `${Math.round(a.demand.homes * 100)}%`;
  r.jobsBar.style.width = `${Math.round(a.demand.jobs * 100)}%`;
  // Charts need a laid-out canvas; redraw when history grows or the panel appears.
  const width = r.popChart.clientWidth;
  if (width && (r.historyLength !== game.history.length || r.chartWidth !== width)) {
    r.historyLength = game.history.length;
    r.chartWidth = width;
    sparkline(r.popChart, game.history.map((h) => h.pop), '#7cc4ff', true);
    sparkline(r.moneyChart, game.history.map((h) => h.money), '#ffb238', false);
  }
}

// --- map layers ----------------------------------------------------------------

export const LAYERS = {
  traffic: { label: 'Traffic', stops: ['#2ecc71', '#f1c40f', '#ff8c1a', '#ff3b4e'], ends: ['Flowing', 'Jammed'] },
  happiness: { label: 'Happiness', stops: ['#ff3b4e', '#f1c40f', '#2ecc71'], ends: ['Unhappy', 'Happy'] },
  pollution: { label: 'Pollution', stops: ['rgba(142,68,173,0.15)', '#8e44ad'], ends: ['Clean', 'Smoggy'] },
  services: { label: 'Services', stops: ['#e74c3c', '#f39c12', '#a3d977', '#2ecc71'], ends: ['None nearby', 'All three'] },
  transit: { label: 'Transit', stops: ['rgba(52,152,219,0.2)', '#3498db'], ends: ['Little', 'Lots'] },
};

export function legendGradient(name) {
  const spec = LAYERS[name];
  return spec ? `linear-gradient(90deg, ${spec.stops.join(', ')})` : '';
}

export function renderLegend(container, name) {
  const spec = LAYERS[name];
  if (!spec) {
    setChildren(container, el('span', { class: 'muted' }, 'Pick a layer to see traffic, happiness, pollution, service or transit coverage.'));
    return;
  }
  const scale = el('span', { class: 'legend-scale' });
  scale.style.background = legendGradient(name);
  setChildren(container, scale, el('div', { class: 'legend-labels' }, el('span', {}, spec.ends[0]), el('span', {}, spec.ends[1])));
}

// --- inspector & tooltip ----------------------------------------------------

export function describeTile(game, a, x, y) {
  const i = y * game.size + x;
  const t = game.tiles[i];
  const c = game.plan.currency;
  const terrain = ['Grassland', 'Water', 'Forest', 'Beach'][game.terrain[i]] || 'Land';
  if (!t) return { title: terrain, lines: [game.terrain[i] === 2 ? 'Building here clears the trees.' : game.terrain[i] === 1 ? 'Only roads can bridge water.' : 'Empty land, ready to build.'] };
  const def = game.defs[t.d];
  const lines = [];
  if (def.category === 'road') {
    const load = a.load[i];
    const u = a.capacity[i] ? load / a.capacity[i] : 0;
    lines.push(`${Math.round(load)} / ${def.capacity} cars (${Math.round(u * 100)}% used)`);
    lines.push(u > 1 ? '🔴 Jammed' : u > 0.7 ? '🟠 Busy' : '🟢 Flowing');
    if (!a.connected[i]) lines.push('⚠️ Not connected to the highway');
    return { title: `${def.icon} ${def.name}`, lines };
  }
  if (def.residents) {
    lines.push(`👥 ${t.occ || 0} / ${def.residents} residents`);
    lines.push(`😊 Happiness ${Math.round(a.happinessTile[i])}%`);
  }
  if (def.jobs) lines.push(`💼 ${def.jobs} jobs`);
  if (def.tourism) lines.push('🎟️ Tourism income');
  if (def.category !== 'park' && a.access[i] < 0) lines.push('⚠️ Needs a road connected to the highway');
  if (def.residents) {
    const services = [a.health[i] ? '🏥' : null, a.safety[i] ? '🚓' : null, a.education[i] ? '🏫' : null].filter(Boolean).join(' ');
    lines.push(services ? `Services: ${services}` : 'No services nearby');
    if (a.noTransit[i] < 1) lines.push(`🚇 ${Math.round((1 - a.noTransit[i]) * 100)}% transit access`);
    if (a.pollution[i] > 0.5) lines.push(`🏭 Pollution ${a.pollution[i].toFixed(1)}`);
  }
  lines.push(`Upkeep ${formatMoney(def.upkeep || 0, c)}/mo`);
  return { title: `${def.icon} ${def.name}`, description: def.description, lines };
}

export function renderInspector(container, info, onClose) {
  container.hidden = false;
  setChildren(
    container,
    el('button', { type: 'button', class: 'icon-btn inspector-close', 'aria-label': 'Close', onclick: onClose }, icon('close', { size: 18 })),
    el('div', { class: 'inspector-title' }, info.title),
    info.description ? el('p', { class: 'muted small' }, info.description) : null,
    el('ul', {}, ...info.lines.map((l) => el('li', {}, l))),
  );
}

export function showTooltip(tooltip, x, y, title, lines) {
  tooltip.hidden = false;
  setChildren(tooltip, el('strong', {}, title), ...lines.map((l) => el('div', {}, l)));
  const pad = 16;
  const parent = tooltip.parentElement.getBoundingClientRect();
  const w = tooltip.offsetWidth;
  const h = tooltip.offsetHeight;
  tooltip.style.left = `${Math.max(6, Math.min(parent.width - w - 6, x + pad))}px`;
  tooltip.style.top = `${Math.max(6, Math.min(parent.height - h - 6, y + pad))}px`;
}

// --- toasts ----------------------------------------------------------------

const TOAST_ICONS = { info: 'info', success: 'check', warn: 'warn', event: 'zap' };

export function dismissToast(node) {
  if (!node?.isConnected || node.classList.contains('leaving')) return;
  clearTimeout(node._timer);
  node.classList.add('leaving');
  setTimeout(() => node.remove(), 300);
}

/**
 * Shows a short message. `action` adds a button ({ label, onClick }); toasts
 * with the same `key` replace each other (used for the single Undo toast).
 */
export function toast(text, kind = 'info', ms = 4200, { action, key } = {}) {
  const container = $('toasts');
  if (!container) return null;
  if (key) for (const old of container.querySelectorAll('.toast')) if (old.dataset.key === key) old.remove();
  const node = el(
    'div',
    { class: `toast toast-${kind}`, role: 'status', dataset: key ? { key } : undefined },
    el('span', { class: 'toast-icon' }, icon(TOAST_ICONS[kind] || 'info', { size: 16 })),
    el('span', { class: 'toast-text' }, text),
    action
      ? el(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-sm toast-action',
            onclick: () => {
              dismissToast(node);
              action.onClick();
            },
          },
          action.label,
        )
      : null,
  );
  container.append(node);
  const max = window.matchMedia('(min-width: 1024px)').matches ? 4 : 3;
  while (container.children.length > max) container.firstElementChild.remove();
  node._timer = setTimeout(() => dismissToast(node), ms);
  return node;
}
