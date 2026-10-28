import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PublishCounter, gitStatus, publish } from '../app/server/gitops.js';

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

  // Lot suivant : toujours une nouvelle branche, même avec le même message.
  await writeFile(path.join(work, 'App.tsx'), 'export const App = 3;\n');
  const second = await publish(work, 'Bouton : variante outline');
  assert.equal(second.branch, `${first.branch}-2`);
  assert.equal(
    git(remote, 'log', '-1', '--format=%s', second.branch),
    'Bouton : variante outline',
  );
  assert.equal(git(remote, 'log', '--format=%s', 'main'), 'init');

  // Fichier sensible : refus net, rien n'est commité.
  await writeFile(path.join(work, '.env'), 'SECRET=1\n');
  await assert.rejects(publish(work, 'Secret'), /fichiers sensibles/);
  await unlink(path.join(work, '.env'));
});

test('compteur de publication : par projet, conservé sur disque, remis à zéro', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-count-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const counter = new PublishCounter(dir);
  assert.equal(await counter.get('/a'), 0);
  for (let i = 0; i < 3; i++) await counter.add('/a');
  await counter.add('/b');
  const reopened = new PublishCounter(dir);
  assert.equal(await reopened.get('/a'), 3);
  assert.equal(await reopened.get('/b'), 1);
  await reopened.reset('/a');
  assert.equal(await reopened.get('/a'), 0);
  assert.equal(await reopened.get('/b'), 1);
});
