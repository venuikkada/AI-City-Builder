// DOM building blocks for the HUD and panels. AI-generated text is only ever
// inserted as text nodes, never as HTML.

import { CATEGORIES, BONUSES, milestoneFor, nextMilestone } from './shared/catalog.js';
import { OBJECTIVES } from './shared/plan.js';
import { missionStatus, describeObjective } from './game/missions.js';
import { dateLabel } from './game/state.js';
import { formatMoney, formatSignedMoney, formatNumber, percent } from './format.js';

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

/** One-line gameplay summary of a building definition. */
export function statsLine(def, currency) {
  const parts = [`${formatMoney(def.cost, currency)}`];
  if (def.upkeep) parts.push(`${formatMoney(def.upkeep, currency)}/mo`);
  if (def.residents) parts.push(`${def.residents} residents`);
  if (def.jobs) parts.push(`${def.jobs} jobs`);
  if (def.capacity) parts.push(`${def.capacity} cars`);
  if (def.service) parts.push(`${def.service} r${def.radius}`);
  if (def.transit) parts.push(`${Math.round(def.transit * 100)}% ride transit (r${def.radius})`);
  if (def.happiness) parts.push(`+${def.happiness} happiness (r${def.radius || 3})`);
  if (def.pollution && def.pollution >= 1) parts.push('pollutes');
  if (def.absorb) parts.push('cleans air');
  if (def.tourism) parts.push(`tourism`);
  if (def.bonus && def.bonus !== 'none') parts.push(`${BONUSES[def.bonus].label} bonus`);
  return parts.join(' · ');
}

// --- start & reveal -------------------------------------------------------

export const EXAMPLE_PROMPTS = [
  'Build a futuristic Hyderabad.',
  'A green, car-free Bengaluru garden city',
  'Cyberpunk Mumbai by the sea',
  'Heritage Jaipur with a modern metro',
  'A solar-powered desert oasis',
  'Tokyo in the year 2099',
];

export function renderChips(container, onPick) {
  setChildren(container,
    ...EXAMPLE_PROMPTS.map((p) => el('button', { type: 'button', class: 'chip', onclick: () => onPick(p) }, p)),
  );
}

export function renderReveal(plan, meta) {
  $('reveal-name').textContent = plan.cityName;
  $('reveal-tagline').textContent = plan.tagline;
  $('reveal-vision').textContent = plan.vision;
  $('reveal-source').textContent = meta.source === 'ai' ? '✨ Designed by Claude' : '⚙️ Offline planner';
  $('reveal-source').className = `badge ${meta.source === 'ai' ? 'badge-ai' : ''}`;
  $('reveal-style').textContent = `${plan.style} · ${plan.terrain.water === 'none' ? 'dry land' : plan.terrain.water}`;
  const notice = $('reveal-notice');
  notice.hidden = !meta.notice;
  notice.textContent = meta.notice || '';
  $('reveal-landmarks').replaceChildren(
    ...plan.landmarks.map((l) =>
      el(
        'li',
        { class: 'landmark' },
        el('span', { class: 'landmark-icon' }, l.icon),
        el('div', {}, el('strong', {}, l.name), el('p', {}, l.description), el('small', {}, `${l.effect[0].toUpperCase()}${l.effect.slice(1)} · unlocks at ${formatNumber(l.unlockPopulation)} people`)),
      ),
    ),
  );
  $('reveal-missions').replaceChildren(
    ...plan.missions.map((m) => el('li', {}, el('strong', {}, m.title), ' — ', m.description || describeObjective(m, null, plan.currency))),
  );
  $('reveal-buildings').replaceChildren(
    ...Object.values(plan.names).map((n) => el('li', { class: 'building-chip', title: n.description }, el('span', {}, n.icon), n.name)),
  );
}

// --- toolbar ---------------------------------------------------------------

const TOOL_GROUPS = [
  ['road', ['road', 'avenue']],
  ['residential', ['house', 'apartment', 'tower']],
  ['commercial', ['shop', 'office']],
  ['industrial', ['factory', 'techpark']],
  ['service', ['school', 'hospital', 'police']],
  ['transit', ['bus', 'metro']],
  ['park', ['park', 'plaza']],
];

