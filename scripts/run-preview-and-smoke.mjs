/**
 * Starts `vite preview` on the built `dist/`, waits for it to serve, runs both smoke tests against
 * it, then tears the server down. Exit code is non-zero if either smoke test fails, so CI can gate
 * on it. Keeps the whole browser-verification step in one command.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.SMOKE_PORT || 4173);
const BASE = `http://localhost:${PORT}/`;
const AUDIO_DIR = process.env.SMOKE_AUDIO_DIR || path.join(process.cwd(), '.fixtures/audio');

if (!existsSync('dist/index.html')) {
  console.error('[run-smoke] dist/ not built. Run `npm run build` first.');
  process.exit(2);
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(BASE);
        if (res.ok) return resolve();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('preview server did not start'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      stdio: 'inherit',
      env: { ...process.env, SMOKE_BASE_URL: BASE, SMOKE_AUDIO_DIR: AUDIO_DIR },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const server = spawn('npx', ['vite', 'preview', '--host', '0.0.0.0', '--port', String(PORT)], {
  stdio: 'ignore',
});

let failed = 0;
try {
  await waitForServer();
  console.log(`[run-smoke] preview up at ${BASE}; fixtures at ${AUDIO_DIR}\n`);
  failed += (await run('scripts/smoke.mjs')) === 0 ? 0 : 1;
  console.log('');
  failed += (await run('scripts/smoke-engine.mjs')) === 0 ? 0 : 1;
  console.log('');
  failed += (await run('scripts/smoke-bridge.mjs')) === 0 ? 0 : 1;
  // Tear down this preview so the Listen Together suite can bind the port with its own
  // preview + relay (it is self-contained).
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  console.log('');
  failed += (await run('scripts/smoke-listen-together.mjs')) === 0 ? 0 : 1;
} catch (e) {
  console.error('[run-smoke]', e.message);
  failed = 1;
} finally {
  server.kill('SIGTERM');
}

process.exit(failed === 0 ? 0 : 1);
