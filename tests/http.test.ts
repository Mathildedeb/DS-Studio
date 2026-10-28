import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../app/server/store.js';
import { tokensSchema } from '../app/shared/model.js';
import { createStudioServer } from '../app/server/http.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = tokensSchema.parse(
  JSON.parse(
    await readFile(path.join(root, 'tests/fixtures/tokens.json'), 'utf8'),
  ),
);
async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  dev = false,
  ask: (system: string, input: string) => Promise<string> = async () => {
    throw new Error('Claude Code indisponible (simulation).');
  },
  projectRoot = root,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ds-http-'));
  const store = new Store(directory, seed);
  await store.init();
  const app = await createStudioServer({
    root: projectRoot,
    store,
    dev,
    agent: {
      id: 'codex',
      async status() {
        return { available: false, detail: 'Non authentifié (simulation)' };
      },
      async reply() {
        throw new Error('Codex indisponible : authentification nécessaire.');
      },
    },
    // Jamais le vrai CLI dans les tests : ni réseau ni quota consommé.
    ask,
    claude: {
      id: 'claude',
      async status() {
        return { available: false, detail: 'Non authentifié (simulation)' };
      },
      async reply() {
        throw new Error(
          'Claude Code indisponible : vérifiez « claude auth status », Internet et le quota.',
        );
      },
    },
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const port = (app.server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  const post = (
    route: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(origin + '/api/' + route, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-DS-Studio': boot.csrf,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { origin, post, store };
}
test('API manuelle complète sans IA ni Figma, export égal au disque', async (t) => {
  const { origin, post, store } = await fixture(t);
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  assert.equal(boot.figma.connected, false);
  // Token absent sans type : demande refusée clairement, pas une erreur serveur.
  const invalid = await post('proposals', {
    revision: 0,
    changes: [{ key: 'color.neuf', value: '#112233' }],
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Type requis/);
  const proposed = await post('proposals', {
    revision: 0,
    changes: [{ key: 'color.brand', value: '#112233' }],
  });
  assert.equal(proposed.status, 200);
  const p = await proposed.json();
  assert.equal(store.snapshot().revision, 0);
  const accepted = await post('commit', { id: p.id });
  assert.equal(accepted.status, 200);
  assert.equal(
    (await (await fetch(origin + '/api/export')).json())['color.brand'].$value,
    '#112233',
  );
  const undo = await (await post('undo', { revision: 1, id: p.id })).json();
  assert.equal((await post('commit', { id: undo.id })).status, 200);
  assert.equal(
    store.snapshot().tokens['color.brand'].$value,
    seed['color.brand'].$value,
  );
});
test('CSRF, origine étrangère, rebinding Host et périmètre refusés', async (t) => {
  const { origin, post, store } = await fixture(t);
  const body = {
    revision: 0,
    changes: [{ key: 'color.brand', value: '#112233' }],
  };
  assert.equal(
    (await post('proposals', body, { 'X-DS-Studio': '' })).status,
    403,
  );
  assert.equal(
    (await post('proposals', body, { Origin: 'https://evil.invalid' })).status,
    403,
  );
  const hostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      http
        .get(
          origin + '/api/state',
          { headers: { Host: 'evil.invalid' } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        )
        .on('error', reject);
    },
  );
  assert.equal(hostStatus, 403);
  assert.equal(
    (await post('proposals', { ...body, path: '../../outside' })).status,
    400,
  );
  assert.equal(
    (
      await post('proposals', {
        revision: 0,
        changes: [{ key: '../../outside', value: '#112233' }],
      })
    ).status,
    400,
  );
  assert.equal((await post('figma/write', {})).status, 404);
  assert.equal((await fetch(origin + '/.ds-studio/state.json')).status, 404);
  assert.equal((await fetch(origin + '/workspace/PFE.md')).status, 404);
  assert.equal(store.snapshot().revision, 0);
});
test('requêtes malformées et trop grandes refusées', async (t) => {
  const { origin, post } = await fixture(t);
  assert.equal(
    (await post('import', { revision: 0, tokens: { wrong: true } })).status,
    400,
  );
  assert.equal((await post('proposals', {})).status, 400);
  assert.equal((await post('agent', { data: 'x'.repeat(129000) })).status, 413);
  const boot = await (await fetch(origin + '/api/bootstrap')).json();
  assert.equal(
    (
      await fetch(origin + '/api/commit', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-DS-Studio': boot.csrf,
        },
        body: '{bad',
      })
    ).status,
    400,
  );
});
test('IA sans compte et adaptateurs non implémentés échouent sans mutation', async (t) => {
  const { post, store } = await fixture(t);
  const body = { agent: 'codex', revision: 0, message: 'Bonjour', history: [] };
  const response = await post('agent', body);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /authentification/);
  assert.equal((await post('agent', { ...body, agent: 'claude' })).status, 500);
  assert.equal((await post('agent', { ...body, agent: 'gemini' })).status, 500);
  assert.equal(store.snapshot().revision, 0);
});

test('mode dev : frontend servi, workspace et backend non distribués', async (t) => {
  const { origin } = await fixture(t, true);
  for (const route of [
    '/',
    '/app/client/main.tsx',
    '/app/shared/model.ts',
    '/@vite/client',
  ])
    assert.equal((await fetch(origin + route)).status, 200);
  for (const route of [
    '/workspace/PFE.md',
    '/app/server/http.ts',
    '/connectors/agents/codex.ts',
    '/.ds-studio/state.json',
    '/.git/config',
  ])
    assert.equal((await fetch(origin + route)).status, 403);
});

test('brief : API fermée, révision conflictuelle et aucun fichier privé servi', async (t) => {
  const { origin, post, store } = await fixture(t);
  const initial = await (await fetch(origin + '/api/project')).json();
  const body = {
    ...initial,
    project: { ...initial.project, name: 'PFE test' },
  };
  assert.equal(
    (await post('project', body, { 'X-DS-Studio': '' })).status,
    403,
  );
  assert.equal((await post('project', body)).status, 200);
  assert.equal((await post('project', body)).status, 409);
  assert.equal(
    (await post('project', { ...body, path: '../../escape' })).status,
    400,
  );
  assert.equal((await fetch(origin + '/.ds-studio/project.json')).status, 404);
  assert.equal(store.snapshot().revision, 0);
});

test('mode manuel disponible immédiatement même si la détection IA ne répond jamais', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ds-no-agent-'));
  const store = new Store(directory, seed);
  await store.init();
  const app = await createStudioServer({
    root,
    store,
    agent: {
      id: 'codex',
      async status() {
        return new Promise(() => {});
      },
      async reply() {
        throw new Error('Non disponible');
      },
    },
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const response = await fetch(origin + '/api/bootstrap', {
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).csrf, 'string');
});
test('tableau de bord : roadmap versionnée et disposition privée validée', async (t) => {
  const { origin, post, store } = await fixture(t);
  const roadmap = await (await fetch(origin + '/api/roadmap')).json();
  assert.equal(roadmap.project.name, 'SynKro');
  assert(roadmap.steps.length > 0);
  const initial = await (await fetch(origin + '/api/dashboard')).json();
  assert(initial.widgets.some((w: { id: string }) => w.id === 'checklist'));
  const layout = { widgets: [{ id: 'roadmap', span: 12 }] };
  assert.equal((await post('dashboard', layout)).status, 200);
  assert.deepEqual(
    await (await fetch(origin + '/api/dashboard')).json(),
    layout,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(store.directory, 'dashboard.json'), 'utf8'),
    ),
    layout,
  );
  for (const bad of [
    { widgets: [{ id: 'inconnu', span: 12 }] },
    {
      widgets: [
        { id: 'roadmap', span: 4 },
        { id: 'roadmap', span: 8 },
      ],
    },
    { widgets: [], extra: true },
    { widgets: [{ id: 'roadmap', span: 2 }] },
  ])
    assert.equal((await post('dashboard', bad)).status, 400);
  assert.equal(
    (
      await post('dashboard', layout, {
        'X-DS-Studio': 'faux',
      })
    ).status,
    403,
  );
});
test('checklist de production : amorcée par la roadmap puis enregistrée', async (t) => {
  const { origin, post, store } = await fixture(t);
  const initial = await (await fetch(origin + '/api/checklist')).json();
  assert(initial.length > 0);
  assert(initial.every((i: { done: boolean }) => !i.done));
  const next = [{ ...initial[0], done: true }];
  assert.equal((await post('checklist', next)).status, 200);
  assert.deepEqual(await (await fetch(origin + '/api/checklist')).json(), next);
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(store.directory, 'checklist.json'), 'utf8'),
    ),
    next,
  );
  assert.equal(
    (await post('checklist', [{ ...initial[0], label: '' }])).status,
    400,
  );
});
test('disposition de l’atelier enregistrée ; ancienne disposition convertie', async (t) => {
  const { origin, post, store } = await fixture(t);
  const initial = await (await fetch(origin + '/api/atelier')).json();
  assert.deepEqual(
    initial.widgets.map((w: { id: string }) => w.id),
    ['tokens', 'preview'],
  );
  const layout = {
    widgets: [
      { id: 'preview', span: 7 },
      { id: 'tokens', span: 5 },
    ],
  };
  assert.equal((await post('atelier', layout)).status, 200);
  assert.deepEqual(await (await fetch(origin + '/api/atelier')).json(), layout);
  assert.equal(
    (await post('atelier', { widgets: [{ id: 'checklist', span: 6 }] })).status,
    400,
  );
  // Fichier écrit par la version précédente : tailles s/m/l, widget retiré.
  await writeFile(
    path.join(store.directory, 'dashboard.json'),
    JSON.stringify({
      widgets: [
        { id: 'countdown', size: 's' },
        { id: 'chat', size: 'm' },
        { id: 'roadmap', size: 'l' },
      ],
    }),
  );
  assert.deepEqual(await (await fetch(origin + '/api/dashboard')).json(), {
    widgets: [
      { id: 'countdown', span: 4 },
      { id: 'roadmap', span: 12 },
    ],
  });
});
test('Figma : statut en lecture seule, sans jeton par défaut, écriture toujours absente', async (t) => {
  const { origin, post } = await fixture(t);
  const status = await (await fetch(origin + '/api/figma')).json();
  assert.equal(status.connected, false);
  assert.match(status.label, /jeton absent/);
  assert.equal((await post('figma', {})).status, 404);
});
test('code par Clodo : proposition, session exigée, application puis annulation', async (t) => {
  // Copie temporaire : le test n'écrit jamais dans les fichiers de l'étudiante.
  const copy = await mkdtemp(path.join(tmpdir(), 'ds-code-root-'));
  t.after(() => rm(copy, { recursive: true, force: true }));
  await mkdir(path.join(copy, 'workspace'), { recursive: true });
  await mkdir(path.join(copy, 'app', 'client'), { recursive: true });
  const file = path.join(copy, 'workspace', 'DECISIONS.md');
  const original = '# Journal de décisions du projet\n';
  await writeFile(file, original);
  const answers = [
    JSON.stringify({ files: ['workspace/DECISIONS.md'] }),
    JSON.stringify({
      message: 'J’ajoute une ligne.',
      edits: [
        {
          file: 'workspace/DECISIONS.md',
          search: '# Journal de décisions du projet',
          replace: '# Journal de décisions du projet\n\nTest Clodo.',
        },
      ],
    }),
  ];
  const { origin, post } = await fixture(
    t,
    false,
    async () => answers.shift()!,
    copy,
  );
  const proposed = await post('code', {
    message: 'Ajoute une ligne',
    history: [],
  });
  assert.equal(proposed.status, 200);
  const { proposal } = await proposed.json();
  assert.equal(await readFile(file, 'utf8'), original, 'rien avant validation');
  assert.equal(
    (await post('code/apply', { id: proposal.id }, { 'X-DS-Studio': 'faux' }))
      .status,
    403,
  );
  assert.equal((await post('code/apply', { id: proposal.id })).status, 200);
  assert.match(await readFile(file, 'utf8'), /Test Clodo\./);
  assert.equal(
    (await (await fetch(origin + '/api/code/last')).json()).id,
    proposal.id,
  );
  assert.equal((await post('code/revert', { id: proposal.id })).status, 200);
  assert.equal(await readFile(file, 'utf8'), original);
});
test('bulle Clodo : position enregistrée, valeurs hors écran refusées', async (t) => {
  const { origin, post, store } = await fixture(t);
  assert.deepEqual(await (await fetch(origin + '/api/clodo')).json(), {
    x: 0.96,
    y: 0.92,
  });
  assert.equal((await post('clodo', { x: 0.1, y: 0.5 })).status, 200);
  assert.deepEqual(await (await fetch(origin + '/api/clodo')).json(), {
    x: 0.1,
    y: 0.5,
  });
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(store.directory, 'clodo.json'), 'utf8'),
    ),
    { x: 0.1, y: 0.5 },
  );
  for (const bad of [{ x: 2, y: 0 }, { x: 0.5 }, { x: 0, y: 0, z: 1 }])
    assert.equal((await post('clodo', bad)).status, 400);
});

