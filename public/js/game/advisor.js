// Rule-based tips (free, instant) and the city snapshot sent to the AI advisor.

const pct = (v) => Math.round(v * 100);

export function adviseCity(state, a) {
  const tips = [];
  const pop = a.population;
  const homes = [];
  state.tiles.forEach((t, i) => {
    if (t && state.defs[t.d]?.residents) homes.push(i);
  });
  if (a.roadTiles <= state.size) {
    tips.push({ level: 'info', text: `Drag streets off the ${state.plan.highwayName}, then place homes and jobs along them.` });
  }
  if (a.inactive > 0) {
    tips.push({ level: 'warn', text: `${a.inactive} building${a.inactive > 1 ? 's have' : ' has'} no road connected to the highway.` });
  }
  if (homes.length && a.jobs === 0) {
    tips.push({ level: 'warn', text: 'Nobody can find work. Add shops or factories along your streets.' });
  } else if (pop > 100 && a.employmentRate < 0.8) {
    tips.push({ level: 'warn', text: `${100 - pct(a.employmentRate)}% of workers are unemployed — build shops, offices or industry.` });
  }
  if (a.demand.homes > 0.3 && a.jobs > 0) tips.push({ level: 'info', text: 'Jobs are going unfilled — build more homes.' });
  if (a.congestion > 0.5) {
    tips.push({
      level: 'warn',
      text: `Traffic is jammed (${pct(a.congestion)}%). Upgrade red streets to avenues, add parallel roads, or put transit near homes and jobs.`,
    });
  }
  if (pop > 800) {
    const missing = [];
    const covered = { health: 0, safety: 0, education: 0 };
    for (const i of homes) {
      if (a.health[i]) covered.health++;
      if (a.safety[i]) covered.safety++;
      if (a.education[i]) covered.education++;
    }
    if (covered.education < homes.length * 0.6) missing.push('schools');
    if (covered.health < homes.length * 0.6) missing.push('hospitals');
    if (covered.safety < homes.length * 0.6) missing.push('police');
    if (missing.length) tips.push({ level: 'warn', text: `Many homes lack ${missing.join(', ')} nearby.` });
  }
  const polluted = homes.filter((i) => a.pollution[i] > 1.5).length;
  if (polluted >= 3) tips.push({ level: 'warn', text: `${polluted} homes are choking on factory pollution. Move industry away or plant parks.` });
  if (a.budget.net < 0) tips.push({ level: 'warn', text: 'You are losing money every month. Grow the tax base or trim upkeep.' });
  if (state.taxRate >= 13) tips.push({ level: 'info', text: 'High taxes are making residents unhappy.' });
  const readyLandmark = Object.values(state.defs).find(
    (d) => d.archetype === 'landmark' && d.unlock <= state.maxPop && !state.tiles.some((t) => t && t.d === d.id),
  );
  if (readyLandmark) tips.push({ level: 'info', text: `${readyLandmark.name} is unlocked — landmarks boost tourism and happiness.` });
  if (!tips.length) {
    tips.push({ level: 'good', text: a.happiness >= 70 ? 'Citizens love it here! Keep growing.' : 'Things are running smoothly.' });
  }
  return tips.slice(0, 4);
}

/** Compact snapshot of the city for the AI mission generator. */
export function missionContext(state, a) {
  const counts = { ...a.counts };
  return {
    cityName: state.plan.cityName,
    style: state.plan.style,
    vision: state.plan.vision,
    landmarks: state.plan.landmarks.map((l) => l.name),
    stats: {
      month: state.month,
      population: Math.round(a.population),
      jobs: Math.round(a.jobs),
      money: Math.round(state.money),
      net: Math.round(a.budget.net),
      happiness: Math.round(a.happiness),
      congestion: pct(a.congestion),
      transitShare: pct(a.transitShare),
      employment: pct(a.employmentRate),
      pollution: Math.round(Math.max(0, ...Array.from(a.pollution)) * 10),
      inactive: a.inactive,
    },
    counts,
    completed: state.missions.filter((m) => m.status === 'done').map((m) => m.title),
    active: state.missions.filter((m) => m.status !== 'done').map((m) => m.title),
  };
}
