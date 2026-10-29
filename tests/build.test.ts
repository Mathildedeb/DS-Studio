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
import type { Instance } from '../app/shared/pagePlan.js';
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
  assert.deepEqual((plan.instances as Instance[]).map((i) => i.props.userType ?? null), [null, 'cauchemar', 'cauchemar']);
  plan = setProp(plan, copy.id!, 'userType', undefined);
  assert.equal((plan.instances[1] as Instance).props.userType, undefined);
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
    (plan.instances as Instance[]).map((i) => [i.component, i.props]),
    [
      ['Avatar', {}],
      ['Avatar', { userType: 'cauchemar' }],
      ['Button', { variant: 'outline', children: 'Valider' }],
    ],
  );
  // Rien d'inventé : chaque écart est expliqué.
  assert.deepEqual(notes, [
    'Button : « couleur = rouge » n’existe pas dans le DS, ignoré.',
    'Header n’est pas dans le Design System, ignoré.',
    'Avatar : « userType = zombie » n’existe pas dans le DS, ignoré.',
    'Calque inconnu introuvable, ignoré.',
  ]);
});

test('composant pas encore codé : ajouté en maquette Figma, avec ses variantes', async () => {
  const { applyOps } = await import('../app/shared/pagePlan.js');
  const catalog = {
    'card.donut': {
      figma: '12:34',
      specs: [{ name: 'Size', kind: 'enum' as const, options: ['small', 'large'] }],
    },
  };
  const { plan, notes } = applyOps(
    { instances: [] },
    [{ op: 'add', component: 'card.donut', props: { Size: 'large', couleur: 'rouge' } }],
    catalog,
  );
  assert.deepEqual(
    (plan.instances as Instance[]).map(({ component, file, figma, props }) => ({ component, file, figma, props })),
    [{ component: 'card.donut', file: undefined, figma: '12:34', props: { Size: 'large' } }],
  );
  assert.equal(notes.length, 1);
  assert.doesNotThrow(() => planSchema.parse(plan));
});

test('chat : crée une page et lie un bouton vers elle, dans la même réponse', async () => {
  const { applyOps } = await import('../app/shared/pagePlan.js');
  const start = { instances: [{ id: 'b1', component: 'button', figma: '1:2', props: {} }] };
  const { plan, pages, notes } = applyOps(
    start,
    [
      { op: 'page', name: 'Mon profil' },
      { op: 'link', id: 'b1', page: 'mon profil' },
      { op: 'link', id: 'b1', page: 'Inconnue' },
      { op: 'page', name: 'Découvrir' },
    ],
    { button: { figma: '1:2', specs: [] } },
    [{ id: 'cards', name: 'Découvrir' }],
  );
  assert.equal(pages.length, 1);
  assert.equal(pages[0].path, '/mon-profil');
  assert.equal(plan.instances[0].link, pages[0].id);
  assert.deepEqual(notes, [
    'Page « Inconnue » introuvable : lien ignoré.',
    'La page « Découvrir » existe déjà.',
  ]);
  assert.doesNotThrow(() => planSchema.parse(plan));
});

test('calques en arbre : grouper, Auto Layout, imbriquer, dégrouper, renommer', async () => {
  const { wrapNodes, unwrapNode, findNode, flatten, renameNode, setLayout, labelOf, applyOps } = await import(
    '../app/shared/pagePlan.js'
  );
  const btn = (id: string) => ({ id, component: 'Button', file: 'src/components/atoms/Button/Button.tsx', props: {} });
  let plan: import('../app/shared/pagePlan.js').PagePlan = { instances: [btn('a'), btn('b'), btn('c')] };
  // Une ancienne page (liste plate) reste valide telle quelle.
  assert.doesNotThrow(() => planSchema.parse(plan));
  const g = wrapNodes(plan, ['c', 'b'], 'autolayout', { direction: 'row', gap: 8 });
  plan = g.plan;
  assert.deepEqual(flatten(plan).map((f) => [f.node.id === g.id ? 'AL' : f.node.id, f.depth]), [
    ['a', 0],
    ['AL', 0],
    ['b', 1],
    ['c', 1],
  ]);
  // Déplacer « a » dans l'Auto Layout, puis l'Auto Layout dans lui-même : refusé.
  plan = moveInstance(plan, 'a', 0, g.id!);
  assert.equal(findNode(plan, 'a')!.parent!.id, g.id);
  assert.deepEqual(moveInstance(plan, g.id!, 0, 'a'), plan);
  plan = setLayout(renameNode(plan, g.id!, 'Actions'), g.id!, { gap: 24 });
  const al = findNode(plan, g.id!)!.node as import('../app/shared/pagePlan.js').AutoLayout;
  assert.equal(labelOf(al), 'Actions');
  assert.deepEqual([al.layout.direction, al.layout.gap], ['row', 24]);
  assert.doesNotThrow(() => planSchema.parse(plan));
  // Calques de niveaux différents : pas de groupe, une explication.
  assert.ok(wrapNodes(plan, ['a', g.id!], 'group').error);
  plan = unwrapNode(plan, g.id!);
  assert.deepEqual(plan.instances.map((n) => n.id), ['a', 'b', 'c']);
  // Le chat : mettre en Auto Layout et ajouter dedans.
  const chat = applyOps(
    plan,
    [{ op: 'wrap', ids: ['a', 'b'], kind: 'autolayout', name: 'Barre', layout: { direction: 'row' } }],
    { Button: { file: 'src/components/atoms/Button/Button.tsx', specs: [] } },
  );
  const bar = chat.plan.instances[0] as import('../app/shared/pagePlan.js').AutoLayout;
  assert.deepEqual([bar.type, bar.name, bar.layout.direction, bar.children.length], ['autolayout', 'Barre', 'row', 2]);
  const added = applyOps(chat.plan, [{ op: 'add', component: 'Button', parent: bar.id }], {
    Button: { file: 'src/components/atoms/Button/Button.tsx', specs: [] },
  });
  assert.equal((added.plan.instances[0] as typeof bar).children.length, 3);
});

