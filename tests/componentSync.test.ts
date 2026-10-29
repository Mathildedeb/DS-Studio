import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compareComponents, variantName } from '../app/shared/componentSync.js';
import type { PropSpec } from '../app/shared/props.js';

const plugin = createRequire(import.meta.url)('../figma-plugin/code.js');
const button = (options: string[]) => ({
  id: '2187:1348',
  name: 'button',
  page: 'Atoms',
  props: [
    { name: 'style', type: 'VARIANT' as const, options },
    { name: 'Size', type: 'VARIANT' as const, options: ['small', 'Par défaut'] },
    { name: 'label', type: 'TEXT' as const, default: 'content' },
  ],
});
const specs = (variants: string[]): PropSpec[] => [
  { name: 'variant', kind: 'enum', options: variants, required: false, doc: 'Variante Figma « style »' },
  { name: 'size', kind: 'enum', options: ['small', 'default'], required: false },
];
const file = 'src/components/atoms/Button/Button.tsx';

test('synchro composants : écarts, provenance, synonymes, non pris en charge', () => {
  const first = compareComponents([{ figma: button(['filled', 'outline']), file, specs: specs(['filled', 'outline']) }], {});
  // « Par défaut » ↔ « default » : à jour ; la propriété texte est signalée.
  assert.deepEqual(first.items, []);
  assert.equal(first.synced.length, 2);
  assert.deepEqual(first.unsupported.map((u) => u.property), ['label']);

  // Nouveau dans Figma (ghost) et nouveau dans le code (link), registre connu.
  const later = compareComponents(
    [{ figma: button(['filled', 'outline', 'ghost']), file, specs: specs(['filled', 'outline', 'link']) }],
    first.ledger,
  );
  assert.deepEqual(
    later.items.map((i) => [i.value, i.kind, i.codeProp]),
    [
      ['ghost', 'figma', 'variant'],
      ['link', 'code', 'variant'],
    ],
  );
  // Retirée du code depuis la synchro : signalée, jamais recréée dans le code.
  const removed = compareComponents([{ figma: button(['filled', 'outline']), file, specs: specs(['filled']) }], first.ledger);
  assert.deepEqual(removed.items.map((i) => [i.value, i.kind]), [['outline', 'removed-code']]);
});

test('synchro composants : conflit à la première rencontre, pas de boucle après synchro', () => {
  const conflict = compareComponents([{ figma: button(['filled', 'ghost']), file, specs: specs(['filled', 'link']) }], {});
  assert.deepEqual(conflict.items.map((i) => i.kind), ['conflict', 'conflict']);
  // Une fois la variante créée dans Figma, les deux côtés sont égaux : plus
  // aucun écart, et le registre retient la nouvelle liste.
  const base = compareComponents([{ figma: button(['filled']), file, specs: specs(['filled']) }], {});
  const after = compareComponents([{ figma: button(['filled', 'link']), file, specs: specs(['filled', 'link']) }], base.ledger);
  assert.deepEqual(after.items, []);
  assert.deepEqual(after.ledger['2187:1348'].style.values, ['filled', 'link']);
});

test('plugin : nom de la nouvelle variante et propriétés lues', () => {
  assert.equal(variantName('style=filled, Size=small', 'style', 'ghost'), 'style=ghost, Size=small');
  assert.equal(plugin.variantName('style=filled, Size=small', 'Size', 'large'), 'style=filled, Size=large');
  assert.deepEqual(
    plugin.componentProps({
      style: { type: 'VARIANT', variantOptions: ['filled', 'ghost'], defaultValue: 'filled' },
      'label#12:3': { type: 'TEXT', defaultValue: 'content' },
    }),
    [
      { name: 'style', type: 'VARIANT', options: ['filled', 'ghost'], default: 'filled' },
      { name: 'label', type: 'TEXT', default: 'content' },
    ],
  );
});

test('synchro composants : un booléen du code vaut une variante à deux états', () => {
  const checkbox = { id: '1:1', name: 'check-box-content', page: 'Molécules', props: [{ name: 'state', type: 'VARIANT' as const, options: ['Default', 'yes'] }] };
  const spec: PropSpec[] = [{ name: 'checked', kind: 'boolean', required: false, doc: 'Variante Figma « state » : true = yes' }];
  assert.deepEqual(compareComponents([{ figma: checkbox, file: 'x.tsx', specs: spec }], {}).items, []);
});
