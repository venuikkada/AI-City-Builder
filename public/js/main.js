// App controller: start screen → AI plan → reveal → game loop.

import { fetchStatus, requestPlan, requestMissions, requestBuilding } from './api.js';
import { createGame, serializeGame, deserializeGame, addMissions, addCustomBuilding, addLog } from './game/state.js';
import { simulateMonth, getAnalysis } from './game/sim.js';
import { checkPlacement, checkBulldoze, linePath, areaTiles, previewMany, applyMany, undoBuild } from './game/build.js';
import { adviseCity, missionContext } from './game/advisor.js';
import { milestoneFor } from './shared/catalog.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { BackgroundCity } from './demo.js';
import { formatMoney, formatNumber } from './format.js';
import { icon, hydrateIcons } from './icons.js';
import * as ui from './ui.js';

const { $, el, toast, setChildren } = ui;
const SAVE_KEY = 'ai-city-builder:save:v1';
const MONTH_MS = 2000;
const SPEEDS = [0, 1, 2, 4];
const SPEED_ICONS = ['pause', 'play', 'fast', 'fastest'];
const SPEED_LABELS = ['Paused', '1×', '2×', '4×'];
const ADVISOR_COOLDOWN_MS = 20_000;
// Expected while painting over existing tiles with the mouse, so not worth a toast.
const QUIET_ERRORS = new Set(['Already built here', 'Nothing to clear']);
const desktopQuery = window.matchMedia('(min-width: 1024px)');
const isDesktop = () => desktopQuery.matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  buildMenu: null,
  infoTab: 'missions',
  sheet: null, // 'build' | 'info' | null (phones and tablets)
  touchBuild: null, // { start, end } while placing a road or zone with taps
  lastUndo: null,
  pointer: window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
  unseenMissions: 0,
  advisorUnseen: false,
  warnKey: '',
  uiDirty: true,
  loadingTimer: null,
  abort: null,
};

const renderer = new Renderer($('city-canvas'));
const background = new BackgroundCity($('bg-canvas'));

// --- screens & layout --------------------------------------------------------

function showScreen(name) {
  app.screen = name;
  for (const s of ['start', 'loading', 'reveal', 'game']) $(`screen-${s}`).hidden = s !== name;
  $('app').dataset.screen = name;
  if (name === 'game') {
    background.stop();
    renderer.resize();
    updateLayout();
  } else {
    background.start();
    updateBackgroundInsets();
  }
}

/** Keeps the demo city visible above (phones) or beside (desktop) the start panel. */
function updateBackgroundInsets() {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (app.screen === 'start') {
    const screen = $('app').getBoundingClientRect();
    const panel = document.querySelector('.start-panel').getBoundingClientRect();
    if (panel.width > screen.width * 0.7) insets.bottom = Math.max(0, screen.bottom - panel.top);
    else insets.left = Math.max(0, panel.right - screen.left);
  }
  background.setInsets(insets);
}

/** Measures the HUD, dock and side panels so the map centres in the space between them. */
function updateLayout() {
  if (app.screen !== 'game') return;
  const screen = $('screen-game');
  const rect = screen.getBoundingClientRect();
  const hudBottom = Math.max(0, $('hud').getBoundingClientRect().bottom - rect.top);
  const dock = $('dock');
  const dockHeight = dock.offsetParent ? Math.max(0, rect.bottom - dock.getBoundingClientRect().top) : 0;
  screen.style.setProperty('--hud-bottom', `${Math.round(hudBottom)}px`);
  screen.style.setProperty('--dock-h', `${Math.round(dockHeight)}px`);
  const insets = { top: hudBottom, right: 0, bottom: dockHeight, left: 0 };
  if (isDesktop()) {
    insets.left = Math.max(0, $('build-panel').getBoundingClientRect().right - rect.left);
    insets.right = Math.max(0, rect.right - $('info-panel').getBoundingClientRect().left);
  }
  renderer.setInsets(insets);
}

function onResize() {
  if (app.screen === 'game') {
    renderer.resize();
    updateLayout();
    if (isDesktop() && app.sheet) openSheet(null);
    app.uiDirty = true;
  } else {
    updateBackgroundInsets();
  }
}

// --- saves -----------------------------------------------------------------

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
    if (!quiet) toast('City saved in this browser', 'success', 2500);
  } catch {
    if (!quiet) toast('Could not save: storage is full or blocked', 'warn');
  }
}

