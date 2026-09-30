// Mission progress and rewards.

import { OBJECTIVES } from '../shared/plan.js';
import { MAX_ACTIVE_MISSIONS, addLog } from './state.js';

export function missionValue(state, a, m) {
  switch (m.objective) {
    case 'population':
      return a.population;
    case 'jobs':
      return a.jobs;
    case 'money':
      return state.money;
    case 'monthly_income':
      return state.lastReport ? state.lastReport.net : a.net;
    case 'happiness':
      return a.happiness;
    case 'traffic_below':
      return a.congestion * 100;
    case 'build':
      return a.counts[m.archetype] || 0;
    case 'transit_share':
      return a.transitShare * 100;
    case 'employment':
      return a.employmentRate * 100;
    default:
      return 0;
  }
}

/** Where a mission stands right now: current value, whether it is met, and a 0..1 progress bar. */
export function missionStatus(state, a, m) {
  const spec = OBJECTIVES[m.objective];
  const value = missionValue(state, a, m);
  const gateMet = a.population >= (m.minPopulation || 0);
  const below = spec?.cmp === '<=';
  const reached = below ? value <= m.target : value >= m.target;
  const met = gateMet && reached;
  let progress;
  if (below) {
    const gateProgress = m.minPopulation ? Math.min(1, a.population / m.minPopulation) : 1;
    const flow = reached ? 1 : Math.max(0, Math.min(1, m.target / Math.max(value, 1)));
    progress = gateMet ? (reached ? 1 : 0.5 + 0.5 * flow) : 0.5 * gateProgress;
  } else {
    const valueProgress = Math.max(0, Math.min(1, value / m.target));
    progress = gateMet || !m.minPopulation ? valueProgress : Math.min(valueProgress, 0.99) * Math.min(1, a.population / m.minPopulation);
  }
  return { value, met, gateMet, progress: met ? 1 : Math.min(progress, 0.99) };
}

/** Updates progress, pays out rewards and activates queued missions. Returns the newly completed missions. */
export function updateMissions(state, a) {
  const completed = [];
  for (const m of state.missions) {
    if (m.status !== 'active') continue;
    const s = missionStatus(state, a, m);
    m.progress = s.progress;
    if (s.met) {
      m.status = 'done';
      m.progress = 1;
      m.completedMonth = state.month;
      state.money += m.reward;
      completed.push(m);
      addLog(state, 'mission', `Mission complete: ${m.title} (+${m.reward.toLocaleString('en-US')})`);
    }
  }
  let active = state.missions.filter((m) => m.status === 'active').length;
  for (const m of state.missions) {
    if (active >= Math.min(3, MAX_ACTIVE_MISSIONS)) break;
    if (m.status === 'queued') {
      m.status = 'active';
      active += 1;
    }
  }
  return completed;
}

/** Human-readable goal, e.g. "Congestion ≤ 40% (with 2,000+ residents)". */
export function describeObjective(m, defs, currency = '') {
  const spec = OBJECTIVES[m.objective];
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  let goal;
  switch (m.objective) {
    case 'build': {
      const name = m.archetype === 'landmark' ? 'landmark' : defs?.[m.archetype]?.name || m.archetype;
      goal = `Build ${m.target} × ${name}`;
      break;
    }
    case 'traffic_below':
      goal = `Congestion ≤ ${m.target}%`;
      break;
    default:
      goal = `${spec.label} ${spec.cmp === '<=' ? '≤' : '≥'} ${spec.money ? currency : ''}${fmt(m.target)}${spec.unit || ''}`;
  }
  if (m.minPopulation && m.objective !== 'population') goal += ` with ${fmt(m.minPopulation)}+ residents`;
  return goal;
}
