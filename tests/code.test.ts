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