function initContinueButton() {
  const saved = loadSave();
  const cont = $('continue-btn');
  cont.hidden = !saved;
  if (saved) {
    setChildren(cont, icon('play', { size: 16 }), `Continue ${saved.plan.cityName}`);
    cont.onclick = () => startGame(loadSave() || saved);
  }
}

// --- start screen --------------------------------------------------------------

function setAiStatus(text, state, title = '') {
  const status = $('ai-status');
  status.textContent = text;
  status.dataset.state = state;
  status.title = title;
}

async function initStart() {
  hydrateIcons();
  ui.renderChips($('prompt-chips'), (prompt) => {
    $('prompt-input').value = prompt;
    background.show(prompt);
    // Focusing would pop up the keyboard on phones, where the next tap is "Generate".
    if (app.pointer === 'mouse') $('prompt-input').focus({ preventScroll: true });
  });
  initContinueButton();
  const form = $('prompt-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = $('prompt-input').value.trim() || $('prompt-input').placeholder;
    app.difficulty = new FormData(form).get('difficulty') || 'normal';
    generatePlan(prompt);
  });
  $('prompt-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else $('generate-btn').click();
    }
  });
  let typing;
  $('prompt-input').addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => background.show($('prompt-input').value), 700);
  });
  showScreen('start');
  app.status = await fetchStatus();
  if (app.status.ai) setAiStatus('Claude AI is online', 'ai', app.status.model || '');
  else setAiStatus(app.status.server ? 'Offline planner (AI not configured)' : 'Offline planner', 'offline');
}

// --- plan generation -------------------------------------------------------

