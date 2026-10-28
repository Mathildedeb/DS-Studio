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

// Copie JSON : les objets du bac à sable vm ont un autre prototype.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const color = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
const variables = [
  { id: 'm1', collection: 'Master', name: 'color/Primary/purple/700', resolvedType: 'COLOR', value: color(0.6, 0, 1) },
  { id: 'm2', collection: 'Master', name: 'color/Neutral/900', resolvedType: 'COLOR', value: color(20 / 255, 20 / 255, 20 / 255) },
  { id: 'm3', collection: 'Master', name: 'color/Neutral/0', resolvedType: 'COLOR', value: color(0.98, 0.98, 0.98, 0.92) },
  { id: 'm4', collection: 'Master', name: 'color/Semantic/succes/Disable', resolvedType: 'COLOR', value: color(0, 0, 0) },
  { id: 'u1', collection: 'Usage color', name: 'text/secondaire', resolvedType: 'COLOR', value: { type: 'VARIABLE_ALIAS', id: 'm2' } },
  { id: 'u2', collection: 'Usage color', name: 'text/Default', resolvedType: 'COLOR', value: { type: 'VARIABLE_ALIAS', id: 'm3' } },
  { id: 'f1', collection: 'Font', name: 'Body-Font', resolvedType: 'STRING', value: 'General Sans' },
  { id: 's1', collection: 'Spacings', name: 'Spacings/compact/Spacing - 1', resolvedType: 'FLOAT', value: 6 },
  { id: 'd1', collection: 'DS-Studio', name: 'spacing/compact/1', resolvedType: 'FLOAT', value: 6 },
];

test('plugin Figma : un seul nom de token par variable, dans les deux sens', async () => {
  const { tokenKey, keyed } = await load();
  assert.equal(tokenKey('color/Primary/purple/700', 'Master'), 'color.primary.purple.700');
  assert.equal(tokenKey('Spacings/compact/Spacing - 1', 'Spacings'), 'spacings.compact.spacing1');
  assert.equal(tokenKey('Body-Font', 'Font'), 'font.bodyFont');
  assert.equal(tokenKey('Chaîne', 'Usage color'), 'usageColor.chaine');
  assert.equal(tokenKey('a/b/c/d/e', 'X'), 'a.b.c.dE');
  assert.equal(tokenKey('7/ok', 'X'), null);
  // Collision : la seconde prend sa collection devant ; doublons ignorés.
  const result = keyed([
    { id: 'a', collection: 'One', name: 'text/main' },
    { id: 'b', collection: 'Two', name: 'text/main' },
    { id: 'c', collection: 'DS-Studio', name: 'text/main' },
  ]);
  assert.deepEqual([...result.byKey.keys()], ['text.main', 'two.text.main']);
});

test('plugin Figma : récupérer, alias résolus, transparences et doublons écartés', async () => {
  const { collect } = await load();
  const { tokens, skipped } = plain(collect(variables));
  assert.deepEqual(tokens['color.primary.purple.700'], { $type: 'color', $value: '#9900FF' });
  assert.deepEqual(tokens['text.secondaire'], { $type: 'color', $value: '#141414' });
  assert.deepEqual(tokens['font.bodyFont'], { $type: 'fontFamily', $value: 'General Sans' });
  assert.deepEqual(tokens['spacings.compact.spacing1'], { $type: 'dimension', $value: 6 });
  assert.equal(tokens['color.neutral.0'], undefined);
  assert.equal(tokens['text.default'], undefined, 'alias vers une transparence');
  assert.deepEqual(
    skipped.map((s: { name: string }) => s.name).sort(),
    ['Collection « DS-Studio »', 'Master/color/Neutral/0', 'Usage color/text/Default'],
  );
});

test('plugin Figma : même nom, même changement ; un alias devient une valeur directe', async () => {
  const { plan } = await load();
  const result = plain(
    plan(
      {
        'color.primary.purple.700': { $type: 'color', $value: '#AA00FF' },
        'spacings.compact.spacing1': { $type: 'dimension', $value: 6 },
        'text.secondaire': { $type: 'color', $value: '#302636' },
        'color.semantic.succes.disable': { $type: 'color', $value: '#000000' },
        'text.default': { $type: 'color', $value: '#FFFFFF' },
        'color.neutral.0': { $type: 'color', $value: '#FAFAFA' },
        'color.accent': { $type: 'color', $value: '#123456' },
      },
      variables,
    ),
  );
  // text.secondaire est écrit lui-même ; sa base color.neutral.900 ne bouge pas.
  assert.deepEqual(
    result.updates.map((u: { id: string; after: string; detached: boolean }) => [u.id, u.after, u.detached]),
    [
      ['m1', '#AA00FF', false],
      ['u1', '#302636', true],
    ],
  );
  assert.deepEqual(result.retargets, []);
  // color.neutral.0 garde sa couleur : rien à écrire, sa transparence est intacte.
  assert.equal(result.same, 3);
  // text.default changerait une variable transparente : bloqué, jamais écrasé.
  assert.deepEqual(
    result.blocked.map((b: { key: string; reason: string }) => [b.key, b.reason]),
    [['text.default', 'variable transparente : à modifier dans Figma']],
  );
  assert.deepEqual(result.missing.map((m: { key: string }) => m.key), ['color.accent']);
});

test('plugin Figma : nouveau token créé chez ses voisines', async () => {
  const { plan } = await load();
  const result = plain(
    plan(
      {
        'color.primary.purple.850': { $type: 'color', $value: '#302636' },
        'color.accent': { $type: 'color', $value: '#123456' },
      },
      variables,
    ),
  );
  // Même collection et même forme de nom que color/Primary/purple/700.
  assert.deepEqual(
    result.creates.map((c: { key: string; collection: string; name: string }) => [c.key, c.collection, c.name]),
    [['color.primary.purple.850', 'Master', 'color/Primary/purple/850']],
  );
  // Sans voisine, aucune collection évidente : rien n'est créé.
  assert.deepEqual(result.missing.map((m: { key: string }) => m.key), ['color.accent']);
});

test('plugin Figma : liens d’alias récupérés, un alias suit sa base mise à jour', async () => {
  const { collect, plan } = await load();
  assert.deepEqual(plain(collect(variables)).aliases, { 'text.secondaire': 'color.neutral.900' });
  // La base change, l'alias qui la suit est « à jour » sans être rebranché.
  const result = plain(
    plan(
      {
        'color.neutral.900': { $type: 'color', $value: '#302636' },
        'text.secondaire': { $type: 'color', $value: '#302636' },
      },
      variables,
    ),
  );
  assert.deepEqual(result.updates.map((u: { id: string }) => u.id), ['m2']);
  assert.deepEqual(result.retargets, []);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.same, 1);
});

test('plugin Figma : couleur en minuscules dans DS-Studio, même couleur que dans Figma', async () => {
  const { plan } = await load();
  const result = plain(
    plan(
      {
        'color.primary.purple.700': { $type: 'color', $value: '#9900ff' },
        'color.neutral.900': { $type: 'color', $value: '#5b3b6d' },
        'text.secondaire': { $type: 'color', $value: '#5b3b6d' },
      },
      variables,
    ),
  );
  // Identique malgré la casse : rien à écrire, rien de signalé.
  assert.equal(result.same, 2);
  assert.deepEqual(result.updates.map((u: { id: string }) => u.id), ['m2']);
  assert.deepEqual(result.retargets, []);
  assert.deepEqual(result.blocked, []);
});