test('sélection de la page DS transmise à Clodo, forme stricte', async (t) => {
  const inputs: string[] = [];
  const { post } = await fixture(t, false, async (_system, input) => {
    inputs.push(input);
    return JSON.stringify({ files: [], message: 'Rien à faire.' });
  });
  const focus = {
    page: 'design-system',
    kind: 'component',
    name: 'ExampleForm',
    path: ['ExampleForm'],
    level: 'organism',
    source: 'React · DesignSystem.tsx › ExampleForm',
    selector: 'form.ds-form',
    props: {},
    tokens: ['space.md'],
  };
  const ok = await post('code', {
    message: 'Change le spacing de ce composant',
    history: [],
    focus,
  });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(inputs[0]).focus.name, 'ExampleForm');
  assert.equal(
    (
      await post('code', {
        message: 'x',
        history: [],
        focus: { ...focus, script: 'non' },
      })
    ).status,
    400,
  );
});

test('un seul chat : Clodo peut choisir les tokens, soumis au diff', async (t) => {
  const { post, store } = await fixture(t, false, async () =>
    JSON.stringify({
      changes: [{ key: 'space.md', value: 12 }],
      files: [],
      message: 'Je resserre space.md : tous les composants qui l’utilisent.',
    }),
  );
  const response = await post('code', {
    message: 'Resserre les espacements',
    history: [],
  });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.proposal, null);
  assert.deepEqual(reply.tokenProposal.patches, [
    { key: 'space.md', type: 'dimension', before: 16, after: 12 },
  ]);
  assert.equal(reply.tokenProposal.source, 'claude');
  assert.equal(store.snapshot().revision, 0, 'rien avant validation');
});

