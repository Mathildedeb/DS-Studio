import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const dir = await mkdtemp(path.join(tmpdir(), 'ds-e2e-'));
// Les tests partent d'un atelier déjà ouvert : l'écran « Ouvrir un projet »
// a son propre test.
await writeFile(path.join(dir, 'connection.json'), '{"skipped":true}\n');
const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'app/server/index.ts'],
  {
    env: {
      ...process.env,
      PORT: '4318',
      DS_STUDIO_DATA_DIR: dir,
      DS_STUDIO_TOKENS_SEED: 'tests/fixtures/tokens.json',
      DS_STUDIO_NO_FIGMA: '1',
    },
    stdio: 'inherit',
  },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill('SIGTERM'));
child.on('exit', async (code) => {
  await rm(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
