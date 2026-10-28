import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DevServer, detectCommand } from '../app/server/devserver.js';

test('serveur de dev du projet : lancé, adresse lue, arrêté', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-dev-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await detectCommand(root), null, 'sans package.json');
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node server.mjs' } }),
  );
  // Un faux serveur qui annonce son adresse comme Vite.
  await writeFile(
    path.join(root, 'server.mjs'),
    `import http from 'node:http';
const s = http.createServer((q, r) => r.end('proto'));
s.listen(0, '127.0.0.1', () =>
  console.log('  ➜  Local:   http://127.0.0.1:' + s.address().port + '/'));`,
  );
  assert.equal((await detectCommand(root))?.label, 'npm run dev');
  const dev = new DevServer();
  t.after(() => dev.stop());
  const status = await dev.start(root);
  assert.equal(status.state, 'running', status.logs.join('\n'));
  assert.match(status.url!, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(await (await fetch(status.url!)).text(), 'proto');
  assert.equal(dev.stop().state, 'stopped');
  // Le groupe de processus est coupé : plus de réponse.
  await new Promise((r) => setTimeout(r, 500));
  await assert.rejects(fetch(status.url!));
});
