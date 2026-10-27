import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../app/server/store.js';
import { tokensSchema, contrast } from '../app/shared/model.js';
const seed = tokensSchema.parse(
  JSON.parse(
    await readFile(new URL('./fixtures/tokens.json', import.meta.url), 'utf8'),
  ),
);
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir, seed);
  await store.init();
  return { dir, store };
}
test('proposition sans écriture, commit, redémarrage réel du store et annulation sélective', async (t) => {
  const { dir, store } = await fixture(t);
  const before = await readFile(store.file, 'utf8');
  const p = store.propose(0, [{ key: 'color.brand', value: '#AA2255' }]);
  assert.equal(await readFile(store.file, 'utf8'), before);
  await store.commit(p.id);
  const r = store.propose(1, [{ key: 'space.md', value: 22 }]);
  await store.commit(r.id);
  const reopened = new Store(dir, seed);
  await reopened.init();
  assert.equal(reopened.snapshot().tokens['color.brand'].$value, '#AA2255');
  const undo = reopened.proposeUndo(2, p.id);
  await reopened.commit(undo.id);
  assert.equal(
    reopened.snapshot().tokens['color.brand'].$value,
    seed['color.brand'].$value,
  );
  assert.equal(reopened.snapshot().tokens['space.md'].$value, 22);
  assert.equal(reopened.snapshot().history.length, 3);
});
test('concurrence : une seule proposition de la même révision peut être acceptée', async (t) => {
  const { store } = await fixture(t);
  const a = store.propose(0, [{ key: 'color.brand', value: '#112233' }]);
  const b = store.propose(0, [{ key: 'space.sm', value: 9 }]);
  const results = await Promise.allSettled([
    store.commit(a.id),
    store.commit(b.id),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(store.snapshot().revision, 1);
  await assert.rejects(() => store.commit(a.id), /inconnue/);
  assert.throws(
    () => store.propose(0, [{ key: 'space.sm', value: 4 }]),
    /changé/,
  );
});
test('annulation refuse de perdre un changement plus récent du même token', async (t) => {
  const { store } = await fixture(t);
  const p = store.propose(0, [{ key: 'color.brand', value: '#112233' }]);
  await store.commit(p.id);
  await store.commit(
    store.propose(1, [{ key: 'color.brand', value: '#445566' }]).id,
  );
  assert.throws(() => store.proposeUndo(2, p.id), /Conflit/);
});
test('entrées, imports et types invalides sont rejetés sans effet disque', async (t) => {
  const { store } = await fixture(t);
  const raw = await readFile(store.file, 'utf8');
  for (const value of ['red', 'url(https://invalid.test)', 12, '#FFF'])
    assert.throws(() => store.propose(0, [{ key: 'color.brand', value }]));
  for (const value of [-1, 129, Infinity, '18'])
    assert.throws(() => store.propose(0, [{ key: 'space.md', value }]));
  assert.throws(
    () =>
      store.propose(0, [
        { key: 'space.md', value: 12 },
        { key: 'space.md', value: 14 },
      ]),
    /deux fois/,
  );
  assert.throws(() =>
    store.proposeImport(0, { 'Pas un nom': seed['color.brand'] }),
  );
  assert.throws(
    () => store.propose(0, [{ key: 'color.neuf', value: '#123456' }]),
    /Type requis/,
  );
  assert.throws(() =>
    store.propose(0, [{ key: 'space.md', type: 'color', value: '#123456' }]),
  );
  assert.throws(() => store.proposeImport(0, { ...seed, secret: 'no' }));
  assert.throws(() =>
    store.propose(0, [{ key: 'font.family', value: 'url(evil)' }]),
  );
  assert.equal(await readFile(store.file, 'utf8'), raw);
});
test('import local passe par le même diff et la validation', async (t) => {
  const { store } = await fixture(t);
  const tokens = structuredClone(seed);
  tokens['color.brand'].$value = '#774422';
  tokens['space.md'].$value = 20;
  const p = store.proposeImport(0, tokens);
  assert.equal(p.source, 'import');
  assert.equal(p.patches.length, 2);
  assert.equal(store.snapshot().revision, 0);
  await store.commit(p.id);
  assert.deepEqual(store.snapshot().tokens, tokens);
});
test('fichier corrompu et historique falsifié préservés sans reset silencieux', async (t) => {
  const { dir, store } = await fixture(t);
  for (const raw of [
    '{bad',
    JSON.stringify({ ...store.snapshot(), revision: 42 }),
  ]) {
    await writeFile(store.file, raw);
    await assert.rejects(
      () => new Store(dir, seed).init(),
      /original préservé/,
    );
    assert.equal(await readFile(store.file, 'utf8'), raw);
  }
});
test('modification extérieure détectée avant écrasement', async (t) => {
  const { store } = await fixture(t);
  const p = store.propose(0, [{ key: 'space.sm', value: 9 }]);
  await writeFile(store.file, 'changed externally');
  await assert.rejects(() => store.commit(p.id), /hors application/);
  assert.equal(await readFile(store.file, 'utf8'), 'changed externally');
});
test(
  'symlink vers un dossier externe refusé',
  {
    skip:
      process.platform === 'win32'
        ? 'Droits symlink Windows à qualifier'
        : false,
  },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ds-links-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, 'target'));
    await symlink(path.join(dir, 'target'), path.join(dir, 'link'));
    await assert.rejects(
      () => new Store(path.join(dir, 'link'), seed).init(),
      /symbolique refusé/,
    );
  },
);
test('contraste noir/blanc et identité', () => {
  assert.equal(contrast('#000000', '#FFFFFF'), 21);
  assert.equal(contrast('#123456', '#123456'), 1);
});

