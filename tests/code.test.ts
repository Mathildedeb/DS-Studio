import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeStore } from '../app/server/code.js';
import { proposeCode, type Ask } from '../connectors/agents/coder.js';

async function project(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-code-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'app', 'client'), { recursive: true });
  await mkdir(path.join(root, 'app', 'server'), { recursive: true });
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(
    path.join(root, 'app', 'client', 'Card.tsx'),
    'const radius = 8;\nconst label = "Carte";\n',
  );
  await writeFile(path.join(root, 'app', 'server', 'http.ts'), 'secret();\n');
  await writeFile(path.join(root, 'workspace', 'PFE.md'), '# PFE\n');
  await writeFile(path.join(root, '.env'), 'FIGMA_TOKEN=faux\n');
  const data = path.join(root, '.ds-studio');
  await mkdir(data);
  return { root, code: new CodeStore(root, data) };
}
const card = (root: string) =>
  readFile(path.join(root, 'app', 'client', 'Card.tsx'), 'utf8');

test('code : liste blanche, aucun fichier serveur, secret ni chemin détourné', async (t) => {
  const { code } = await project(t);
  const listed = (await code.catalogue()).map((f) => f.file);
  assert.deepEqual(listed, ['app/client/Card.tsx', 'workspace/PFE.md']);
  for (const file of [
    'app/server/http.ts',
    '.env',
    '../etc/passwd',
    'app/client/../server/http.ts',
    'package.json',
    'tests/code.test.ts',
  ])
    await assert.rejects(
      () => code.propose([{ file, search: 'a', replace: 'b' }]),
      /non modifiable|refusé/,
    );
});
test('code : lien symbolique refusé même avec un nom autorisé', async (t) => {
  const { root, code } = await project(t);
  await symlink(
    path.join(root, '.env'),
    path.join(root, 'app', 'client', 'Lien.tsx'),
  );
  await assert.rejects(
    () =>
      code.propose([
        { file: 'app/client/Lien.tsx', search: 'F', replace: 'x' },
      ]),
    /non sûr/,
  );
});
test('code : passage introuvable ou ambigu, rien de préparé', async (t) => {
  const { root, code } = await project(t);
  await assert.rejects(
    () =>
      code.propose([
        { file: 'app/client/Card.tsx', search: 'absent', replace: 'x' },
      ]),
    /introuvable/,
  );
  await assert.rejects(
    () =>
      code.propose([
        { file: 'app/client/Card.tsx', search: 'const', replace: 'let' },
      ]),
    /ambigu/,
  );
  assert.equal(await card(root), 'const radius = 8;\nconst label = "Carte";\n');
});
test('code : rien écrit avant validation, usage unique, puis annulation', async (t) => {
  const { root, code } = await project(t);
  const p = await code.propose([
    {
      file: 'app/client/Card.tsx',
      search: 'radius = 8',
      replace: 'radius = 16',
    },
  ]);
  assert.deepEqual(p.hunks[0], {
    file: 'app/client/Card.tsx',
    line: 1,
    removed: ['radius = 8'],
    added: ['radius = 16'],
  });
  assert.match(await card(root), /radius = 8;/);
  await code.apply(p.id);
  assert.match(await card(root), /radius = 16;/);
  await assert.rejects(() => code.apply(p.id), /expirée ou déjà traitée/);
  assert.deepEqual(await code.last(), {
    id: p.id,
    files: ['app/client/Card.tsx'],
  });
  await code.revert(p.id);
  assert.match(await card(root), /radius = 8;/);
  assert.equal(await code.last(), null);
});
test('code : fichier changé entre proposition et validation, écriture refusée', async (t) => {
  const { root, code } = await project(t);
  const p = await code.propose([
    {
      file: 'app/client/Card.tsx',
      search: 'radius = 8',
      replace: 'radius = 16',
    },
  ]);
  await writeFile(
    path.join(root, 'app', 'client', 'Card.tsx'),
    'modifié ailleurs\n',
  );
  await assert.rejects(() => code.apply(p.id), /a changé/);
  assert.equal(await card(root), 'modifié ailleurs\n');
});
test('code : annulation refusée si le fichier a été retouché depuis', async (t) => {
  const { root, code } = await project(t);
  const p = await code.propose([
    {
      file: 'app/client/Card.tsx',
      search: 'radius = 8',
      replace: 'radius = 16',
    },
  ]);
  await code.apply(p.id);
  await writeFile(
    path.join(root, 'app', 'client', 'Card.tsx'),
    'nouveau travail\n',
  );
  await assert.rejects(() => code.revert(p.id), /modifié depuis/);
  assert.equal(await card(root), 'nouveau travail\n');
});
test('Clodo : choisit des fichiers, ne reçoit que la liste blanche, propose un diff', async (t) => {
  const { root, code } = await project(t);
  const inputs: string[] = [];
  const answers = [
    JSON.stringify({ files: ['app/client/Card.tsx', 'app/server/http.ts'] }),
    '```json\n' +
      JSON.stringify({
        message: 'Je passe le rayon à 12.',
        edits: [
          {
            file: 'app/client/Card.tsx',
            search: 'radius = 8',
            replace: 'radius = 12',
          },
        ],
      }) +
      '\n```',
  ];
  const ask: Ask = async (_system, input) => {
    inputs.push(input);
    return answers.shift()!;
  };
  const result = await proposeCode(ask, code, 'Arrondis la carte', []);
  assert.equal(result.message, 'Je passe le rayon à 12.');
  assert(result.proposal);
  assert(!inputs[0].includes('FIGMA_TOKEN') && !inputs[0].includes('http.ts'));
  const sent = JSON.parse(inputs[1]).files;
  assert.deepEqual(Object.keys(sent), ['app/client/Card.tsx']);
  assert.match(await card(root), /radius = 8;/, 'rien écrit sans validation');
});
test('Clodo : réponse illisible ou sans fichier, aucune proposition', async (t) => {
  const { code } = await project(t);
  await assert.rejects(
    () => proposeCode(async () => 'pas du JSON', code, 'x', []),
    /illisible/,
  );
  const none = await proposeCode(
    async () => JSON.stringify({ files: [], message: 'Hors du code.' }),
    code,
    'Quelle heure est-il ?',
    [],
  );
  assert.deepEqual(none, { message: 'Hors du code.', proposal: null });
});

