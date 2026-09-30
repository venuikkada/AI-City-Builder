// App controller: start screen → AI plan → reveal → game loop.

import { fetchStatus, requestPlan, requestMissions, requestBuilding } from './api.js';
import { createGame, serializeGame, deserializeGame, addMissions, addCustomBuilding, addLog } from './game/state.js';
import { simulateMonth, getAnalysis } from './game/sim.js';
import { checkPlacement, checkBulldoze, linePath, areaTiles, previewMany, applyMany } from './game/build.js';
import { adviseCity, missionContext } from './game/advisor.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { formatMoney } from './format.js';
import * as ui from './ui.js';

const { $, el, toast } = ui;
const SAVE_KEY = 'ai-city-builder:save:v1';
const MONTH_MS = 2000;
const SPEEDS = [0, 1, 2, 4];
const ADVISOR_COOLDOWN_MS = 20_000;

const app = {
  screen: 'start',
  status: { server: false, ai: false },
  pending: null, // { prompt, plan, source, notice }
  difficulty: 'normal',
  game: null,
  tool: 'inspect',
  speedIndex: 1,
  lastSpeedIndex: 1,
  acc: 0,
  lastFrame: 0,
  advice: '',
  advisorBusy: false,
  advisorReadyAt: 0,
  hoverTile: null,
  toolbar: null,
  sidebarTab: 'missions',
  uiDirty: true,
  loadingTimer: null,
  abort: null,
};

const renderer = new Renderer($('city-canvas'));

// --- screens ---------------------------------------------------------------

function showScreen(name) {
  app.screen = name;
  for (const s of ['start', 'loading', 'reveal', 'game']) $(`screen-${s}`).hidden = s !== name;
  document.getElementById('app').dataset.screen = name;
  if (name === 'game') {
    renderer.resize();
    renderer.fitToMap();
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? deserializeGame(raw) : null;
  } catch {
    return null;
  }
}

function saveGame(quiet = true) {
  if (!app.game) return;
  try {
    localStorage.setItem(SAVE_KEY, serializeGame(app.game));
    if (!quiet) toast('💾 City saved in this browser', 'info', 2500);
  } catch {
    if (!quiet) toast('Could not save — storage is full or blocked', 'warn');
  }
}

async function initStart() {
  ui.renderChips($('prompt-chips'), (p) => {
    $('prompt-input').value = p;
    $('prompt-input').focus();
  });
  initContinueButton();
  $('prompt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = $('prompt-input').value.trim() || $('prompt-input').placeholder;
    app.difficulty = new FormData($('prompt-form')).get('difficulty') || 'normal';
    generatePlan(prompt);
  });
  app.status = await fetchStatus();
  const status = $('ai-status');
  if (app.status.ai) {
    status.textContent = `✨ Claude AI connected (${app.status.model})`;
    status.dataset.state = 'ai';
  } else if (app.status.server) {
    status.textContent = '⚙️ Offline planner — add ANTHROPIC_API_KEY on the server for full AI';
    status.dataset.state = 'offline';
  } else {
    status.textContent = '⚙️ Offline planner (static hosting)';
    status.dataset.state = 'offline';
  }
}

// --- plan generation -------------------------------------------------------

const LOADING_LINES = [
  (p) => `Reading your vision: “${p}”`,
  () => 'Surveying the land and the waterfront…',
  () => 'Zoning neighbourhoods and business districts…',
  () => 'Sketching landmarks worth a selfie…',
  () => 'Naming streets, parks and metro lines…',
  () => 'Writing your first missions…',
  () => 'Hiring a city advisor with opinions…',
];

async function generatePlan(prompt) {
  showScreen('loading');
  $('loading-title').textContent = app.status.ai ? 'Claude is designing your city…' : 'Designing your city…';
  const skip = $('loading-skip');
  skip.hidden = true;
  let step = 0;
  const line = $('loading-line');
  line.textContent = LOADING_LINES[0](prompt);
  clearInterval(app.loadingTimer);
  app.loadingTimer = setInterval(() => {
    step = (step + 1) % LOADING_LINES.length;
    line.textContent = LOADING_LINES[step](prompt);
    if (step >= 3) skip.hidden = false;
  }, 2200);
  app.abort = new AbortController();
  skip.onclick = () => app.abort.abort();
  try {
    const result = await requestPlan(prompt, { signal: app.abort.signal });
    app.pending = { prompt, ...result };
    ui.renderReveal(result.plan, result);
    showScreen('reveal');
  } catch (err) {
    showScreen('start');
    toast(err.message || 'Something went wrong', 'warn');
  } finally {
    clearInterval(app.loadingTimer);
  }
}