async function generatePlan(prompt) {
  showScreen('loading');
  background.show(prompt);
  $('loading-title').textContent = app.status.ai ? 'Claude is designing your city' : 'Designing your city';
  $('loading-prompt').textContent = `“${prompt}”`;
  const steps = $('loading-steps');
  const skip = $('loading-skip');
  skip.hidden = true;
  let step = 0;
  ui.renderLoadingSteps(steps, step);
  const started = Date.now();
  clearInterval(app.loadingTimer);
  app.loadingTimer = setInterval(
    () => {
      if (step < ui.LOADING_STEPS.length - 1) ui.renderLoadingSteps(steps, ++step);
      if (app.status.ai && Date.now() - started > 8000) skip.hidden = false;
    },
    app.status.ai ? 2600 : 180,
  );
  app.abort = new AbortController();
  skip.onclick = () => app.abort.abort();
  try {
    // The offline planner answers instantly; a short beat lets the checklist play.
    const [result] = await Promise.all([requestPlan(prompt, { signal: app.abort.signal }), wait(app.status.ai ? 0 : 1200)]);
    clearInterval(app.loadingTimer);
    ui.renderLoadingSteps(steps, ui.LOADING_STEPS.length);
    await wait(300);
    app.pending = { prompt, ...result };
    ui.renderReveal(result.plan, result);
    // The offline planner is deterministic, so only AI plans can be re-rolled.
    $('reveal-regen').hidden = result.source !== 'ai';
    document.querySelector('.reveal-scroll').scrollTop = 0;
    showScreen('reveal');
  } catch (err) {
    showScreen('start');
    setAiStatus(err.message || 'Something went wrong. Please try again.', 'error');
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
  app.touchBuild = null;
  app.lastUndo = null;
  app.warnKey = '';
  app.advisorUnseen = false;
  app.unseenMissions = game.month === 0 ? game.missions.filter((m) => m.status === 'active').length : 0;
  renderer.overlay = 'none';
  renderer.selected = null;
  renderer.preview = null;
  showScreen('game');
  ui.updateHud(game, getAnalysis(game));
  updateLayout();
  renderer.attach(game);
  rebuildBuildMenu('road');
  selectTool('inspect');
  setOverlay('none');
  setSpeed(1);
  setInfoTab('missions');
  openSheet(null);
  toggleLayers(false);
  closeInspector();
  app.uiDirty = true;
  refreshUi();
  saveGame();
  if (game.month === 0) {
    toast(`Welcome, Mayor! Start with streets off the ${game.plan.highwayName}.`, 'event', 9000, {
      key: 'welcome',
      action: { label: 'Build', onClick: () => pickTool('road') },
    });
  }
}

function rebuildBuildMenu(category = app.buildMenu?.category) {
  app.buildMenu = ui.createBuildMenu({ tabs: $('category-tabs'), grid: $('tool-grid'), info: $('tool-info') }, app.game, {
    category,
    selected: app.tool,
    onSelect: pickTool,
    onInvent: openInventDialog,
  });
}

/** Tool chosen from a menu: select it and get the sheet out of the way on phones. */
function pickTool(id) {
  if (!app.game) return;
  if (app.game.defs[id]) app.buildMenu?.setCategory(ui.tabFor(app.game, id));
  selectTool(id);
  if (app.tool === id && !isDesktop()) openSheet(null);
}

function selectTool(id) {
  const game = app.game;
  const def = game.defs[id];
  if (def && ui.isLocked(game, def)) {
    toast(`${def.icon} ${def.name} unlocks at ${formatNumber(def.unlock)} population`, 'info', 2600);
    return;
  }
  if (def && ui.isBuilt(game, def)) {
    toast(`${def.icon} ${def.name} is already built`, 'info', 2200);
    return;
  }
  app.tool = id;
  cancelTouchBuild();
  if (id !== 'inspect') dismissToasts('welcome');
  app.buildMenu?.update(id);
  renderer.ghost = def ? { def, ok: true } : null;
  $('screen-game').dataset.tool = def ? 'build' : id;
  if (id !== 'inspect') closeInspector();
  updateDock();
  updateHoverVisuals();
}

function toolHint(id) {
  const touch = app.pointer === 'touch';
  if (id === 'bulldoze') return touch ? 'Tap two corners to clear' : 'Drag to clear an area';
  const def = app.game.defs[id];
  const cost = formatMoney(def.cost, app.game.plan.currency);
  if (def.drag === 'line') return touch ? `${cost}/tile · tap start, then end` : `${cost}/tile · drag to draw`;
  if (def.drag === 'area') return touch ? `${cost}/tile · tap two corners` : `${cost}/tile · drag to fill`;
  return touch ? `${cost} · tap to place` : `${cost} · click to place`;
}

function updateDock() {
  const tool = app.tool;
  for (const b of document.querySelectorAll('[data-tool-btn]')) b.classList.toggle('active', b.dataset.toolBtn === tool);
  const building = tool !== 'inspect';
  $('dock-main').hidden = building;
  $('dock-tool').hidden = !building;
  if (!building) return;
  const def = app.game.defs[tool];
  $('dock-tool-icon').replaceChildren(def ? document.createTextNode(def.icon) : icon('bulldoze', { size: 24 }));
  $('dock-tool-name').textContent = def ? def.name : 'Clear';
  $('dock-tool-hint').textContent = toolHint(tool);
}

// --- sheets, tabs, layers --------------------------------------------------------

function openSheet(name) {
  if (isDesktop()) name = null; // side panels are always visible on desktop
  app.sheet = name;
  $('screen-game').dataset.sheet = name || '';
  $('sheet-backdrop').hidden = !name;
  if (name) {
    toggleLayers(false);
    $('tooltip').hidden = true;
  }
  if (name === 'build' && app.buildMenu && app.game.defs[app.tool]) app.buildMenu.setCategory(ui.tabFor(app.game, app.tool));
  markInfoSeen();
  app.uiDirty = true;
}

function infoVisible() {
  return isDesktop() || app.sheet === 'info';
}

function setInfoTab(name) {
  app.infoTab = name;
  for (const t of document.querySelectorAll('#info-panel [role="tab"]')) {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  }
  for (const p of ['missions', 'advisor', 'budget']) $(`panel-${p}`).hidden = p !== name;
  markInfoSeen();
  app.uiDirty = true;
}

function openInfo(name) {
  setInfoTab(name);
  openSheet('info');
}

function markInfoSeen() {
  if (app.game && infoVisible()) {
    if (app.infoTab === 'missions') app.unseenMissions = 0;
    if (app.infoTab === 'advisor') app.advisorUnseen = false;
  }
  updateBadges();
}

function updateBadges() {
  const n = app.unseenMissions;
  for (const id of ['missions-badge', 'fab-missions-badge']) {
    const badge = $(id);
    badge.hidden = !n;
    badge.textContent = String(n);
  }
  $('fab-advisor-dot').hidden = !app.advisorUnseen;
}

function toggleLayers(force) {
  const pop = $('layers-pop');
  const open = typeof force === 'boolean' ? force : pop.hidden;
  pop.hidden = !open;
  $('btn-layers').setAttribute('aria-expanded', String(open));
}

function setOverlay(name) {
  renderer.overlay = name;
  for (const b of document.querySelectorAll('#overlay-bar button')) b.classList.toggle('active', b.dataset.overlay === name);
  ui.renderLegend($('legend'), name);
  $('btn-layers').classList.toggle('active', name !== 'none');
  $('overlay-chip').hidden = name === 'none';
  if (name !== 'none') {
    $('overlay-chip-text').textContent = ui.LAYERS[name].label;
    $('overlay-chip-scale').style.background = ui.legendGradient(name);
  }
}

function setSpeed(index) {
  app.speedIndex = index;
  if (index > 0) app.lastSpeedIndex = index;
  for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('active', Number(b.dataset.speed) === index);
  const cycle = $('speed-cycle');
  setChildren(cycle, icon(SPEED_ICONS[index], { size: 18 }), index ? el('span', {}, SPEED_LABELS[index]) : null);
  cycle.classList.toggle('paused', index === 0);
  cycle.setAttribute('aria-label', `Game speed: ${SPEED_LABELS[index]}. Tap to change.`);
}

// --- per-frame UI ------------------------------------------------------------------

function refreshUi() {
  const game = app.game;
  if (!game) return;
  const a = getAnalysis(game);
  ui.updateHud(game, a);
  app.buildMenu?.update(app.tool);
  if (infoVisible()) {
    if (app.infoTab === 'missions') ui.renderMissions($('panel-missions'), game, a, { advisorBusy: app.advisorBusy, onAsk: askAdvisor });
    if (app.infoTab === 'advisor') ui.renderAdvisor($('panel-advisor'), game, adviseCity(game, a), app.advice);
    if (app.infoTab === 'budget') ui.renderBudget($('panel-budget'), game, a, { onTax: setTax });
  }
  if (renderer.selected && !$('inspector').hidden) showInspector();
  if (app.touchBuild) updateTouchPreview();
  updateBadges();
  app.uiDirty = false;
}

function setTax(rate) {
  app.game.taxRate = rate;
  app.game.analysis = null;
  ui.updateHud(app.game, getAnalysis(app.game));
}

function showInspector() {
  const game = app.game;
  const { x, y } = renderer.selected;
  ui.renderInspector($('inspector'), ui.describeTile(game, getAnalysis(game), x, y), closeInspector);
}

function closeInspector() {
  renderer.selected = null;
  $('inspector').hidden = true;
}

function tick() {
  const game = app.game;
  const c = game.plan.currency;
  const activeBefore = new Set(game.missions.filter((m) => m.status === 'active').map((m) => m.id));
  const report = simulateMonth(game);
  for (const m of report.completed) toast(`🏆 ${m.title} complete! +${formatMoney(m.reward, c)}`, 'success', 5000);
  for (const d of report.unlocked) {
    toast(`Unlocked ${d.icon} ${d.name}`, 'event', 5500, { action: { label: 'Build', onClick: () => pickTool(d.id) } });
  }
  for (const e of report.events) toast(`${e.title}: ${e.effectText}`, 'event', 6000);
  if (report.milestone) toast(`🎉 ${game.plan.cityName} is now a ${report.milestone.title}!`, 'success', 5000);
  for (const w of report.warnings) toast(w, 'warn', 5000);
  if (report.unlocked.length) rebuildBuildMenu();
  // Undo only works within the month it was built.
  if (app.lastUndo && app.lastUndo.month !== game.month) {
    app.lastUndo = null;
    dismissUndoToast();
  }
  app.unseenMissions += game.missions.filter((m) => m.status === 'active' && !activeBefore.has(m.id)).length;
  // New problems spotted by the advisor light up its button.
  const warnKey = adviseCity(game, getAnalysis(game))
    .filter((t) => t.level === 'warn')
    .map((t) => t.text.replace(/\d+/g, '#'))
    .join('|');
  if (warnKey && warnKey !== app.warnKey) app.advisorUnseen = true;
  app.warnKey = warnKey;
  markInfoSeen();
  // Out of missions? Quietly ask the advisor for more (respecting the cooldown).
  if (!game.missions.some((m) => m.status !== 'done') && !app.advisorBusy && Date.now() >= app.advisorReadyAt) askAdvisor();
  if (game.month % 6 === 0) saveGame();
  app.uiDirty = true;
}

function frame(now) {
  // Schedule first so an unexpected error in one frame can't stop the game.
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (app.lastFrame || now)) / 1000);
  app.lastFrame = now;
  if (app.screen === 'game' && app.game) {
    const speed = SPEEDS[app.speedIndex];
    if (speed > 0 && !$('dialog').open) {
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
}

// --- building ------------------------------------------------------------------------

function cellsFor(tool, start, end) {
  const def = app.game.defs[tool];
  if (tool === 'bulldoze' || def?.drag === 'area') return areaTiles(start.x, start.y, end.x, end.y);
  if (def?.drag === 'line') return linePath(start.x, start.y, end.x, end.y);
  return [[end.x, end.y]];
}

/** Applies the current tool and offers Undo. Returns whether anything changed. */
function commitBuild(cells, { quiet = false } = {}) {
  const game = app.game;
  const tool = app.tool;
  const c = game.plan.currency;
  const result = applyMany(game, cells, tool);
  renderer.preview = null;
  $('tooltip').hidden = true;
  if (!result.count) {
    if (result.lastError && !(quiet && QUIET_ERRORS.has(result.lastError))) toast(result.lastError, 'warn', 2500);
    return false;
  }
  const def = game.defs[tool];
  app.lastUndo = result.undo;
  const what = def ? `${def.icon} ${def.name}${result.count > 1 ? ` ×${result.count}` : ''}` : `Cleared ${result.count} tile${result.count === 1 ? '' : 's'}`;
  const money = result.spent > 0 ? ` · ${formatMoney(result.spent, c)}` : result.spent < 0 ? ` · refund ${formatMoney(-result.spent, c)}` : '';
  toast(`${what}${money}`, 'info', 4500, { key: 'undo', action: { label: 'Undo', onClick: undoLast } });
  if (def?.unique) {
    addLog(game, 'milestone', `${def.name} opens its doors!`);
    toast(`${def.icon} ${def.name} is open!`, 'success', 5000);
    selectTool('inspect');
  }
  app.uiDirty = true;
  return true;
}

function dismissToasts(key) {
  for (const t of document.querySelectorAll('#toasts .toast')) if (t.dataset.key === key) ui.dismissToast(t);
}

const dismissUndoToast = () => dismissToasts('undo');

function undoLast() {
  const game = app.game;
  const undo = app.lastUndo;
  app.lastUndo = null;
  dismissUndoToast();
  if (!game || !undo) return;
  if (!undoBuild(game, undo)) {
    toast('Too late to undo: a month has passed', 'warn', 2500);
    return;
  }
  app.uiDirty = true;
  toast('Undone', 'info', 1500);
}

/** Touch: taps inspect, place single buildings, or mark the ends of a road or zone. */
function onTap(tile) {
  const game = app.game;
  toggleLayers(false);
  if (app.tool === 'inspect') {
    renderer.selected = tile;
    showInspector();
    return;
  }
  const def = game.defs[app.tool];
  if (app.tool !== 'bulldoze' && !def?.drag) {
    commitBuild([[tile.x, tile.y]]);
    return;
  }
  if (!app.touchBuild) app.touchBuild = { start: tile, end: tile };
  else app.touchBuild.end = tile;
  updateTouchPreview();
}

function updateTouchPreview() {
  const tb = app.touchBuild;
  if (!tb) return;
  const game = app.game;
  const c = game.plan.currency;
  const clearing = app.tool === 'bulldoze';
  const def = game.defs[app.tool];
  const cells = cellsFor(app.tool, tb.start, tb.end);
  const preview = previewMany(game, cells, app.tool);
  renderer.preview = preview.results.map((r) => ({ x: r.x, y: r.y, ok: r.ok }));
  const single = tb.start.x === tb.end.x && tb.start.y === tb.end.y;
  const failed = preview.results.find((r) => !r.ok);
  const tiles = `${preview.count} tile${preview.count === 1 ? '' : 's'}`;
  const price = clearing
    ? preview.total < 0
      ? `refund ${formatMoney(-preview.total, c)}`
      : preview.total > 0
        ? formatMoney(preview.total, c)
        : 'free'
    : formatMoney(preview.total, c);
  let title;
  let detail;
  if (single) {
    title = def?.drag === 'line' ? 'Tap where it should end' : 'Tap the opposite corner';
    detail = preview.count ? `or press ${clearing ? 'Clear' : 'Build'} for 1 tile (${price})` : failed?.reason || '';
  } else if (!preview.count) {
    title = clearing ? 'Nothing to clear here' : 'Can’t build here';
    detail = failed?.reason || '';
  } else {
    title = `${tiles} · ${price}`;
    detail = failed && preview.count < cells.length ? failed.reason : 'Tap another tile to adjust';
  }
  $('confirm-title').textContent = title;
  $('confirm-detail').textContent = detail;
  const confirm = $('confirm-build');
  setChildren(confirm, icon('check', { size: 18 }), clearing ? 'Clear' : 'Build');
  confirm.disabled = preview.count === 0;
  $('confirm-bar').hidden = false;
}

function cancelTouchBuild() {
  if (!app.touchBuild && $('confirm-bar').hidden) return;
  app.touchBuild = null;
  renderer.preview = null;
  $('confirm-bar').hidden = true;
}

function confirmTouchBuild() {
  const tb = app.touchBuild;
  if (!tb) return;
  const cells = cellsFor(app.tool, tb.start, tb.end);
  cancelTouchBuild();
  commitBuild(cells);
}

// Mouse: drag to paint.
function onBuildPreview(start, end) {
  const game = app.game;
  const cells = cellsFor(app.tool, start, end);
  const preview = previewMany(game, cells, app.tool);
  renderer.preview = preview.results.map((r) => ({ x: r.x, y: r.y, ok: r.ok }));
  const [sx, sy] = renderer.tileToScreen(end.x, end.y);
  const failed = preview.results.find((r) => !r.ok);
  const lines = [`${preview.count} tile${preview.count === 1 ? '' : 's'} · ${formatMoney(preview.total, game.plan.currency)}`];
  if (failed && preview.count < cells.length) lines.push(failed.reason);
  const def = game.defs[app.tool];
  ui.showTooltip($('tooltip'), sx, sy, def ? `${def.icon} ${def.name}` : 'Clear', lines);
}

function onBuildCommit(start, end) {
  commitBuild(cellsFor(app.tool, start, end), { quiet: true });
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
  if (!tile || app.pointer === 'touch') {
    renderer.hover = null;
    renderer.radius = null;
    tooltip.hidden = true;
    return;
  }
  renderer.hover = tile;
  renderer.radius = def && (def.radius || def.pollutionRadius) ? { x: tile.x, y: tile.y, r: def.radius || def.pollutionRadius } : null;
  if (screenX === undefined || renderer.preview) return;
  const c = game.plan.currency;
  if (def) {
    const check = checkPlacement(game, tile.x, tile.y, app.tool);
    renderer.ghost = { def, ok: check.ok };
    ui.showTooltip(tooltip, screenX, screenY, `${def.icon} ${def.name}`, [formatMoney(check.cost, c), check.ok ? 'Click or drag to build' : check.reason]);
  } else if (app.tool === 'bulldoze') {
    const check = checkBulldoze(game, tile.x, tile.y);
    renderer.ghost = { def: null, ok: check.ok };
    const text = check.ok ? (check.refund ? `Refund ${formatMoney(check.refund, c)}` : check.cost ? `Clear trees: ${formatMoney(check.cost, c)}` : 'Free') : check.reason;
    ui.showTooltip(tooltip, screenX, screenY, 'Clear', [text]);
  } else {
    const info = ui.describeTile(game, getAnalysis(game), tile.x, tile.y);
    ui.showTooltip(tooltip, screenX, screenY, info.title, info.lines.slice(0, 3));
  }
}

function onEscape() {
  if (app.touchBuild) return cancelTouchBuild();
  if (app.sheet) return openSheet(null);
  if (!$('layers-pop').hidden) return toggleLayers(false);
  if (app.tool !== 'inspect') return selectTool('inspect');
  closeInspector();
}

// --- AI advisor & inventions -----------------------------------------------

async function askAdvisor() {
  const game = app.game;
  if (!game || app.advisorBusy) return;
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
  app.unseenMissions += added.filter((m) => m.status === 'active').length;
  if (batch.advice) {
    app.advice = batch.advice;
    app.advisorUnseen = true;
    addLog(game, 'advisor', `${game.plan.advisorName}: ${batch.advice}`);
  }
  markInfoSeen();
  toast(
    added.length ? `✨ ${added.length} new mission${added.length > 1 ? 's' : ''} from ${game.plan.advisorName}` : `${game.plan.advisorName} has no new missions right now`,
    'info',
    4200,
    added.length && !infoVisible() ? { action: { label: 'View', onClick: () => openInfo('missions') } } : {},
  );
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
  const label = el('span', {}, 'Invent it');
  const go = el('button', { type: 'submit', class: 'btn btn-primary' }, icon('sparkles', { size: 18 }), label);
  const status = el('p', { class: 'muted small' }, app.status.ai ? 'Claude will design it and pick its gameplay role.' : 'The offline planner will match your idea to a building type.');
  go.onclick = async (e) => {
    e.preventDefault();
    const idea = input.value.trim();
    if (!idea) return input.focus();
    go.disabled = true;
    label.textContent = 'Designing…';
    try {
      const { building, notice } = await requestBuilding(idea, game.plan);
      const id = addCustomBuilding(game, building);
      rebuildBuildMenu();
      closeDialog();
      toast(`💡 Invented ${building.icon} ${building.name}!`, 'success', 5000);
      if (notice) toast(notice, 'warn', 4000);
      pickTool(id);
      saveGame();
    } catch (err) {
      status.textContent = err.message;
      go.disabled = false;
      label.textContent = 'Invent it';
    }
  };
  openDialog(
    'Invent a building',
    [el('p', {}, 'Describe any building you can imagine. It joins your build menu with its own name, look and bonus.'), input, status],
    [el('button', { type: 'button', class: 'btn btn-ghost', onclick: closeDialog }, 'Cancel'), go],
  );
  if (app.pointer === 'mouse') setTimeout(() => input.focus(), 50);
}

function openMenu() {
  const game = app.game;
  const item = (name, text) => el('li', {}, icon(name, { size: 18 }), el('span', {}, text));
  openDialog(
    game.plan.cityName,
    [
      el('p', { class: 'muted' }, `“${game.plan.prompt || game.plan.tagline}”`),
      el(
        'ul',
        { class: 'help' },
        item('road', `Build streets off the ${game.plan.highwayName}, then homes, shops and factories beside them.`),
        item('home', 'Homes fill up when there are jobs and residents are happy. Keep factories away from homes.'),
        item('traffic', 'Watch traffic: upgrade red streets to avenues, add parallel roads, bus stops and metro.'),
        app.pointer === 'touch'
          ? item('inspect', 'One finger moves the map, two fingers zoom. Tap to build; roads and zones take two taps.')
          : item('info', 'Right-drag or WASD pans, the wheel zooms. Space pauses, 1–3 set the speed, Ctrl+Z undoes, Esc cancels.'),
      ),
    ],
    [
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => (saveGame(false), closeDialog()) }, icon('save', { size: 18 }), 'Save'),
      el('button', { type: 'button', class: 'btn btn-ghost', id: 'menu-share', onclick: () => (closeDialog(), snapshot()) }, icon('camera', { size: 18 }), 'Share'),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: newCity }, icon('city', { size: 18 }), 'New city'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: closeDialog }, 'Back to city'),
    ],
  );
}

