import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviseChange } from '../app/shared/advice.js';
import type { Tokens } from '../app/shared/model.js';

const c = (v: string) => ({ $type: 'color' as const, $value: v });
const tokens: Tokens = {
  'color.primary.purple.700': c('#9900FF'),
  'color.primary.purple.800': c('#41006B'),
  'color.primary.purple.850': c('#302636'),
  'color.primary.purple.900': c('#270041'),
  'color.neutral.100': c('#F0F0F0'),
  'background.composant.dark': c('#302636'),
  'text.hoverButton': c('#FFFFFF'),
  'text.dark': c('#9900FF'),
  'text.light': c('#D699FF'),
};

test('conseils avant validation : une ligne par sujet, le groupe jamais comparé à lui-même', () => {
  const advice = adviseChange(
    [
      { key: 'background.composant.dark', type: 'color', before: '#302636', after: '#5b3b6d' },
      { key: 'color.primary.purple.850', type: 'color', before: '#302636', after: '#5b3b6d' },
    ],
    tokens,
    { 'background.composant.dark': 'color.primary.purple.850' },
  );
  assert.deepEqual(
    advice.map((a) => `${a.level}:${a.text}`),
    [
      'warn:Lisibilité de #5B3B6D : illisible avec text.dark · grand texte seulement avec text.light · 1 combinaison(s) lisible(s)',
      'warn:Échelle color.primary.purple : 850 deviendrait plus clair que 800.',
      'info:Suivent aussi : 1 usage(s) (background.composant.dark).',
    ],
  );

  // Un usage modifié seul : il perd son lien avec sa base dans Figma.
  const alone = adviseChange(
    [{ key: 'background.composant.dark', type: 'color', before: '#302636', after: '#1A1A1A' }],
    tokens,
    { 'background.composant.dark': 'color.primary.purple.850' },
  );
  assert.equal(alone.at(-1)?.text, 'Dans Figma, background.composant.dark perd(ent) le lien avec sa base.');

  // Un neutre saturé est signalé.
  const red = adviseChange(
    [{ key: 'color.neutral.100', type: 'color', before: '#F0F0F0', after: '#D51E1E' }],
    tokens,
  );
  assert.deepEqual(red.map((a) => a.text), ['color.neutral.100 ne serait plus un gris neutre.']);
});
