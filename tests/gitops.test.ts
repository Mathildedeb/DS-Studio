import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitStatus, publish } from '../app/server/gitops.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('publication : branche de travail design/…, main intact, push réel', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'distant.git');
  const work = path.join(root, 'projet');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(root, 'clone', remote, work);
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  await writeFile(path.join(work, 'App.tsx'), 'export const App = 1;\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'init');
  git(work, 'push', '-u', 'origin', 'main');

  await assert.rejects(publish(work, 'Rien'), /Rien à publier/);
  await writeFile(path.join(work, 'App.tsx'), 'export const App = 2;\n');
  const before = await gitStatus(work);
  assert.equal(before.protected, true);
  assert.deepEqual(before.files, [{ state: 'M', path: 'App.tsx' }]);

  const first = await publish(work, 'Bouton : variante outline');
  assert.match(
    first.branch,
    /^design\/\d{4}-\d{2}-\d{2}-bouton-variante-outline$/,
  );
  assert.equal(first.pushed, true);
  assert.match(git(remote, 'branch'), new RegExp(first.branch));
  // main n'a pas bougé sur le dépôt distant.
  assert.equal(git(remote, 'log', '--format=%s', 'main'), 'init');

  // Deuxième modification : même branche, pas de nouvelle.
  await writeFile(path.join(work, 'App.tsx'), 'export const App = 3;\n');
  const second = await publish(work, 'Encore');
  assert.equal(second.branch, first.branch);
  assert.equal(git(remote, 'log', '-1', '--format=%s', first.branch), 'Encore');

  // Fichier sensible : refus net, rien n'est commité.
  await writeFile(path.join(work, '.env'), 'SECRET=1\n');
  await assert.rejects(publish(work, 'Secret'), /fichiers sensibles/);
  await unlink(path.join(work, '.env'));
});