export function buildToolbar(container, game, handlers) {
  const currency = game.plan.currency;
  const buttons = new Map();
  const info = el('div', { class: 'tool-info', id: 'tool-info' });

  const makeButton = (id, icon, name, sub) => {
    const btn = el(
      'button',
      {
        type: 'button',
        class: 'tool',
        dataset: { tool: id },
        onclick: () => handlers.onSelect(id),
        onmouseenter: () => showInfo(id),
        onfocus: () => showInfo(id),
      },
      el('span', { class: 'tool-icon' }, icon),
      el('span', { class: 'tool-text' }, el('span', { class: 'tool-name' }, name), el('span', { class: 'tool-sub' }, sub)),
    );
    buttons.set(id, btn);
    return btn;
  };

  const showInfo = (id) => {
    const def = game.defs[id];
    if (!def) {
      setChildren(info,
        el('strong', {}, id === 'bulldoze' ? 'Bulldoze' : 'Inspect'),
        el('p', {}, id === 'bulldoze' ? 'Drag to clear buildings, roads or trees. Same-month demolitions refund half the cost.' : 'Drag to move the map, click a tile to see details. Right-drag always pans.'),
      );
      return;
    }
    const locked = (def.unlock || 0) > game.maxPop;
    setChildren(info,
      el('strong', {}, `${def.icon} ${def.name}`),
      el('p', {}, def.description),
      el('small', {}, statsLine(def, currency)),
      locked ? el('small', { class: 'locked-note' }, `🔒 Unlocks at ${formatNumber(def.unlock)} population`) : null,
    );
  };

  const groups = [
    el('div', { class: 'tool-group tool-group-basic' }, makeButton('inspect', '🔍', 'Inspect', 'Pan & info'), makeButton('bulldoze', '🧨', 'Bulldoze', 'Clear tiles')),
  ];
  for (const [category, ids] of TOOL_GROUPS) {
    groups.push(
      el(
        'div',
        { class: 'tool-group' },
        el('div', { class: 'tool-group-title' }, `${CATEGORIES[category].icon} ${CATEGORIES[category].label}`),
        ...ids.map((id) => makeButton(id, game.defs[id].icon, game.defs[id].name, formatMoney(game.defs[id].cost, currency))),
        ...game.custom.filter((c) => game.defs[c.id].category === category).map((c) => makeButton(c.id, game.defs[c.id].icon, game.defs[c.id].name, `★ ${formatMoney(game.defs[c.id].cost, currency)}`)),
      ),
    );
  }
  groups.push(
    el(
      'div',
      { class: 'tool-group' },
      el('div', { class: 'tool-group-title' }, `${CATEGORIES.landmark.icon} Landmarks`),
      ...game.plan.landmarks.map((l) => makeButton(l.id, l.icon, l.name, formatMoney(game.defs[l.id].cost, currency))),
    ),
    el(
      'div',
      { class: 'tool-group' },
      el('div', { class: 'tool-group-title' }, '✨ Invent'),
      el('button', { type: 'button', class: 'tool tool-invent', onclick: handlers.onInvent }, el('span', { class: 'tool-icon' }, '💡'), el('span', { class: 'tool-text' }, el('span', { class: 'tool-name' }, 'Invent a building'), el('span', { class: 'tool-sub' }, 'Describe it, AI designs it'))),
    ),
  );
  setChildren(container, el('div', { class: 'tool-scroll' }, ...groups), info);
  showInfo('inspect');

  return {
    update(selected) {
      for (const [id, btn] of buttons) {
        const def = game.defs[id];
        const locked = def ? (def.unlock || 0) > game.maxPop : false;
        const built = def?.unique && game.tiles.some((t) => t && t.d === id);
        btn.classList.toggle('active', id === selected);
        btn.classList.toggle('locked', locked);
        btn.classList.toggle('built', Boolean(built));
        btn.setAttribute('aria-pressed', String(id === selected));
        if (def) {
          const sub = btn.querySelector('.tool-sub');
          sub.textContent = locked ? `🔒 ${formatNumber(def.unlock)} pop` : built ? '✓ Built' : `${def.custom ? '★ ' : ''}${formatMoney(def.cost, currency)}`;
        }
      }
    },
    showInfo,
  };
}

// --- HUD -------------------------------------------------------------------

