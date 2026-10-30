import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProject, type ProjectFacts } from '../app/shared/projectCheck.js';

const complete: ProjectFacts = {
  name: 'new-project-main',
  git: { branch: 'main', remote: 'https://github.com/x/y.git' },
  packageJson: true,
  devScript: 'npm run dev',
  react: true,
  vite: true,
  nodeModules: true,
  components: 4,
  tokens: { file: 'design-system/tokens.json', count: 108 },
  figma: { linked: true, hasToken: true, connected: true, label: 'ok' },
  figmaComponents: 82,
  coded: 4,
  relay: { installed: true, current: true },
  pluginSeen: true,
};

test('contrôle du projet : un projet complet est tout vert', () => {
  const items = checkProject(complete);
  assert.ok(items.every((i) => i.state === 'ok'), JSON.stringify(items.filter((i) => i.state !== 'ok')));
  assert.deepEqual(items.map((i) => i.id), ['git', 'app', 'deps', 'components', 'tokens', 'figma', 'relay', 'plugin']);
});

test('contrôle du projet : chaque manque dit comment le régler, et qui le fait', () => {
  const items = checkProject({
    ...complete,
    git: { branch: 'main', remote: null },
    nodeModules: false,
    components: 0,
    tokens: null,
    figma: { linked: true, hasToken: false, connected: false, label: 'jeton absent' },
    relay: { installed: true, current: false },
    pluginSeen: false,
  });
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by.git.state, 'warn');
  assert.deepEqual(by.deps.fix, { kind: 'action', action: 'install', label: 'Installer (npm install)' });
  assert.equal(by.tokens.fix?.kind, 'chat');
  assert.match(by.tokens.fix?.kind === 'chat' ? by.tokens.fix.message : '', /N’invente aucune valeur/);
  assert.equal(by.figma.fix?.kind, 'manual');
  assert.equal(by.relay.fix?.kind, 'action');
  assert.equal(by.plugin.state, 'warn');
  // Pas un dépôt Git, pas d'application : expliqué, rien n'est fait à sa place.
  const empty = checkProject({ ...complete, git: null, packageJson: false, devScript: null, react: false, vite: false });
  assert.equal(empty.find((i) => i.id === 'git')?.fix?.kind, 'manual');
  assert.equal(empty.find((i) => i.id === 'app')?.state, 'missing');
  assert.ok(!empty.some((i) => i.id === 'deps' || i.id === 'relay'));
});

test('erreurs traduites en clair, avec la suite proposée', async () => {
  const { diagnose } = await import('../app/shared/projectCheck.js');
  // L'erreur réelle du 30 octobre : Vite bloqué par le bac à sable de Codex.
  const eperm = diagnose(
    "Error: EPERM: operation not permitted, open '/Users/x/new-project-main/node_modules/.vite-temp/vite.config.ts.timestamp.mjs'",
    'start',
  );
  assert.match(eperm.cause, /Écriture refusée/);
  assert.equal(eperm.fix.kind, 'manual');
  assert.match(diagnose('npm ERR! code ENOTFOUND registry.npmjs.org', 'install').cause, /Internet/);
  assert.match(diagnose('Error: listen EADDRINUSE: address already in use :::5173', 'start').cause, /port/);
  const conflict = diagnose('npm ERR! code ERESOLVE could not resolve dependency', 'install');
  assert.equal(conflict.fix.kind, 'chat');
  const missing = diagnose('[vite] Failed to resolve import "./Foo" from "src/App.tsx"', 'start');
  assert.equal(missing.fix.kind, 'chat');
  // Cas inconnu : Clodo reçoit le journal pour chercher la cause.
  const unknown = diagnose('src/App.tsx(3,7): error TS2322: Type string is not assignable', 'compile');
  assert.match(unknown.fix.kind === 'chat' ? unknown.fix.message : '', /error TS2322/);
});

test('contrôle du projet : démarrage et compilation', () => {
  const ok = checkProject({ ...complete, start: { ok: true, url: 'http://localhost:5173' }, compile: { ok: true } });
  assert.ok(ok.every((i) => i.state === 'ok'));
  const bad = checkProject({
    ...complete,
    start: { ok: false, log: 'Error: EPERM: operation not permitted' },
    compile: { ok: false, errors: 2, log: 'a.tsx: error TS2322\nb.tsx: error TS2345' },
  });
  const by = Object.fromEntries(bad.map((i) => [i.id, i]));
  assert.equal(by.start.state, 'missing');
  assert.match(by.start.detail, /Écriture refusée/);
  assert.equal(by.compile.state, 'warn');
  assert.match(by.compile.detail, /^2 erreur/);
  assert.equal(by.compile.fix?.kind, 'chat');
});