test('projet ouvert : Clodo ne voit que le code source, crée et annule un fichier', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-projet-'));
  const data = await mkdtemp(path.join(tmpdir(), 'ds-donnees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(data, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'x'), { recursive: true });
  await writeFile(path.join(root, 'src', 'App.tsx'), 'export const App = 1;\n');
  await writeFile(path.join(root, 'node_modules', 'x', 'index.js'), 'x');
  await writeFile(path.join(root, 'package.json'), '{"scripts":{}}');
  await writeFile(path.join(root, 'vite.config.ts'), 'export default {};');
  await writeFile(path.join(root, '.env'), 'SECRET=1');
  const code = new CodeStore(root, data, true);
  assert.deepEqual(
    (await code.catalogue()).map((f) => f.file),
    ['src/App.tsx'],
  );
  for (const file of [
    'package.json',
    'vite.config.ts',
    '.env',
    'node_modules/x/index.js',
    '../dehors.ts',
  ])
    assert.equal(code.isEditable(file), false, file);
  // Création d'une page : search vide, puis annulation qui supprime le fichier.
  const p = await code.propose([
    {
      file: 'src/pages/Profil.tsx',
      search: '',
      replace: 'export const Profil = () => null;\n',
    },
  ]);
  assert.equal(p.hunks[0].removed.length, 0);
  await assert.rejects(
    code.propose([{ file: 'src/App.tsx', search: '', replace: 'x' }]),
    /existe déjà/,
  );
  await code.apply(p.id);
  const created = path.join(root, 'src', 'pages', 'Profil.tsx');
  assert.match(await readFile(created, 'utf8'), /Profil/);
  await code.revert(p.id);
  await assert.rejects(readFile(created, 'utf8'));
  // Hors projet, la création reste interdite.
  const studio = new CodeStore(root, data);
  await assert.rejects(
    studio.propose([{ file: 'app/client/Neuf.tsx', search: '', replace: 'x' }]),
    /Création refusée/,
  );
});

test('projet ouvert : un fichier choisi mais absent est proposé à la création', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-projet-'));
  const data = await mkdtemp(path.join(tmpdir(), 'ds-donnees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(data, { recursive: true, force: true }));
  const inputs: string[] = [];
  const answers = [
    JSON.stringify({ files: ['src/Accueil.tsx'] }),
    JSON.stringify({
      message: 'Je crée la page Accueil.',
      edits: [
        {
          file: 'src/Accueil.tsx',
          search: '',
          replace: 'export const Accueil = () => null;\n',
        },
      ],
    }),
  ];
  const ask: Ask = async (system, input) => {
    inputs.push(system + '\n' + input);
    return answers.shift()!;
  };
  const reply = await proposeCode(
    ask,
    new CodeStore(root, data, true),
    'crée une page accueil',
    [],
    undefined,
    undefined,
    {},
    'mon-proto',
  );
  assert.ok(reply.proposal);
  assert.match(inputs[0], /projet « mon-proto »/);
  assert.deepEqual(JSON.parse(inputs[1].split('\n').at(-1)!).new_files, [
    'src/Accueil.tsx',
  ]);
});

test('Clodo lit les composants Figma qu’il choisit avant de coder', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ds-projet-'));
  const data = await mkdtemp(path.join(tmpdir(), 'ds-donnees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(data, { recursive: true, force: true }));
  const inputs: string[] = [];
  const answers = [
    JSON.stringify({ files: ['src/Button.tsx'], figma: ['1:2'] }),
    JSON.stringify({ message: 'Rien.', edits: [] }),
  ];
  const ask: Ask = async (_system, input) => {
    inputs.push(input);
    return answers.shift()!;
  };
  const asked: string[] = [];
  await proposeCode(
    ask,
    new CodeStore(root, data, true),
    'récupère le bouton de Figma',
    [],
    undefined,
    undefined,
    {},
    'mon-proto',
    {
      components: [{ id: '1:2', name: 'button', page: 'Atoms', variants: 20 }],
      node: async (id) => {
        asked.push(id);
        return { id, name: 'button', layout: { mode: 'HORIZONTAL', gap: 8 } };
      },
    },
  );
  assert.equal(JSON.parse(inputs[0]).figma_components[0].name, 'button');
  assert.deepEqual(asked, ['1:2']);
  assert.equal(JSON.parse(inputs[1]).figma_nodes['1:2'].layout.gap, 8);
});
