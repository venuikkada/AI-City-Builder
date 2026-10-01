// Entry point: `npm start` (or `node server.js`). Loads .env, then starts the game server.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAi } from './server/ai.js';
import { createAppServer } from './server/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile?.(path.join(root, '.env'));
} catch {
  // No .env file: use the environment as-is.
}

const port = Number(process.env.PORT) || 3000;
const ai = createAi();
const server = createAppServer({ ai });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Close the other app or pick another port, e.g. PORT=3001 npm start`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log(`AI City Builder → http://localhost:${port}`);
  console.log(ai.enabled ? `AI planner: Claude (${ai.model})` : 'AI planner: offline (set ANTHROPIC_API_KEY to enable Claude)');
});

// Shut down cleanly when the host (or Ctrl+C) asks us to stop.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
