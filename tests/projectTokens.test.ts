import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertDtcg } from '../app/server/projectTokens.js';

test('tokens DTCG du projet : alias résolus, valeurs non portables listées', () => {
  const { tokens, skipped } = convertDtcg({
    $description: 'extrait de Figma',
    color: {
      primary: { purple: { '700': { $type: 'color', $value: '#9900ff' } } },
      overlay: { $type: 'color', $value: 'rgba(0, 0, 0, 0.5)' },
    },
    usage: {
      text: {
        'extra-light': { $type: 'color', $value: '{color.primary.purple.700}' },
      },
    },
    spacing: { $type: 'dimension', default: { '2': { $value: '16px' } } },
    size: { full: { $type: 'dimension', $value: '1073px' } },
    font: { family: { title: { $type: 'fontFamily', $value: 'Faune' } } },
    shadow: { soft: { $type: 'shadow', $value: { blur: '10px' } } },
  });
  assert.deepEqual(tokens, {
    'color.primary.purple.700': { $type: 'color', $value: '#9900FF' },
    'usage.text.extraLight': { $type: 'color', $value: '#9900FF' },
    'spacing.default.2': { $type: 'dimension', $value: 16 },
    'size.full': { $type: 'dimension', $value: 1073 },
    'font.family.title': { $type: 'fontFamily', $value: 'Faune' },
  });
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ['couleur avec transparence', 'type shadow'],
  );
});

test('fichier de tokens trouvé ailleurs que dans design-system/', async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { readProjectTokens } = await import('../app/server/projectTokens.js');
  const root = await mkdtemp(path.join(tmpdir(), 'ds-tokens-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(readProjectTokens(root), /Aucun fichier de tokens/);
  await mkdir(path.join(root, 'src', 'theme'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'x'), { recursive: true });
  await writeFile(
    path.join(root, 'node_modules', 'x', 'tokens.json'),
    '{"a":{"b":{"$type":"color","$value":"#000000"}}}',
  );
  await writeFile(
    path.join(root, 'src', 'theme', 'design-tokens.json'),
    '{"color":{"brand":{"$type":"color","$value":"#123456"}}}',
  );
  const found = await readProjectTokens(root);
  assert.equal(found.file, 'src/theme/design-tokens.json');
  assert.deepEqual(Object.keys(found.tokens), ['color.brand']);
});

test('tokens validés écrits dans le fichier DTCG du projet', async (t) => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { writeProjectTokens } = await import('../app/server/projectTokens.js');
  const root = await mkdtemp(path.join(tmpdir(), 'ds-ecrire-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'design-system'));
  const file = path.join(root, 'design-system', 'tokens.json');
  await writeFile(
    file,
    JSON.stringify({
      $description: 'garde',
      color: {
        brand: { $type: 'color', $value: '#111111' },
        old: { $type: 'color', $value: '#222222' },
        shadowy: { $type: 'color', $value: 'rgba(0,0,0,.5)' },
      },
      usage: { text: { $type: 'color', $value: '{color.brand}' } },
      spacing: { md: { $type: 'dimension', $value: '16px' } },
    }),
  );
  await writeProjectTokens(root, {
    'color.brand': { $type: 'color', $value: '#333333' },
    'usage.text': { $type: 'color', $value: '#111111' },
    'spacing.md': { $type: 'dimension', $value: 20 },
    'color.accent': { $type: 'color', $value: '#444444' },
  });
  const json = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(json.$description, 'garde');
  assert.equal(json.color.brand.$value, '#333333');
  assert.equal(json.color.old, undefined, 'supprimé dans DS-Studio');
  assert.equal(
    json.color.shadowy.$value,
    'rgba(0,0,0,.5)',
    'non porté : gardé',
  );
  assert.equal(json.color.accent.$value, '#444444', 'ajouté');
  assert.equal(json.spacing.md.$value, '20px', 'unité gardée');
  // L'alias suivait l'ancienne valeur : DS-Studio a figé #111111, écrit en clair.
  assert.equal(json.usage.text.$value, '#111111');
});

test('un fichier qui n’est pas un DTCG n’est jamais réécrit', async (t) => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { writeProjectTokens } = await import('../app/server/projectTokens.js');
  const root = await mkdtemp(path.join(tmpdir(), 'ds-plat-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'design-system'));
  const file = path.join(root, 'design-system', 'tokens.json');
  const flat = '{"color.brand":{"$type":"color","$value":"#111111"}}';
  await writeFile(file, flat);
  assert.equal(
    await writeProjectTokens(root, {
      'color.brand': { $type: 'color', $value: '#222222' },
    }),
    undefined,
  );
  assert.equal(await readFile(file, 'utf8'), flat);
});