// --- game ------------------------------------------------------------------

function startGame(game) {
  app.game = game;
  app.tool = 'inspect';
  app.advice = '';
  app.acc = 0;
  app.speedIndex = 1;
  renderer.overlay = 'none';
  renderer.selected = null;
  showScreen('game');
  renderer.attach(game);
  rebuildToolbar();
  selectTool('inspect');
  setOverlay('none');
  setSpeed(1);
  $('inspector').hidden = true;
  app.uiDirty = true;
  refreshUi();
  saveGame();
  if (game.month === 0) toast(`Welcome to ${game.plan.cityName}! Start with streets off the ${game.plan.highwayName}.`, 'event', 6000);
}

function rebuildToolbar() {
  app.toolbar = ui.buildToolbar($('toolbar'), app.game, {
    onSelect: selectTool,
    onInvent: openInventDialog,
  });
  app.toolbar.update(app.tool);
}

function selectTool(id) {
  const game = app.game;
  app.tool = id;
  app.toolbar?.update(id);
  app.toolbar?.showInfo(id);
  renderer.preview = null;
  const def = game.defs[id];
  renderer.ghost = def ? { def, ok: true } : null;
  $('viewport').dataset.tool = def ? 'build' : id;
  updateHoverVisuals();
}

function setOverlay(name) {
  renderer.overlay = name;
  for (const b of document.querySelectorAll('#overlay-bar button')) b.classList.toggle('active', b.dataset.overlay === name);
}

function setSpeed(index) {
  app.speedIndex = index;
  if (index > 0) app.lastSpeedIndex = index;
  for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('active', Number(b.dataset.speed) === index);
}

function refreshUi() {
  const game = app.game;
  if (!game) return;
  const a = getAnalysis(game);
  ui.updateHud(game, a);
  app.toolbar?.update(app.tool);
  if (app.sidebarTab === 'missions') ui.renderMissions($('panel-missions'), game, a, { advisorBusy: app.advisorBusy, onAsk: askAdvisor });
  if (app.sidebarTab === 'advisor') ui.renderAdvisor($('panel-advisor'), game, adviseCity(game, a), app.advice);
  if (app.sidebarTab === 'budget') ui.renderBudget($('panel-budget'), game, a, { onTax: setTax });
  if (renderer.selected) ui.renderInspector($('inspector'), ui.describeTile(game, a, renderer.selected.x, renderer.selected.y), closeInspector);
  app.uiDirty = false;
}

function setTax(rate) {
  app.game.taxRate = rate;
  app.game.analysis = null;
  ui.updateHud(app.game, getAnalysis(app.game));
}

function closeInspector() {
  renderer.selected = null;
  $('inspector').hidden = true;
}

function tick() {
  const game = app.game;
  const report = simulateMonth(game);
  for (const m of report.completed) toast(`🏆 ${m.title} complete! +${formatMoney(m.reward, game.plan.currency)}`, 'success', 5000);
  for (const d of report.unlocked) toast(`🔓 Unlocked: ${d.icon} ${d.name}`, 'info');
  for (const e of report.events) toast(`⚡ ${e.title}: ${e.effectText}`, 'event', 6000);
  if (report.milestone) toast(`🎉 ${game.plan.cityName} is now a ${report.milestone.title}!`, 'success', 5000);
  for (const w of report.warnings) toast(`⚠️ ${w}`, 'warn', 5000);
  if (report.unlocked.length) rebuildToolbar();
  if (!game.missions.some((m) => m.status !== 'done') && !app.advisorBusy) askAdvisor();
  if (game.month % 6 === 0) saveGame();
  app.uiDirty = true;
}