test('copie précédente complète, restauration explicite et original corrompu archivé', async (t) => {
  const { store, dir } = await fixture(t);
  const { restorePrevious } = await import('../app/server/store.js');
  const original = await readFile(store.file, 'utf8');
  await store.commit(
    store.propose(0, [{ key: 'color.brand', value: '#445566' }]).id,
  );
  assert.equal(
    await readFile(path.join(dir, 'state.previous.json'), 'utf8'),
    original,
  );
  await writeFile(store.file, '{interruption');
  const restored = await restorePrevious(dir);
  assert.equal(restored.revision, 0);
  assert.equal(
    await readFile(path.join(dir, restored.preserved), 'utf8'),
    '{interruption',
  );
  assert.equal(await readFile(store.file, 'utf8'), original);
  const reopened = new Store(dir, {
    ...seed,
    'color.brand': { $type: 'color', $value: '#000000' },
  });
  await reopened.init();
  assert.equal(
    reopened.snapshot().tokens['color.brand'].$value,
    seed['color.brand'].$value,
    'Une mise à jour du seed ne réinitialise jamais un état existant',
  );
});

test('copie précédente falsifiée : restauration refusée sans toucher l’original', async (t) => {
  const { store, dir } = await fixture(t);
  const { restorePrevious } = await import('../app/server/store.js');
  const original = await readFile(store.file, 'utf8');
  await writeFile(path.join(dir, 'state.previous.json'), '{invalid');
  await assert.rejects(() => restorePrevious(dir));
  assert.equal(await readFile(store.file, 'utf8'), original);
});

test('échec de sauvegarde : commit non appliqué et brouillon encore validable', async (t) => {
  const { store, dir } = await fixture(t);
  const original = await readFile(store.file, 'utf8');
  const backup = path.join(dir, 'state.previous.json');
  await mkdir(backup);
  const p = store.propose(0, [{ key: 'space.md', value: 24 }]);
  await assert.rejects(() => store.commit(p.id));
  assert.equal(store.snapshot().revision, 0);
  assert.equal(await readFile(store.file, 'utf8'), original);
  await rm(backup, { recursive: true });
  await store.commit(p.id);
  assert.equal(store.snapshot().revision, 1);
});

test(
  'lien ajouté après ouverture : commit refusé sans lire ni modifier sa cible',
  {
    skip:
      process.platform === 'win32'
        ? 'Droits symlink non accordés sur Windows'
        : false,
  },
  async (t) => {
    const { store, dir } = await fixture(t);
    const target = path.join(dir, 'outside.json');
    const original = await readFile(store.file, 'utf8');
    await writeFile(target, original);
    await rm(store.file);
    await symlink(target, store.file);
    const p = store.propose(0, [{ key: 'space.md', value: 24 }]);
    await assert.rejects(() => store.commit(p.id));
    assert.equal(await readFile(target, 'utf8'), original);
  },
);

test('V2 : tokens en liste libre, ajout et suppression dans le journal', async (t) => {
  const { dir, store } = await fixture(t);
  const add = store.propose(0, [
    { key: 'color.accent', type: 'color', value: '#112233' },
  ]);
  assert.deepEqual(add.patches, [
    { key: 'color.accent', type: 'color', before: null, after: '#112233' },
  ]);
  await store.commit(add.id);
  const remove = store.propose(1, [{ key: 'space.lg', value: null }]);
  await store.commit(remove.id);
  assert.equal(store.snapshot().tokens['space.lg'], undefined);
  // Tout vider : un import vide supprime chaque token, annulable ensuite.
  const empty = store.proposeImport(2, {});
  await store.commit(empty.id);
  assert.deepEqual(store.snapshot().tokens, {});
  const reopened = new Store(dir, seed);
  await reopened.init();
  assert.deepEqual(reopened.snapshot().tokens, {});
  const undo = reopened.proposeUndo(3, reopened.snapshot().history[2].id);
  await reopened.commit(undo.id);
  assert.equal(reopened.snapshot().tokens['color.accent'].$value, '#112233');
  assert.equal(reopened.snapshot().tokens['space.lg'], undefined);
});
test('V2 : migration d’un état v1, journal conservé et original sauvegardé', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-migrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = structuredClone(seed);
  const after = structuredClone(seed);
  after['color.brand'].$value = '#ABCDEF';
  after['space.md'].$value = 20;
  const v1 = {
    version: 1,
    revision: 1,
    tokens: after,
    history: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        revision: 1,
        date: '2026-10-27T10:00:00.000Z',
        source: 'manual',
        patches: [
          {
            key: 'color.brand',
            before: before['color.brand'].$value,
            after: '#ABCDEF',
          },
          { key: 'space.md', before: before['space.md'].$value, after: 20 },
        ],
      },
    ],
  };
  const raw = JSON.stringify(v1, null, 2) + '\n';
  await writeFile(path.join(dir, 'state.json'), raw);
  const store = new Store(dir, seed);
  await store.init();
  const state = store.snapshot();
  assert.equal(state.version, 2);
  assert.deepEqual(state.tokens, after);
  assert.deepEqual(
    state.history[0].patches.map((p) => p.type),
    ['color', 'dimension'],
  );
  const saved = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(saved.version, 2);
  const { readdir } = await import('node:fs/promises');
  const backup = (await readdir(dir)).find((f) => f.startsWith('state.v1-'));
  assert(backup, 'original v1 conservé');
  assert.equal(await readFile(path.join(dir, backup), 'utf8'), raw);
  // L'historique migré reste annulable.
  const undo = store.proposeUndo(1, state.history[0].id);
  await store.commit(undo.id);
  assert.deepEqual(store.snapshot().tokens, before);
});
