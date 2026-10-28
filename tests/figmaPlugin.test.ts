import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Le code du plugin tourne dans Figma ; ses fonctions pures sont testées ici.
const load = async () => {
  const context = { module: { exports: {} as Record<string, Function> } };
  vm.runInNewContext(
    await readFile(new URL('../figma-plugin/code.js', import.meta.url), 'utf8'),
    context,
  );
  return context.module.exports;
};

test('plugin Figma : tokens rapprochés des variables, plan sans surprise', async () => {
  const { plan, norm } = await load();
  assert.equal(norm('Master/primary/purple/700'), 'master.primary.purple.700');
  const variables = [
    {
      id: 'v1',
      name: 'primary/purple/700',
      path: 'Master/primary/purple/700',
      resolvedType: 'COLOR',
      value: { r: 0.6, g: 0, b: 1, a: 1 },
    },
    {
      id: 'v2',
      name: 'spacing/default/2',
      path: 'Spacing/spacing/default/2',
      resolvedType: 'FLOAT',
      value: 16,
    },
    {
      id: 'v3',
      name: 'text/default',
      path: 'Usage/text/default',
      resolvedType: 'COLOR',
      value: { type: 'VARIABLE_ALIAS', id: 'v1' },
    },
  ];
  // Copie JSON : les tableaux du bac à sable vm ont un autre prototype.
  const result = JSON.parse(
    JSON.stringify(
      plan(
        {
          'color.primary.purple.700': { $type: 'color', $value: '#AA00FF' },
          'spacing.default.2': { $type: 'dimension', $value: 16 },
          'usage.text.default': { $type: 'color', $value: '#9900FF' },
          'color.accent': { $type: 'color', $value: '#123456' },
        },
        variables,
      ),
    ),
  );
  assert.deepEqual(
    result.updates.map((u: { id: string; before: string; after: string }) => [
      u.id,
      u.before,
      u.after,
    ]),
    [['v1', '#9900FF', '#AA00FF']],
  );
  assert.equal(result.same, 1);
  assert.deepEqual(result.aliased, ['usage.text.default']);
  assert.deepEqual(
    result.missing.map((m: { key: string }) => m.key),
    ['color.accent'],
  );
});
