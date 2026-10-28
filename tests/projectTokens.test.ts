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