test('Preview : formats et pages enregistrés, valeurs hors bornes refusées', async (t) => {
  const { origin, post } = await fixture(t);
  const initial = await (await fetch(origin + '/api/preview')).json();
  assert.deepEqual(
    initial.formats.map((f: { name: string }) => f.name),
    ['iPhone', 'Tablette', 'Desktop'],
  );
  const next = {
    ...initial,
    pages: [...initial.pages, { id: 'profil-ab12', name: 'Profil' }],
  };
  assert.equal((await post('preview', next)).status, 200);
  assert.deepEqual(await (await fetch(origin + '/api/preview')).json(), next);
  const tooWide = {
    ...next,
    formats: [{ id: 'x', name: 'X', width: 99999, height: 800 }],
  };
  assert.equal((await post('preview', tooWide)).status, 400);
});

test('Ouvrir un projet : dossier Git inspecté, liens invalides refusés', async (t) => {
  const { origin, post } = await fixture(t);
  assert.deepEqual(await (await fetch(origin + '/api/connection')).json(), {
    saved: {},
  });
  // Le dépôt de DS-Studio lui-même sert de dossier Git d'essai.
  const inspected = await (
    await post('connection/inspect', { folder: root })
  ).json();
  assert.equal(inspected.name, path.basename(root));
  assert.ok(inspected.git, 'dépôt Git détecté');
  assert.equal(
    (await post('connection/inspect', { folder: 'relatif' })).status,
    400,
  );
  assert.equal(
    (
      await post('connection', {
        folder: root,
        figmaUrl: 'https://evil.invalid/x',
      })
    ).status,
    400,
  );
  const figmaUrl = 'https://www.figma.com/design/KpumlnYQdqqk0j0Q0GxPmA/Test';
  const saved = await (
    await post('connection', { folder: root, figmaUrl })
  ).json();
  assert.equal(saved.saved.figmaUrl, figmaUrl);
  assert.equal(saved.project.name, path.basename(root));
  assert.deepEqual(
    (await (await fetch(origin + '/api/connection')).json()).saved,
    saved.saved,
  );
});