function frame(now) {
  const dt = Math.min(0.1, (now - (app.lastFrame || now)) / 1000);
  app.lastFrame = now;
  if (app.screen === 'game' && app.game) {
    const dialogOpen = $('dialog').open;
    const speed = SPEEDS[app.speedIndex];
    if (speed > 0 && !dialogOpen) {
      app.acc += dt * 1000 * speed;
      let steps = 0;
      while (app.acc >= MONTH_MS && steps < 2) {
        app.acc -= MONTH_MS;
        tick();
        steps += 1;
      }
      if (steps === 2) app.acc = 0;
    }
    if (app.uiDirty) refreshUi();
    renderer.render(dt, getAnalysis(app.game));
  }
  requestAnimationFrame(frame);
}

// --- building actions ------------------------------------------------------

function cellsFor(tool, start, end) {
  const def = app.game.defs[tool];
  if (tool === 'bulldoze' || def?.drag === 'area') return areaTiles(start.x, start.y, end.x, end.y);
  if (def?.drag === 'line') return linePath(start.x, start.y, end.x, end.y);
  return [[end.x, end.y]];
}

function onBuildPreview(start, end) {
  const game = app.game;
  const cells = cellsFor(app.tool, start, end);
  const preview = previewMany(game, cells, app.tool);
  renderer.preview = preview.results.map((r) => ({ x: r.x, y: r.y, ok: r.ok }));
  const [sx, sy] = renderer.tileToScreen(end.x, end.y);
  const failed = preview.results.find((r) => !r.ok);
  const lines = [`${preview.count} tile${preview.count === 1 ? '' : 's'} · ${formatMoney(preview.total, game.plan.currency)}`];
  if (failed && preview.count < cells.length) lines.push(failed.reason);
  ui.showTooltip($('tooltip'), sx, sy, app.tool === 'bulldoze' ? '🧨 Bulldoze' : `${game.defs[app.tool].icon} ${game.defs[app.tool].name}`, lines);
}

function onBuildCommit(start, end) {
  const game = app.game;
  const cells = cellsFor(app.tool, start, end);
  const result = applyMany(game, cells, app.tool);
  renderer.preview = null;
  $('tooltip').hidden = true;
  if (result.count === 0) {
    if (result.lastError && result.lastError !== 'Already built here' && result.lastError !== 'Nothing to clear') toast(result.lastError, 'warn', 2500);
    return;
  }
  const def = game.defs[app.tool];
  if (def?.unique) {
    addLog(game, 'milestone', `${def.name} opens its doors!`);
    toast(`${def.icon} ${def.name} is open!`, 'success');
    selectTool('inspect');
  }
  app.uiDirty = true;
}

function onBuildCancel() {
  renderer.preview = null;
  $('tooltip').hidden = true;
}

function updateHoverVisuals(screenX, screenY) {
  const game = app.game;
  const tile = app.hoverTile;
  const def = game.defs[app.tool];
  const tooltip = $('tooltip');
  if (!tile) {
    renderer.hover = null;
    renderer.radius = null;
    tooltip.hidden = true;
    return;
  }
  renderer.hover = tile;
  renderer.radius = def && (def.radius || def.pollutionRadius) ? { x: tile.x, y: tile.y, r: def.radius || def.pollutionRadius } : null;
  if (screenX === undefined || renderer.preview) return;
  const a = getAnalysis(game);
  if (def) {
    const check = checkPlacement(game, tile.x, tile.y, app.tool);
    renderer.ghost = { def, ok: check.ok };
    ui.showTooltip(tooltip, screenX, screenY, `${def.icon} ${def.name}`, [formatMoney(check.cost, game.plan.currency), check.ok ? 'Click or drag to build' : check.reason]);
  } else if (app.tool === 'bulldoze') {
    const check = checkBulldoze(game, tile.x, tile.y);
    renderer.ghost = { def: null, ok: check.ok };
    ui.showTooltip(tooltip, screenX, screenY, '🧨 Bulldoze', [check.ok ? (check.refund ? `Refund ${formatMoney(check.refund, game.plan.currency)}` : check.cost ? `Clear trees: ${formatMoney(check.cost, game.plan.currency)}` : 'Free') : check.reason]);
  } else {
    const info = ui.describeTile(game, a, tile.x, tile.y);
    ui.showTooltip(tooltip, screenX, screenY, info.title, info.lines.slice(0, 3));
  }
}

