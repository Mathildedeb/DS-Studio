import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexAdapter } from '../connectors/agents/codex.js';
import { tokensSchema } from '../app/shared/model.js';
// CODEX_HOME isolé, aucun login/logout et aucune lecture de l'auth du compte réel.
const isolatedHome = await mkdtemp(path.join(tmpdir(), 'ds-empty-codex-home-'));
const previous = process.env.CODEX_HOME;
process.env.CODEX_HOME = isolatedHome;
try {
  const tokens = tokensSchema.parse(
    JSON.parse(
      await readFile(
        new URL('../workspace/design-system.tokens.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const adapter = new CodexAdapter();
  if (!(await adapter.status()).available)
    throw new Error('Codex qualifié requis pour ce contrôle optionnel.');
  let failed = false;
  try {
    await adapter.reply('Dis bonjour.', {
      tokens,
      brief: 'Test fictif.',
      rules: 'Aucun outil.',
      history: [],
    });
  } catch (e) {
    failed = true;
    console.log(
      'PASS: CODEX_HOME vide → refus exploitable sans changement : ' +
        (e as Error).message,
    );
  }
  if (!failed) throw new Error('Réponse inattendue sans authentification.');
} finally {
  if (previous === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previous;
  await rm(isolatedHome, { recursive: true, force: true });
}