test('un DS par projet : le premier reprend l’existant, chacun garde le sien', async (t) => {
  const { origin, post } = await fixture(t);
  const state = async () => (await fetch(origin + '/api/state')).json();
  const commit = async (value: string) => {
    const proposal = await (
      await post('proposals', {
        revision: (await state()).revision,
        changes: [{ key: 'color.brand', value }],
      })
    ).json();
    assert.equal((await post('commit', { id: proposal.id })).status, 200);
  };
  await commit('#111111');
  // Dossiers temporaires : jamais le dépôt de DS-Studio comme projet.
  const first = await mkdtemp(path.join(tmpdir(), 'ds-premier-'));
  t.after(() => rm(first, { recursive: true, force: true }));
  // Premier projet ouvert : il reprend le DS déjà construit.
  assert.equal((await post('connection', { folder: first })).status, 200);
  assert.equal((await state()).tokens['color.brand'].$value, '#111111');
  await commit('#222222');
  const pages = await (await fetch(origin + '/api/preview')).json();
  pages.pages.push({ id: 'profil-ab12', name: 'Profil', path: '/profil' });
  assert.equal((await post('preview', pages)).status, 200);
  // Autre projet : DS de départ, Preview par défaut.
  const other = await mkdtemp(path.join(tmpdir(), 'ds-autre-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  assert.equal((await post('connection', { folder: other })).status, 200);
  const fresh = await state();
  assert.equal(fresh.revision, 0);
  assert.equal(fresh.tokens['color.brand'].$value, '#3F3F46');
  assert.equal(
    (await (await fetch(origin + '/api/preview')).json()).pages.length,
    2,
  );
  // Retour au premier : on retrouve ses tokens et ses pages.
  assert.equal((await post('connection', { folder: first })).status, 200);
  assert.equal((await state()).tokens['color.brand'].$value, '#222222');
  assert.equal(
    (await (await fetch(origin + '/api/preview')).json()).pages.at(-1).name,
    'Profil',
  );
});

test('plugin Figma : lecture seule, code d’appairage obligatoire et renouvelable', async (t) => {
  const { origin, post } = await fixture(t);
  const sync = (code?: string) =>
    fetch(origin + '/api/plugin/sync', {
      headers: { Origin: 'null', ...(code ? { 'X-DS-Plugin': code } : {}) },
    });
  assert.equal((await sync()).status, 403);
  assert.equal((await sync('0'.repeat(32))).status, 403);
  const preflight = await fetch(origin + '/api/plugin/sync', {
    method: 'OPTIONS',
    headers: { Origin: 'null' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
  const { token } = await (await fetch(origin + '/api/plugin/pairing')).json();
  const ok = await sync(token);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.tokens['color.brand'].$value, '#3F3F46');
  // Depuis l'origine du plugin, aucune autre route n'est ouverte.
  assert.equal(
    (
      await fetch(origin + '/api/state', {
        headers: { Origin: 'null', 'X-DS-Plugin': token },
      })
    ).status,
    403,
  );
  const renewed = await (await post('plugin/pairing/renew', {})).json();
  assert.notEqual(renewed.token, token);
  assert.equal((await sync(token)).status, 403, 'ancien code coupé');
  assert.equal((await sync(renewed.token)).status, 200);
});

test('plugin Figma : « localhost » accepté pour sa route seulement', async (t) => {
  const { origin } = await fixture(t);
  const port = new URL(origin).port;
  const { token } = await (await fetch(origin + '/api/plugin/pairing')).json();
  // Requête vers 127.0.0.1 avec l'en-tête Host « localhost », comme Figma.
  const get = (route: string) =>
    new Promise<number>((resolve, reject) =>
      http
        .get(
          {
            host: '127.0.0.1',
            port,
            path: route,
            headers: {
              Host: `localhost:${port}`,
              Origin: 'null',
              'X-DS-Plugin': token,
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        )
        .on('error', reject),
    );
  assert.equal(await get('/api/plugin/sync'), 200);
  assert.equal(await get('/api/state'), 403);
  assert.equal(await get('/api/plugin/pairing'), 403);
});
