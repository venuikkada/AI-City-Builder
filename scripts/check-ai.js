// Checks your Claude setup before you deploy: `npm run check:ai`.
// Makes two real API calls (an invented building and a full city plan, roughly $0.10 in total).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAi } from '../server/ai.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile?.(path.join(root, '.env'));
} catch {
  // No .env file: use the environment as-is.
}

const ai = createAi();
if (!ai.enabled) {
  console.error('✗ No ANTHROPIC_API_KEY found in the environment or .env, so the game will use the offline planner.');
  process.exit(1);
}

async function check(label, run, summarize) {
  const started = Date.now();
  try {
    const result = await run();
    console.log(`✓ ${label} (${((Date.now() - started) / 1000).toFixed(1)}s): ${summarize(result)}`);
    return true;
  } catch (err) {
    console.error(`✗ ${label} failed: ${err.name}: ${err.message}`);
    return false;
  }
}

console.log(`Checking Claude (${ai.model})…`);
const ok =
  (await check(
    'Invent a building',
    () => ai.building('a solar-powered biryani food court', { cityName: 'Neo Hyderabad', style: 'futuristic' }),
    (b) => `${b.icon} ${b.name} (${b.archetype}, ${b.bonus})`,
  )) &&
  (await check(
    'City plan',
    () => ai.plan('Build a futuristic Hyderabad.'),
    (p) => `${p.cityName}: ${p.landmarks.map((l) => l.name).join(', ')}; ${p.missions.length} missions`,
  ));
process.exit(ok ? 0 : 1);