function newCity() {
  saveGame();
  closeDialog();
  app.game = null;
  $('prompt-input').value = '';
  initContinueButton();
  showScreen('start');
}

/** Shareable picture of the city with a caption band (uses the share sheet on phones). */
async function snapshot() {
  const game = app.game;
  const a = getAnalysis(game);
  renderer.render(0, a);
  const src = renderer.canvas;
  const dpr = renderer.dpr;
  const band = Math.round(92 * dpr);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height + band;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = '#070b18';
  ctx.fillRect(0, src.height, out.width, band);
  ctx.fillStyle = '#ffb238';
  ctx.fillRect(0, src.height, out.width, Math.round(3 * dpr));
  await document.fonts?.load('700 24px "Baloo 2"').catch(() => {});
  const pad = 16 * dpr;
  const maxWidth = out.width - pad * 2;
  const prompt = game.plan.prompt || game.plan.tagline;
  const shareHost = window.self === window.top && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? ` · ${location.host}` : '';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffb238';
  ctx.font = `700 ${Math.round(24 * dpr)}px "Baloo 2", system-ui, sans-serif`;
  ctx.fillText(game.plan.cityName, pad, src.height + 12 * dpr, maxWidth);
  ctx.fillStyle = '#f6f2ea';
  ctx.font = `600 ${Math.round(14 * dpr)}px system-ui, sans-serif`;
  ctx.fillText(
    `${milestoneFor(game.maxPop).title} · ${formatNumber(a.population)} residents · ${Math.round(a.happiness)}% happy · ${Math.round(a.congestion * 100)}% traffic`,
    pad,
    src.height + 44 * dpr,
    maxWidth,
  );
  ctx.fillStyle = '#8b95b0';
  ctx.font = `${Math.round(12.5 * dpr)}px system-ui, sans-serif`;
  ctx.fillText(`“${prompt}” · built with AI City Builder${shareHost}`, pad, src.height + 66 * dpr, maxWidth);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) {
    toast('Could not create the snapshot', 'warn');
    return;
  }
  const name = `${game.plan.cityName.replace(/[^\w-]+/g, '-').toLowerCase() || 'city'}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: game.plan.cityName, text: `My AI-designed city: ${game.plan.cityName} (“${prompt}”)` });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('📸 Snapshot saved. Share your city!', 'success', 3000);
}

// --- wiring ----------------------------------------------------------------

new Input(renderer.canvas, renderer, {
  getTool: () => app.tool,
  isActive: () => app.screen === 'game' && Boolean(app.game) && !$('dialog').open,
  onPointerType(type) {
    const pointer = type === 'touch' ? 'touch' : 'mouse';
    if (pointer === app.pointer) return;
    app.pointer = pointer;
    if (app.game) updateDock();
  },
  onPanStart() {
    $('tooltip').hidden = true;
    toggleLayers(false);
  },
  onHover(tile, x, y) {
    app.hoverTile = tile;
    updateHoverVisuals(x, y);
  },
  onTap,
  onBuildPreview,
  onBuildCommit,
  onBuildCancel,
  onUndo: undoLast,
  onEscape,
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
$('reveal-regen').addEventListener('click', () => generatePlan(app.pending.prompt));

for (const b of document.querySelectorAll('.speed button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
$('speed-cycle').addEventListener('click', () => setSpeed((app.speedIndex + 1) % SPEEDS.length));
for (const b of document.querySelectorAll('#overlay-bar button')) {
  b.addEventListener('click', () => {
    setOverlay(renderer.overlay === b.dataset.overlay ? 'none' : b.dataset.overlay);
    if (!isDesktop()) toggleLayers(false);
  });
}
$('btn-layers').addEventListener('click', () => toggleLayers());
$('btn-recenter').addEventListener('click', () => renderer.fitToMap());
$('overlay-chip').addEventListener('click', () => setOverlay('none'));
document.addEventListener('pointerdown', (e) => {
  if ($('layers-pop').hidden || $('layers-pop').contains(e.target) || $('btn-layers').contains(e.target)) return;
  toggleLayers(false);
});

for (const tab of document.querySelectorAll('#info-panel [role="tab"]')) tab.addEventListener('click', () => setInfoTab(tab.dataset.tab));
for (const b of document.querySelectorAll('[data-open-tab]')) b.addEventListener('click', () => openInfo(b.dataset.openTab));
for (const b of document.querySelectorAll('[data-close-sheet]')) b.addEventListener('click', () => openSheet(null));
$('sheet-backdrop').addEventListener('click', () => openSheet(null));
// Swipe a sheet down by its grip to close it.
for (const grip of document.querySelectorAll('.sheet-grip')) {
  let startY = null;
  grip.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    grip.setPointerCapture?.(e.pointerId);
  });
  grip.addEventListener('pointerup', (e) => {
    if (startY !== null && e.clientY - startY > 30) openSheet(null);
    startY = null;
  });
  grip.addEventListener('pointercancel', () => (startY = null));
}

$('dock-build').addEventListener('click', () => openSheet('build'));
$('dock-tool-change').addEventListener('click', () => openSheet('build'));
$('dock-tool-close').addEventListener('click', () => selectTool('inspect'));
for (const b of document.querySelectorAll('[data-tool-btn]')) b.addEventListener('click', () => pickTool(b.dataset.toolBtn));
$('confirm-build').addEventListener('click', confirmTouchBuild);
$('confirm-cancel').addEventListener('click', cancelTouchBuild);

$('btn-menu').addEventListener('click', openMenu);
$('btn-snapshot').addEventListener('click', snapshot);
for (const id of ['stat-money', 'stat-pop', 'stat-jobs']) $(id).addEventListener('click', () => openInfo('budget'));
$('stat-happy').addEventListener('click', () => setOverlay(renderer.overlay === 'happiness' ? 'none' : 'happiness'));
$('stat-traffic').addEventListener('click', () => setOverlay(renderer.overlay === 'traffic' ? 'none' : 'traffic'));
$('dialog').addEventListener('close', () => $('dialog-body').replaceChildren());

window.addEventListener('resize', onResize);
if (typeof ResizeObserver === 'function') {
  const observer = new ResizeObserver(() => updateLayout());
  observer.observe($('hud'));
  observer.observe($('dock'));
}
document.fonts?.ready.then(() => (app.screen === 'game' ? updateLayout() : updateBackgroundInsets()));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame();
});
window.addEventListener('beforeunload', () => saveGame());

// `?debug` exposes the app state for troubleshooting and end-to-end tests.
if (new URLSearchParams(location.search).has('debug')) window.aicb = { app, renderer, background, getAnalysis };

initStart();
requestAnimationFrame(frame);
