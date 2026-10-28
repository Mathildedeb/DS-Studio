import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codedFor } from '../app/shared/components.js';

const code = [
  { name: 'Avatar', file: 'src/components/atoms/Avatar/Avatar.tsx' },
  { name: 'CalendarDateItem', file: 'src/components/atoms/CalendarDateItem.tsx' },
  { name: 'Toggle', file: 'src/components/atoms/Toggle/index.tsx' },
  { name: 'Menu', file: 'src/components/organisms/Menu.tsx' },
  { name: 'Menu', file: 'src/components/molecules/Menu.tsx' },
];

test('composants : nom Figma relié au composant déjà codé, sans deviner', () => {
  assert.equal(codedFor('avatar', code)?.file, 'src/components/atoms/Avatar/Avatar.tsx');
  // Nom complet d'abord, puis dernier segment s'il est unique.
  assert.equal(codedFor('calendar/date-item', code)?.name, 'CalendarDateItem');
  assert.equal(codedFor('button/toggle', code)?.name, 'Toggle');
  // Deux fichiers « Menu » : ambigu, rien n'est deviné.
  assert.equal(codedFor('cell/menu', code), undefined);
  assert.equal(codedFor('chart/legend', code), undefined);
  // Correspondance forcée dans design-system/components.json.
  assert.equal(
    codedFor('cell/menu', code, { 'cell/menu': 'src/components/molecules/Menu.tsx' })?.file,
    'src/components/molecules/Menu.tsx',
  );
});