// --- AI advisor & inventions -----------------------------------------------

async function askAdvisor() {
  const game = app.game;
  if (app.advisorBusy) return;
  if (Date.now() < app.advisorReadyAt) {
    toast(`${game.plan.advisorName} needs a moment to think. Try again shortly.`, 'info', 2500);
    return;
  }
  app.advisorBusy = true;
  app.uiDirty = true;
  const context = missionContext(game, getAnalysis(game));
  const batch = await requestMissions(context, { landmarkCount: game.plan.landmarks.length });
  app.advisorBusy = false;
  app.advisorReadyAt = Date.now() + ADVISOR_COOLDOWN_MS;
  if (app.game !== game) return;
  const added = addMissions(game, batch.missions);
  if (batch.advice) {
    app.advice = batch.advice;
    addLog(game, 'advisor', `${game.plan.advisorName}: ${batch.advice}`);
  }
  toast(added.length ? `✨ ${added.length} new mission${added.length > 1 ? 's' : ''} from ${game.plan.advisorName}` : `${game.plan.advisorName} has no new missions right now`, 'info');
  if (batch.notice) toast(batch.notice, 'warn', 4000);
  app.uiDirty = true;
}

function openDialog(title, body, actions) {
  const dialog = $('dialog');
  $('dialog-title').textContent = title;
  $('dialog-body').replaceChildren(...body);
  $('dialog-actions').replaceChildren(...actions);
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  $('dialog').close();
}

function openInventDialog() {
  const game = app.game;
  const input = el('input', { type: 'text', maxlength: 160, placeholder: 'e.g. a solar-powered biryani food court', id: 'invent-input', autocomplete: 'off' });
  const go = el('button', { type: 'submit', class: 'btn btn-primary' }, '✨ Invent it');
  const status = el('p', { class: 'muted small' }, app.status.ai ? 'Claude will design it and pick its gameplay role.' : 'The offline planner will map your idea to a building type.');
  go.onclick = async (e) => {
    e.preventDefault();
    const idea = input.value.trim();
    if (!idea) return input.focus();
    go.disabled = true;
    go.textContent = 'Designing…';
    try {
      const { building, notice } = await requestBuilding(idea, game.plan);
      const id = addCustomBuilding(game, building);
      rebuildToolbar();
      selectTool(id);
      closeDialog();
      toast(`💡 Invented ${building.icon} ${building.name}! Place it on the map.`, 'success', 5000);
      if (notice) toast(notice, 'warn', 4000);
      saveGame();
    } catch (err) {
      status.textContent = err.message;
      go.disabled = false;
      go.textContent = '✨ Invent it';
    }
  };
  openDialog(
    'Invent a building',
    [el('p', {}, 'Describe any building you can imagine. It joins your toolbox with its own name, look and bonus.'), input, status],
    [el('button', { type: 'button', class: 'btn btn-ghost', onclick: closeDialog }, 'Cancel'), go],
  );
  setTimeout(() => input.focus(), 50);
}

function openMenu() {
  const game = app.game;
  openDialog(
    game.plan.cityName,
    [
      el('p', { class: 'muted' }, `“${game.plan.prompt || game.plan.tagline}”`),
      el(
        'ul',
        { class: 'help' },
        el('li', {}, 'Drag streets off the highway, then place homes, shops and factories beside them.'),
        el('li', {}, 'Homes fill up when there are jobs and residents are happy. Keep factories away from homes.'),
        el('li', {}, 'Watch the 🚗 traffic number: upgrade red streets to avenues, add parallel roads, bus stops and metro.'),
        el('li', {}, 'Right-drag or two fingers pan, wheel or pinch zooms. Space pauses, 1–3 set speed, Esc cancels.'),
      ),
    ],
    [
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => (saveGame(false), closeDialog()) }, '💾 Save'),
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost',
          onclick: () => {
            saveGame();
            closeDialog();
            app.game = null;
            $('prompt-input').value = '';
            initContinueButton();
            showScreen('start');
          },
        },
        '🏙️ New city',
      ),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: closeDialog }, 'Back to city'),
    ],
  );
}