export function updateHud(game, a) {
  const currency = game.plan.currency;
  $('hud-name').textContent = game.plan.cityName;
  $('hud-milestone').textContent = milestoneFor(Math.max(game.maxPop, a.population)).title;
  $('hud-date').textContent = dateLabel(game);
  $('hud-money').textContent = formatMoney(game.money, currency);
  $('hud-money').classList.toggle('negative', game.money < 0);
  const net = $('hud-net');
  net.textContent = `${formatSignedMoney(a.budget.net, currency)}/mo`;
  net.classList.toggle('negative', a.budget.net < 0);
  $('hud-pop').textContent = formatNumber(a.population);
  $('hud-jobs').textContent = formatNumber(a.jobs);
  $('hud-happy').textContent = percent(a.happiness / 100);
  $('hud-happy-icon').textContent = a.happiness >= 70 ? '😄' : a.happiness >= 50 ? '🙂' : a.happiness >= 35 ? '😐' : '😠';
  const traffic = $('hud-traffic');
  traffic.textContent = percent(a.congestion);
  traffic.parentElement.dataset.level = a.congestion > 0.6 ? 'bad' : a.congestion > 0.35 ? 'warn' : 'good';
  const next = nextMilestone(Math.max(game.maxPop, a.population));
  $('hud-milestone').title = next ? `Next: ${next.title} at ${formatNumber(next.pop)}` : 'Top milestone reached';
}

// --- missions --------------------------------------------------------------

function formatMissionValue(m, value, currency) {
  const spec = OBJECTIVES[m.objective];
  if (spec.money) return formatMoney(value, currency);
  if (spec.unit === '%') return `${Math.round(value)}%`;
  return formatNumber(value);
}

