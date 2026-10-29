import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readProps } from '../app/shared/props.js';
import {
  addInstance,
  duplicateInstance,
  moveInstance,
  planSchema,
  removeInstance,
  setProp,
} from '../app/shared/pagePlan.js';
import { bridgeFiles } from '../app/server/bridge.js';

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/components/${name}.tsx`, import.meta.url), 'utf8');

test('propriétés lues dans le vrai code : types, valeurs, défauts, rien d’inventé', async () => {
  assert.deepEqual(readProps(await fixture('Avatar'), 'Avatar'), [
    {
      name: 'userType',
      kind: 'enum',
      options: ['rêveur', 'cauchemar'],
      required: false,
      default: 'rêveur',
      doc: 'Variante Figma « user type »',
    },
    {
      name: 'label',
      kind: 'string',
      required: false,
      doc: "Nom lu par les lecteurs d'écran ; chaîne vide = avatar décoratif",
    },
  ]);
  const button = readProps(await fixture('Button'), 'Button');
  assert.deepEqual(
    button.map((p) => [p.name, p.kind, p.options ?? null, p.default ?? null]),
    [
      ['variant', 'enum', ['filled', 'outline', 'icon'], 'filled'],
      ['size', 'enum', ['small', 'default'], 'default'],
      ['error', 'boolean', null, false],
      ['children', 'string', null, null],
      ['disabled', 'boolean', null, false],
    ],
  );
  // Pas d'interface Props : aucune propriété inventée.
  assert.deepEqual(readProps('export default function Logo() { return null }', 'Logo'), []);
});

test('plan de page : ajouter, déplacer, dupliquer, supprimer ; une instance à la fois', () => {
  const avatar = { component: 'Avatar', file: 'src/components/atoms/Avatar/Avatar.tsx', props: {} };
  let { plan, id: a } = addInstance({ instances: [] }, 0, avatar);
  const second = addInstance(plan, 0, { ...avatar, props: { userType: 'cauchemar' } });
  plan = second.plan;
  assert.deepEqual(plan.instances.map((i) => i.id), [second.id, a]);
  plan = moveInstance(plan, second.id, 1);
  assert.deepEqual(plan.instances.map((i) => i.id), [a, second.id]);
  const copy = duplicateInstance(plan, a);
  plan = setProp(copy.plan, copy.id!, 'userType', 'cauchemar');
  // La copie change seule ; l'original garde ses valeurs.
  assert.deepEqual(plan.instances.map((i) => i.props.userType ?? null), [null, 'cauchemar', 'cauchemar']);
  plan = setProp(plan, copy.id!, 'userType', undefined);
  assert.equal(plan.instances[1].props.userType, undefined);
  plan = removeInstance(plan, a);
  assert.equal(plan.instances.length, 2);
  assert.doesNotThrow(() => planSchema.parse(plan));
  assert.throws(() =>
    planSchema.parse({ instances: [{ ...avatar, id: 'x', file: '../hors-projet.tsx' }] }),
  );
});

test('relais : même <head> que index.html, styles du point d’entrée, vrais composants', () => {
  const [html, canvas] = bridgeFiles(
    '<html><head><link rel="stylesheet" href="https://api.fontshare.com/x" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    "import './design-system/tokens.css'\nimport './index.css'\nimport App from './App.tsx'\n",
  );
  assert.equal(html.file, 'ds-studio.html');
  assert.match(html.content, /fontshare/);
  assert.match(html.content, /src="\/src\/ds-studio\/canvas.tsx"/);
  assert.doesNotMatch(html.content, /main.tsx/);
  assert.equal(canvas.file, 'src/ds-studio/canvas.tsx');
  assert.match(canvas.content, /import '..\/design-system\/tokens.css'\nimport '..\/index.css'/);
  assert.match(canvas.content, /import\.meta\.glob\('..\/components\/\*\*\/\*\.\{tsx,jsx\}'/);
});

test('chat sur la page : opérations validées contre les vrais composants', async () => {
  const { applyOps } = await import('../app/shared/pagePlan.js');
  const catalog = {
    Avatar: { file: 'src/components/atoms/Avatar/Avatar.tsx', specs: readProps(await fixture('Avatar'), 'Avatar') },
    Button: { file: 'src/components/atoms/Button/Button.tsx', specs: readProps(await fixture('Button'), 'Button') },
  };
  const start = { instances: [{ id: 'a1', component: 'Avatar', file: catalog.Avatar.file, props: {} }] };
  const { plan, notes } = applyOps(
    start,
    [
      { op: 'add', component: 'Button', props: { variant: 'outline', children: 'Valider', couleur: 'rouge' } },
      { op: 'add', component: 'Header' },
      { op: 'set', id: 'a1', props: { userType: 'cauchemar' } },
      { op: 'set', id: 'a1', props: { userType: 'zombie' } },
      { op: 'add', component: 'Avatar', before: 'a1' },
      { op: 'remove', id: 'inconnu' },
    ],
    catalog,
  );
  assert.deepEqual(
    plan.instances.map((i) => [i.component, i.props]),
    [
      ['Avatar', {}],
      ['Avatar', { userType: 'cauchemar' }],
      ['Button', { variant: 'outline', children: 'Valider' }],
    ],
  );
  // Rien d'inventé : chaque écart est expliqué.
  assert.deepEqual(notes, [
    'Button : « couleur = rouge » n’existe pas dans son code, ignoré.',
    'Header n’est pas codé dans le projet : à coder d’abord.',
    'Avatar : « userType = zombie » n’existe pas dans son code, ignoré.',
    'Instance inconnu introuvable, ignorée.',
  ]);
});
