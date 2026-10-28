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
