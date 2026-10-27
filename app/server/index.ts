import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensSchema } from '../shared/model.js';
import { Store } from './store.js';
import { createStudioServer } from './http.js';
import { acquireLease } from '../../scripts/runtime.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const directory = process.env.DS_STUDIO_DATA_DIR
  ? path.resolve(process.env.DS_STUDIO_DATA_DIR)
  : path.join(root, '.ds-studio');
const port = Number(process.env.PORT ?? 4310);
let lease: Awaited<ReturnType<typeof acquireLease>> | undefined;
try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('PORT doit être un entier entre 1024 et 65535.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink())
    throw new Error('Dossier de données symbolique refusé.');
  lease = await acquireLease(directory, 'server', { root, directory, port });
  const seed = tokensSchema.parse(
    JSON.parse(
      await fs.readFile(
        path.join(root, 'workspace', 'design-system.tokens.json'),
        'utf8',
      ),
    ),
  );
  const store = new Store(directory, seed);
  await store.init();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await store.flush();
    await lease!.release();
    process.exit(0);
  };
  const app = await createStudioServer({
    root,
    store,
    dev: process.argv.includes('--dev'),
    control: {
      record: lease.record,
      stop: () => {
        void stop();
      },
    },
  });
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, '127.0.0.1', () => resolve());
  });
  console.log(
    `DS-Studio · http://127.0.0.1:${port}\nMode manuel autonome · Figma non connecté · Ctrl+C pour fermer.`,
  );
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (e) {
  if (lease) await lease.release().catch(() => {});
  console.error(
    'DS-Studio : ' +
      ((e as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? 'port occupé. Fermez l’autre serveur ou définissez PORT.'
        : (e as Error).message),
  );
  process.exit(1);
}