export function renderMissions(container, game, a, { advisorBusy, onAsk }) {
  const currency = game.plan.currency;
  const active = game.missions.filter((m) => m.status === 'active');
  const queued = game.missions.filter((m) => m.status === 'queued');
  const done = game.missions.filter((m) => m.status === 'done');
  const cards = active.map((m) => {
    const s = missionStatus(game, a, m);
    const spec = OBJECTIVES[m.objective];
    const valueText = spec.cmp === '<=' ? `now ${formatMissionValue(m, s.value, currency)}` : `${formatMissionValue(m, s.value, currency)} / ${formatMissionValue(m, m.target, currency)}`;
    const bar = el('div', { class: 'bar' });
    bar.style.width = `${Math.round(s.progress * 100)}%`;
    return el(
      'article',
      { class: 'mission' },
      el('header', {}, el('span', { class: 'm-title' }, m.title), el('span', { class: 'm-reward' }, `+${formatMoney(m.reward, currency)}`)),
      m.description ? el('p', { class: 'm-desc' }, m.description) : null,
      el('div', { class: 'm-goal' }, describeObjective(m, game.defs, currency)),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(s.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
      el('div', { class: 'm-value' }, s.gateMet || !m.minPopulation ? valueText : `needs ${formatNumber(m.minPopulation)} residents first`),
    );
  });
  const advisorName = game.plan.advisorName;
  const completedOpen = Boolean(container.querySelector('details.done-list')?.open);
  setChildren(container,
    el('div', { class: 'panel-head' }, el('h3', {}, 'Missions'), el('span', { class: 'muted' }, `${done.length} done${queued.length ? ` · ${queued.length} queued` : ''}`)),
    ...(cards.length ? cards : [el('p', { class: 'empty' }, 'All missions complete! Ask your advisor for more.')]),
    el(
      'button',
      { type: 'button', class: 'btn btn-ai btn-block', disabled: advisorBusy, onclick: onAsk },
      advisorBusy ? `${advisorName} is thinking…` : `✨ Ask ${advisorName} for new missions`,
    ),
    done.length
      ? el(
          'details',
          { class: 'done-list', open: completedOpen },
          el('summary', {}, `Completed (${done.length})`),
          el('ul', {}, ...done.slice().reverse().map((m) => el('li', {}, `✅ ${m.title} `, el('span', { class: 'muted' }, `+${formatMoney(m.reward, currency)}`)))),
        )
      : null,
  );
}

// --- advisor ---------------------------------------------------------------

export function renderAdvisor(container, game, tips, advice) {
  const news = game.log.slice(-14).reverse();
  const icons = { mission: '🏆', event: '⚡', unlock: '🔓', milestone: '🎉', warning: '⚠️', advisor: '💬' };
  setChildren(container,
    el(
      'div',
      { class: 'advisor-card' },
      el('div', { class: 'avatar' }, STYLE_AVATARS[game.plan.style] || '🤖'),
      el('div', {}, el('div', { class: 'advisor-name' }, game.plan.advisorName), el('p', { class: 'advisor-text' }, advice || game.plan.advisorIntro)),
    ),
    el('h4', {}, 'Right now'),
    el('ul', { class: 'tips' }, ...tips.map((t) => el('li', { class: `tip tip-${t.level}` }, t.text))),
    el('h4', {}, 'City news'),
    el('ul', { class: 'news' }, ...news.map((n) => el('li', {}, el('span', { class: 'news-icon' }, icons[n.kind] || '•'), n.text))),
  );
}

// --- budget ----------------------------------------------------------------

function sparkline(canvas, values, color, fromZero) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 240;
  const h = canvas.clientHeight || 48;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const min = fromZero ? Math.min(0, ...values) : Math.min(...values);
  const max = Math.max(...values, min + 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
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
    const totalRow = el('tr', { class: 'total' }, el('td', {}, 'Profit'), rows.net);
    const tax = el('input', { type: 'range', min: 0, max: 20, step: 1, id: 'tax-slider', 'aria-label': 'Tax rate' });
    const taxOut = el('output', { for: 'tax-slider' });
    tax.addEventListener('input', () => {
      taxOut.textContent = `${tax.value}%`;
      onTax(Number(tax.value));
    });
    const bar = (cls) => el('div', { class: `bar ${cls}` });
    const homesBar = bar('bar-homes');
    const jobsBar = bar('bar-jobs');
    const popChart = el('canvas', { class: 'spark', 'aria-label': 'Population history' });
    const moneyChart = el('canvas', { class: 'spark', 'aria-label': 'Treasury history' });
    setChildren(
      container,
      el('div', { class: 'panel-head' }, el('h3', {}, 'Monthly budget')),
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
      el('label', { class: 'tax-label', for: 'tax-slider' }, 'Tax rate ', taxOut),
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
  r.rows.resTax.textContent = formatSignedMoney(b.resTax, c);
  r.rows.bizTax.textContent = formatSignedMoney(b.bizTax, c);
  r.rows.tourism.textContent = formatSignedMoney(b.tourism, c);
  r.rows.upkeep.textContent = formatSignedMoney(-b.upkeep, c);
  r.rows.net.textContent = formatSignedMoney(b.net, c);
  r.totalRow.classList.toggle('negative', b.net < 0);
  if (document.activeElement !== r.tax) r.tax.value = String(game.taxRate);
  r.taxOut.textContent = `${game.taxRate}%`;
  r.homesBar.style.width = `${Math.round(a.demand.homes * 100)}%`;
  r.jobsBar.style.width = `${Math.round(a.demand.jobs * 100)}%`;
  if (r.historyLength !== game.history.length) {
    r.historyLength = game.history.length;
    sparkline(r.popChart, game.history.map((h) => h.pop), '#4cc9f0', true);
    sparkline(r.moneyChart, game.history.map((h) => h.money), '#f9c74f', false);
  }
}

// --- inspector & tooltip ----------------------------------------------------

export function describeTile(game, a, x, y) {
  const i = y * game.size + x;
  const t = game.tiles[i];
  const c = game.plan.currency;
  const terrain = ['Grassland', 'Water', 'Forest', 'Beach'][game.terrain[i]] || 'Land';
  if (!t) return { title: terrain, lines: [game.terrain[i] === 2 ? 'Building here clears the trees.' : 'Empty land.'] };
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
  if (def.tourism) lines.push(`🎟️ Tourism income`);
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
  setChildren(container,
    el('button', { type: 'button', class: 'icon-btn close', 'aria-label': 'Close', onclick: onClose }, '✕'),
    el('strong', {}, info.title),
    info.description ? el('p', { class: 'muted small' }, info.description) : null,
    el('ul', {}, ...info.lines.map((l) => el('li', {}, l))),
  );
}

export function showTooltip(tooltip, x, y, title, lines) {
  tooltip.hidden = false;
  setChildren(tooltip, el('strong', {}, title), ...lines.map((l) => el('div', {}, l)));
  const pad = 14;
  const parent = tooltip.parentElement.getBoundingClientRect();
  const w = tooltip.offsetWidth;
  const h = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(parent.width - w - 6, x + pad)}px`;
  tooltip.style.top = `${Math.min(parent.height - h - 6, y + pad)}px`;
}

// --- toasts ----------------------------------------------------------------

export function toast(text, kind = 'info', ms = 4200) {
  const container = $('toasts');
  if (!container) return;
  const node = el('div', { class: `toast toast-${kind}`, role: 'status' }, text);
  container.append(node);
  while (container.children.length > 4) container.firstChild.remove();
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 400);
  }, ms);
}