test('propriétés : dimensions, styles et adaptation par appareil', async () => {
  const { wrapNodes, setLayout, clearAdapt, setSize, setStyle, layoutOn, deviceOf, findNode } = await import(
    '../app/shared/pagePlan.js'
  );
  const btn = (id: string) => ({ id, component: 'Button', file: 'src/components/atoms/Button/Button.tsx', props: {} });
  const g = wrapNodes({ instances: [btn('a'), btn('b')] }, ['a', 'b'], 'autolayout');
  let plan = setLayout(g.plan, g.id!, { direction: 'row' });
  // Sur mobile seulement : vertical, 8 d'écart ; la base ne bouge pas.
  plan = setLayout(plan, g.id!, { direction: 'column', gap: 8 }, 'mobile');
  type AL = import('../app/shared/pagePlan.js').AutoLayout;
  const al = () => findNode(plan, g.id!)!.node as AL;
  assert.equal(deviceOf(393), 'mobile');
  assert.equal(deviceOf(820), 'tablet');
  assert.equal(deviceOf(1440), 'desktop');
  assert.deepEqual([layoutOn(al().layout, al().adapt, 'mobile').direction, layoutOn(al().layout, al().adapt, 'mobile').gap], ['column', 8]);
  assert.equal(layoutOn(al().layout, al().adapt, 'desktop').direction, 'row');
  plan = clearAdapt(plan, g.id!, 'mobile');
  assert.equal(al().adapt, undefined);
  plan = setSize(plan, 'a', { width: 'fill' });
  plan = setStyle(plan, g.id!, { fill: '--color-neutral-900', radius: 12 });
  assert.deepEqual((findNode(plan, 'a')!.node as import('../app/shared/pagePlan.js').Instance).size, { width: 'fill' });
  assert.deepEqual(al().style, { fill: '--color-neutral-900', radius: 12 });
  plan = setStyle(plan, g.id!, { fill: undefined, radius: undefined });
  assert.equal(al().style, undefined);
  assert.doesNotThrow(() => planSchema.parse(plan));
  assert.throws(() => planSchema.parse({ instances: [{ ...al(), style: { fill: 'red;}' } }] }));
});

test('Build vérifié : composants, ordre, espacements, direction, liens', async () => {
  const { checkBuild, wrapNodes, setLayout, setLink } = await import('../app/shared/pagePlan.js');
  const c = (id: string, component: string) => ({ id, component, file: `src/components/atoms/${component}/${component}.tsx`, props: {} });
  const g = wrapNodes({ instances: [c('a', 'Avatar'), c('b', 'Button')] }, ['a', 'b'], 'autolayout');
  let plan = setLayout(g.plan, g.id!, { direction: 'row', gap: 12 });
  plan = setLink(plan, 'b', 'profil-1');
  const pages = [{ id: 'profil-1', name: 'Profil', path: '/profil' }];
  const good = `<div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}><Avatar /><Button onClick={() => go('/profil')} /></div>`;
  assert.ok(checkBuild(plan, good, pages).every((x) => x.ok));
  const bad = `<div style={{ gap: 8 }}><Button /></div>`;
  const out = checkBuild(plan, bad, pages).filter((x) => !x.ok).map((x) => x.text);
  assert.deepEqual(out, [
    'Composants absents du code : Avatar',
    'Auto Layout : écart de 12 px introuvable dans le code',
    'Auto Layout : disposition horizontale introuvable',
    'Button : lien vers /profil introuvable',
  ]);
});