function initContinueButton() {
  const saved = loadSave();
  const cont = $('continue-btn');
  cont.hidden = !saved;
  if (saved) {
    cont.textContent = `▶ Continue ${saved.plan.cityName}`;
    cont.onclick = () => startGame(loadSave() || saved);
  }
}

/** Downloads the current view with a caption band — made for sharing. */
function snapshot() {
  const game = app.game;
  const a = getAnalysis(game);
  renderer.render(0, a);
  const src = renderer.canvas;
  const band = Math.round(70 * renderer.dpr);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height + band;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, src.height, out.width, band);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(20 * renderer.dpr)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${game.plan.cityName} · ${Math.round(a.population).toLocaleString('en-US')} residents · ${Math.round(a.happiness)}% happy`, 16 * renderer.dpr, src.height + 12 * renderer.dpr);
  ctx.fillStyle = '#9aa4b2';
  ctx.font = `${Math.round(14 * renderer.dpr)}px system-ui, sans-serif`;
  ctx.fillText(`“${game.plan.prompt || game.plan.tagline}” — built with AI City Builder`, 16 * renderer.dpr, src.height + 40 * renderer.dpr);
  const link = document.createElement('a');
  link.download = `${game.plan.cityName.replace(/[^\w-]+/g, '-').toLowerCase() || 'city'}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
  toast('📸 Snapshot saved — share your city!', 'success', 3000);
}

// --- wiring ----------------------------------------------------------------

new Input(renderer.canvas, renderer, {
  getTool: () => app.tool,
  isActive: () => app.screen === 'game' && !$('dialog').open,
  onHover(tile, x, y) {
    app.hoverTile = tile;
    updateHoverVisuals(x, y);
  },
  onClick(tile) {
    const game = app.game;
    renderer.selected = tile;
    ui.renderInspector($('inspector'), ui.describeTile(game, getAnalysis(game), tile.x, tile.y), closeInspector);
  },
  onBuildPreview,
  onBuildCommit,
  onBuildCancel,
  onEscape() {
    if (app.tool !== 'inspect') selectTool('inspect');
    else closeInspector();
  },
  onTogglePause() {
    setSpeed(app.speedIndex === 0 ? app.lastSpeedIndex || 1 : 0);
  },
  onSpeed: setSpeed,
  onShortcut(tool) {
    if (app.game?.defs[tool] || tool === 'bulldoze') selectTool(tool);
  },
});

$('reveal-start').addEventListener('click', () => startGame(createGame(app.pending.plan, { difficulty: app.difficulty })));
$('reveal-back').addEventListener('click', () => {
  $('prompt-input').value = app.pending?.prompt || '';
  showScreen('start');
});
$('reveal-regen').addEventListener('click', () => generatePlan(`${app.pending.prompt}`.trim()));
for (const b of document.querySelectorAll('.speed button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
for (const b of document.querySelectorAll('#overlay-bar button')) b.addEventListener('click', () => setOverlay(renderer.overlay === b.dataset.overlay ? 'none' : b.dataset.overlay));
for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => {
    app.sidebarTab = tab.dataset.tab;
    for (const t of document.querySelectorAll('.tabs button')) {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    }
    for (const p of ['missions', 'advisor', 'budget']) $(`panel-${p}`).hidden = p !== app.sidebarTab;
    app.uiDirty = true;
  });
}
$('btn-menu').addEventListener('click', openMenu);
$('btn-snapshot').addEventListener('click', snapshot);
$('stat-money').addEventListener('click', () => document.querySelector('.tabs button[data-tab="budget"]').click());
$('sheet-toggle').addEventListener('click', () => document.getElementById('app').classList.toggle('sheet-open'));
$('dialog').addEventListener('close', () => $('dialog-body').replaceChildren());
window.addEventListener('resize', () => renderer.state && renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame();
});
window.addEventListener('beforeunload', () => saveGame());


initStart();
requestAnimationFrame(frame);
