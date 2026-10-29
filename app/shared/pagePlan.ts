import { z } from 'zod';

// Plan d'une page de la Preview : l'arbre de ses calques. Un calque est un
// composant du DS (avec ses propres valeurs de propriétés), un Groupe (qui
// organise des calques) ou un Auto Layout (qui les dispose : direction,
// espacements, alignement, dimensions). La Preview et le chat modifient ce
// même plan ; il ne touche jamais au code du projet (le Build, étape séparée,
// génère les vraies pages). Un composant du DS pas encore codé entre dans la
// page comme maquette Figma : il sera codé au Build. Les pages d'avant l'arbre
// (une liste de composants) sont déjà des arbres valides : rien à convertir.
const value = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const name = z.string().trim().min(1).max(60);
// Interaction : au clic, ouvre cette page de la Preview (codée au Build).
const link = z.string().regex(/^[a-z0-9-]{1,40}$/);
// Dimensions d'un calque dans son Auto Layout : ajustée au contenu,
// extensible (remplit la place) ou fixe en px.
const sizeValue = z.union([z.enum(['hug', 'fill']), z.number().int().min(1).max(4000)]);
const sizing = z.object({ width: sizeValue.optional(), height: sizeValue.optional() }).strict();
// Styles d'un Groupe ou d'un Auto Layout : fond (une couleur de tes tokens,
// par sa variable CSS) et arrondi.
const styling = z
  .object({
    fill: z.string().regex(/^--[\w-]{1,80}$/).optional(),
    radius: z.number().int().min(0).max(400).optional(),
  })
  .strict();

export const instanceSchema = z
  .object({
    id,
    // Nom donné dans les calques ; sinon celui du composant.
    name: name.optional(),
    // Nom du composant et fichier qui le code : l'instance reste liée au DS.
    component: z.string().regex(/^[\p{L}\d][\p{L}\d .,%+/&-]{0,79}$/u),
    file: z.string().max(300).regex(/^src\/[\w./-]+\.(tsx|jsx)$/).optional(),
    // Pas encore codé : son composant Figma, rendu en maquette jusqu'au Build.
    figma: z.string().max(200).regex(/^I?\d+[:-]\d+(;\d+[:-]\d+)*$/).optional(),
    link: link.optional(),
    size: sizing.optional(),
    // Propriétés de code, ou variantes Figma (« Size », « style »…) d'une maquette.
    props: z.record(z.string().regex(/^[\p{L}\w .#-]{1,60}$/u), value),
  })
  .strict();

// Disposition d'un Auto Layout, comme dans Figma.
const size = sizeValue;
export const layoutSchema = z
  .object({
    direction: z.enum(['row', 'column']),
    gap: z.number().int().min(0).max(400),
    // Espacements intérieurs : haut, droite, bas, gauche.
    padding: z.tuple([0, 1, 2, 3].map(() => z.number().int().min(0).max(400)) as [z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber]),
    // Alignement sur l'axe secondaire, distribution sur l'axe principal.
    align: z.enum(['start', 'center', 'end', 'stretch']),
    justify: z.enum(['start', 'center', 'end', 'space-between']),
    wrap: z.boolean(),
    width: size,
    height: size,
  })
  .strict();
export type Layout = z.infer<typeof layoutSchema>;
export type Size = z.infer<typeof sizeValue>;
export type Sizing = z.infer<typeof sizing>;
export type Styling = z.infer<typeof styling>;
// Appareils de l'adaptation : un Auto Layout peut changer de disposition
// selon la largeur (moins de 600 px, moins de 1024 px, au-delà).
export const devices = ['mobile', 'tablet', 'desktop'] as const;
export type Device = (typeof devices)[number];
export const deviceOf = (width: number): Device => (width < 600 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop');
const adaptation = z
  .object({
    mobile: layoutSchema.partial().optional(),
    tablet: layoutSchema.partial().optional(),
    desktop: layoutSchema.partial().optional(),
  })
  .strict();
export type Adaptation = Partial<Record<Device, Partial<Layout>>>;
// Disposition réellement appliquée sur un appareil.
export const layoutOn = (l: Layout, adapt: Adaptation | undefined, device: Device): Layout => ({
  ...l,
  ...(adapt?.[device] ?? {}),
});
export const defaultLayout: Layout = {
  direction: 'column',
  gap: 16,
  padding: [0, 0, 0, 0],
  align: 'start',
  justify: 'start',
  wrap: false,
  width: 'fill',
  height: 'hug',
};

export type Instance = z.infer<typeof instanceSchema>;
export type Group = {
  id: string;
  type: 'group';
  name?: string;
  link?: string;
  size?: Sizing;
  style?: Styling;
  children: Node[];
};
export type AutoLayout = {
  id: string;
  type: 'autolayout';
  name?: string;
  link?: string;
  layout: Layout;
  adapt?: Adaptation;
  style?: Styling;
  children: Node[];
};
export type Container = Group | AutoLayout;
export type Node = Instance | Container;

const nodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.union([
    instanceSchema,
    z
      .object({
        id,
        type: z.literal('group'),
        name: name.optional(),
        link: link.optional(),
        size: sizing.optional(),
        style: styling.optional(),
        children: z.array(nodeSchema).max(200),
      })
      .strict(),
    z
      .object({
        id,
        type: z.literal('autolayout'),
        name: name.optional(),
        link: link.optional(),
        layout: layoutSchema,
        adapt: adaptation.optional(),
        style: styling.optional(),
        children: z.array(nodeSchema).max(200),
      })
      .strict(),
  ]),
) as z.ZodType<Node>;
export const planSchema = z
  .object({ instances: z.array(nodeSchema).max(200) })
  .strict()
  .refine((p) => count(p.instances) <= 400, '400 calques au maximum');
export type PagePlan = { instances: Node[] };

export const isContainer = (n: Node): n is Container => 'type' in n;
const count = (nodes: Node[]): number =>
  nodes.reduce((sum, n) => sum + 1 + (isContainer(n) ? count(n.children) : 0), 0);
export const labelOf = (n: Node) =>
  n.name ?? (isContainer(n) ? (n.type === 'group' ? 'Groupe' : 'Auto Layout') : n.component);

const newId = () => Math.random().toString(36).slice(2, 10);

// Où est un calque : son parent (null = la page), ses voisins et sa place.
export function findNode(
  plan: PagePlan,
  target: string,
): { node: Node; parent: Container | null; siblings: Node[]; index: number } | undefined {
  const visit = (nodes: Node[], parent: Container | null): ReturnType<typeof findNode> => {
    for (const [index, node] of nodes.entries()) {
      if (node.id === target) return { node, parent, siblings: nodes, index };
      if (isContainer(node)) {
        const found = visit(node.children, node);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(plan.instances, null);
}
// Calques à plat, dans l'ordre d'affichage, avec leur profondeur.
export const flatten = (plan: PagePlan) => {
  const out: { node: Node; depth: number; parent: string | null }[] = [];
  const visit = (nodes: Node[], depth: number, parent: string | null) => {
    for (const node of nodes) {
      out.push({ node, depth, parent });
      if (isContainer(node)) visit(node.children, depth + 1, node.id);
    }
  };
  visit(plan.instances, 0, null);
  return out;
};
const contains = (node: Node, target: string): boolean =>
  node.id === target || (isContainer(node) && node.children.some((c) => contains(c, target)));

// Change un calque ; null le retire de l'arbre.
const update = (nodes: Node[], target: string, fn: (n: Node) => Node | null): Node[] =>
  nodes.flatMap((n) => {
    if (n.id === target) {
      const next = fn(n);
      return next ? [next] : [];
    }
    return isContainer(n) ? [{ ...n, children: update(n.children, target, fn) }] : [n];
  });
// Place un calque dans un conteneur (null = la page), à l'index donné.
const insert = (nodes: Node[], parent: string | null, at: number, node: Node): Node[] => {
  const place = (list: Node[]) => {
    const copy = [...list];
    copy.splice(Math.max(0, Math.min(at, copy.length)), 0, node);
    return copy;
  };
  if (parent === null) return place(nodes);
  return update(nodes, parent, (n) => (isContainer(n) ? { ...n, children: place(n.children) } : n));
};

export const addInstance = (
  plan: PagePlan,
  at: number,
  instance: Omit<Instance, 'id'>,
  parent: string | null = null,
): { plan: PagePlan; id: string } => {
  const nid = newId();
  const target = parent && findNode(plan, parent)?.node;
  const into = target && isContainer(target) ? parent : null;
  return { plan: { instances: insert(plan.instances, into, at, { id: nid, ...instance }) }, id: nid };
};
// Déplace un calque à l'index donné, dans le même parent ou dans un autre
// conteneur (jamais dans lui-même ni dans un de ses enfants).
export const moveInstance = (
  plan: PagePlan,
  target: string,
  to: number,
  parent?: string | null,
): PagePlan => {
  const found = findNode(plan, target);
  if (!found) return plan;
  const into = parent === undefined ? (found.parent?.id ?? null) : parent;
  if (into !== null) {
    const dest = findNode(plan, into)?.node;
    if (!dest || !isContainer(dest) || contains(found.node, into)) return plan;
  }
  const without = update(plan.instances, target, () => null);
  return { instances: insert(without, into, to, found.node) };
};
const copyOf = (node: Node): Node =>
  isContainer(node)
    ? { ...node, id: newId(), children: node.children.map(copyOf) }
    : { ...node, id: newId(), props: { ...node.props } };
export const duplicateInstance = (plan: PagePlan, target: string): { plan: PagePlan; id?: string } => {
  const found = findNode(plan, target);
  if (!found) return { plan };
  const copy = copyOf(found.node);
  return {
    plan: { instances: insert(plan.instances, found.parent?.id ?? null, found.index + 1, copy) },
    id: copy.id,
  };
};
export const removeInstance = (plan: PagePlan, target: string): PagePlan => ({
  instances: update(plan.instances, target, () => null),
});
// Une seule instance change : les autres instances du composant gardent leurs valeurs.
export const setProp = (
  plan: PagePlan,
  target: string,
  prop: string,
  next: string | number | boolean | undefined,
): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    if (isContainer(n)) return n;
    const props = { ...n.props };
    if (next === undefined) delete props[prop];
    else props[prop] = next;
    return { ...n, props };
  }),
});
// Interaction d'un calque : la page ouverte au clic, ou aucune.
export const setLink = (plan: PagePlan, target: string, page: string | undefined): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    const { link: _, ...rest } = n;
    return (page ? { ...rest, link: page } : rest) as Node;
  }),
});
// Renommer un calque ; vide = son nom par défaut.
export const renameNode = (plan: PagePlan, target: string, next: string): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    const { name: _, ...rest } = n;
    const clean = next.trim().slice(0, 60);
    return (clean ? { ...rest, name: clean } : rest) as Node;
  }),
});
// Disposition d'un Auto Layout : la base, ou les réglages propres à un appareil.
export const setLayout = (
  plan: PagePlan,
  target: string,
  patch: Partial<Layout>,
  device?: Device,
): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    if (!isContainer(n) || n.type !== 'autolayout') return n;
    if (!device) return { ...n, layout: { ...n.layout, ...patch } };
    return { ...n, adapt: { ...n.adapt, [device]: { ...n.adapt?.[device], ...patch } } };
  }),
});
// Ne plus utiliser de réglages propres sur cet appareil.
export const clearAdapt = (plan: PagePlan, target: string, device: Device): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    if (!isContainer(n) || n.type !== 'autolayout' || !n.adapt) return n;
    const { [device]: _, ...rest } = n.adapt;
    const { adapt: __, ...node } = n;
    return Object.keys(rest).length ? { ...n, adapt: rest } : node;
  }),
});
// Dimensions d'un composant ou d'un Groupe dans son Auto Layout.
export const setSize = (plan: PagePlan, target: string, patch: Sizing): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    if (isContainer(n) && n.type === 'autolayout')
      return { ...n, layout: { ...n.layout, ...(patch as Partial<Layout>) } };
    return { ...n, size: { ...(n as Instance | Group).size, ...patch } } as Node;
  }),
});
export const setStyle = (plan: PagePlan, target: string, patch: Styling): PagePlan => ({
  instances: update(plan.instances, target, (n) => {
    if (!isContainer(n)) return n;
    const next = { ...n.style, ...patch };
    for (const k of Object.keys(next) as (keyof Styling)[]) if (next[k] === undefined) delete next[k];
    const { style: _, ...rest } = n;
    return (Object.keys(next).length ? { ...rest, style: next } : rest) as Node;
  }),
});
// Grouper (⌘G) ou mettre en Auto Layout (⇧A) des calques voisins : ils
// entrent dans le nouveau conteneur, à la place du premier.
export function wrapNodes(
  plan: PagePlan,
  ids: string[],
  kind: 'group' | 'autolayout',
  layout: Partial<Layout> = {},
): { plan: PagePlan; id?: string; error?: string } {
  const found = ids.map((x) => findNode(plan, x)).filter((f) => !!f);
  if (!found.length) return { plan, error: 'Aucun calque sélectionné.' };
  const parent = found[0].parent?.id ?? null;
  if (found.some((f) => (f.parent?.id ?? null) !== parent))
    return { plan, error: 'Sélectionne des calques du même niveau pour les grouper.' };
  const ordered = [...found].sort((a, b) => a.index - b.index);
  const cid = newId();
  const children = ordered.map((f) => f.node);
  const container: Container =
    kind === 'group'
      ? { id: cid, type: 'group', children }
      : { id: cid, type: 'autolayout', layout: { ...defaultLayout, ...layout }, children };
  let instances = plan.instances;
  for (const f of ordered) instances = update(instances, f.node.id, () => null);
  return { plan: { instances: insert(instances, parent, ordered[0].index, container) }, id: cid };
}
// Dégrouper : les enfants prennent la place du conteneur.
export const unwrapNode = (plan: PagePlan, target: string): PagePlan => {
  const found = findNode(plan, target);
  if (!found || !isContainer(found.node)) return plan;
  let instances = update(plan.instances, target, () => null);
  found.node.children.forEach((child, i) => {
    instances = insert(instances, found.parent?.id ?? null, found.index + i, child);
  });
  return { instances };
};

// Opérations du chat sur le plan : même modèle que les actions faites à la
// main dans la Preview. Chaque composant doit être dans le DS (codé, ou en
// maquette Figma) et chaque valeur respecter le type réel de sa propriété ;
// le reste est écarté avec une explication, jamais inventé.
type Specs = {
  name: string;
  kind: 'enum' | 'boolean' | 'string' | 'number';
  options?: string[];
}[];
const ref = z.string().max(40);
export const opSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      component: z.string().max(80),
      props: z.record(z.string().max(60), value).optional(),
      // Position : avant le calque indiqué, sinon à la fin (de parent, s'il est donné).
      before: ref.optional(),
      parent: ref.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set'),
      id: ref,
      props: z.record(z.string().max(60), value.nullable()),
    })
    .strict(),
  z
    .object({ op: z.literal('move'), id: ref, to: z.number().int().min(0), parent: ref.nullable().optional() })
    .strict(),
  z.object({ op: z.literal('duplicate'), id: ref }).strict(),
  // Au clic sur le calque, aller à une page (nom ou id) ; null retire le lien.
  z.object({ op: z.literal('link'), id: ref, page: z.string().max(40).nullable() }).strict(),
  // Nouvelle page de la Preview, vide, à construire ensuite.
  z.object({ op: z.literal('page'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ op: z.literal('remove'), id: ref }).strict(),
  z.object({ op: z.literal('rename'), id: ref, name: z.string().max(60) }).strict(),
  // Grouper ou mettre en Auto Layout des calques voisins ; dégrouper.
  z
    .object({
      op: z.literal('wrap'),
      ids: z.array(ref).min(1).max(50),
      kind: z.enum(['group', 'autolayout']),
      name: z.string().max(60).optional(),
      layout: layoutSchema.partial().optional(),
    })
    .strict(),
  z.object({ op: z.literal('unwrap'), id: ref }).strict(),
  // Disposition d'un Auto Layout ; device : réglage propre à mobile, tablette ou desktop.
  z
    .object({ op: z.literal('layout'), id: ref, layout: layoutSchema.partial(), device: z.enum(devices).optional() })
    .strict(),
  z.object({ op: z.literal('size'), id: ref, size: sizing }).strict(),
  z.object({ op: z.literal('style'), id: ref, style: styling }).strict(),
]);
export type PageOp = z.infer<typeof opSchema>;

// Identifiant et route d'une nouvelle page : « Mon profil » → mon-profil-x1y2, /mon-profil.
const slugOf = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'page';
export const newPage = (text: string) => ({
  id: `${slugOf(text)}-${Math.random().toString(36).slice(2, 6)}`,
  name: text.trim().slice(0, 40),
  path: `/${slugOf(text)}`,
});
type Page = { id: string; name: string; path?: string };

export function applyOps(
  plan: PagePlan,
  ops: PageOp[],
  catalog: Record<string, { file?: string; figma?: string; specs: Specs }>,
  pages: Page[] = [],
) {
  const notes: string[] = [];
  const created: Page[] = [];
  const findPage = (key: string) => {
    const all = [...pages, ...created];
    const k = key.trim().toLowerCase();
    return all.find((p) => p.id === key) ?? all.find((p) => p.name.toLowerCase() === k);
  };
  const checked = (component: string, props: Record<string, unknown>) => {
    const specs = catalog[component]?.specs ?? [];
    const out: Record<string, string | number | boolean | null> = {};
    for (const [prop, v] of Object.entries(props)) {
      const spec = specs.find((s) => s.name === prop);
      const ok =
        spec &&
        (v === null ||
          (spec.kind === 'enum' && spec.options?.includes(String(v))) ||
          (spec.kind === 'boolean' && typeof v === 'boolean') ||
          (spec.kind === 'string' && typeof v === 'string') ||
          (spec.kind === 'number' && typeof v === 'number'));
      if (ok) out[prop] = v as string | number | boolean | null;
      else notes.push(`${component} : « ${prop} = ${String(v)} » n’existe pas dans le DS, ignoré.`);
    }
    return out;
  };
  for (const op of ops) {
    if (op.op === 'page') {
      const existing = findPage(op.name);
      if (existing) notes.push(`La page « ${existing.name} » existe déjà.`);
      else if (pages.length + created.length >= 40) notes.push('40 pages au maximum.');
      else created.push(newPage(op.name));
      continue;
    }
    if (op.op === 'wrap') {
      const done = wrapNodes(plan, op.ids, op.kind, op.layout ?? {});
      if (done.error) notes.push(done.error);
      else plan = op.name ? renameNode(done.plan, done.id!, op.name) : done.plan;
      continue;
    }
    const target = 'id' in op ? findNode(plan, op.id)?.node : undefined;
    if ('id' in op && !target) {
      notes.push(`Calque ${op.id} introuvable, ignoré.`);
      continue;
    }
    if (op.op === 'add') {
      const entry = catalog[op.component];
      if (!entry) {
        notes.push(`${op.component} n’est pas dans le Design System, ignoré.`);
        continue;
      }
      const props = Object.fromEntries(
        Object.entries(checked(op.component, op.props ?? {})).filter(([, v]) => v !== null),
      ) as Record<string, string | number | boolean>;
      const before = op.before ? findNode(plan, op.before) : undefined;
      const parentNode = op.parent ? findNode(plan, op.parent)?.node : undefined;
      const parent = before
        ? (before.parent?.id ?? null)
        : parentNode && isContainer(parentNode)
          ? parentNode.id
          : null;
      const at = before
        ? before.index
        : parentNode && isContainer(parentNode)
          ? parentNode.children.length
          : plan.instances.length;
      plan = addInstance(
        plan,
        at,
        {
          component: op.component,
          ...(entry.file ? { file: entry.file } : {}),
          ...(entry.figma ? { figma: entry.figma } : {}),
          props,
        },
        parent,
      ).plan;
    } else if (op.op === 'set') {
      if (isContainer(target!)) {
        notes.push(`${labelOf(target!)} n’a pas de propriétés de composant.`);
        continue;
      }
      for (const [prop, v] of Object.entries(checked(target!.component, op.props)))
        plan = setProp(plan, target!.id, prop, v === null ? undefined : v);
    } else if (op.op === 'move') plan = moveInstance(plan, target!.id, op.to, op.parent);
    else if (op.op === 'duplicate') plan = duplicateInstance(plan, target!.id).plan;
    else if (op.op === 'rename') plan = renameNode(plan, target!.id, op.name);
    else if (op.op === 'unwrap') plan = unwrapNode(plan, target!.id);
    else if (op.op === 'layout') {
      if (!isContainer(target!) || target!.type !== 'autolayout')
        notes.push(`${labelOf(target!)} n’est pas un Auto Layout.`);
      else plan = setLayout(plan, target!.id, op.layout, op.device);
    } else if (op.op === 'size') plan = setSize(plan, target!.id, op.size);
    else if (op.op === 'style') {
      if (!isContainer(target!)) notes.push(`${labelOf(target!)} : fond et arrondi se règlent sur un Groupe ou un Auto Layout.`);
      else plan = setStyle(plan, target!.id, op.style);
    } else if (op.op === 'link') {
      const to = op.page === null ? undefined : findPage(op.page);
      if (op.page !== null && !to) {
        notes.push(`Page « ${op.page} » introuvable : lien ignoré.`);
        continue;
      }
      plan = setLink(plan, target!.id, to?.id);
    } else plan = removeInstance(plan, target!.id);
  }
  return { plan, notes, pages: created };
}

// Vérification du Build : le code produit suit-il l'arbre des calques ?
// Lecture du code, pas du rendu : chaque composant codé est utilisé (dans
// l'ordre des calques), chaque Auto Layout garde sa direction et son
// espacement, chaque lien mène à la bonne route. Un écart est signalé,
// jamais corrigé en silence.
export function checkBuild(plan: PagePlan, code: string, pages: Page[] = []) {
  const checks: { ok: boolean; text: string }[] = [];
  const all = flatten(plan).map((f) => f.node);
  const comps = all.filter((n): n is Instance => !isContainer(n));
  const tag = (name: string) => new RegExp(`<${name}\\b`);
  const missing = comps.filter((c) => /^[A-Z]\w*$/.test(c.component) && !tag(c.component).test(code));
  const uncoded = comps.filter((c) => !c.file);
  checks.push(
    missing.length
      ? { ok: false, text: `Composants absents du code : ${[...new Set(missing.map((c) => c.component))].join(', ')}` }
      : { ok: true, text: `${comps.length} composant(s) utilisés dans le code` },
  );
  if (uncoded.length)
    checks.push({ ok: false, text: `Encore en maquette (pas codés) : ${[...new Set(uncoded.map((c) => c.component))].join(', ')}` });
  // Ordre : la première apparition de chaque composant suit l'ordre des calques.
  const order = [...new Set(comps.map((c) => c.component))]
    .filter((n) => /^[A-Z]\w*$/.test(n))
    .map((n) => ({ n, at: code.search(tag(n)) }))
    .filter((x) => x.at >= 0);
  const sorted = order.every((x, i) => i === 0 || order[i - 1].at <= x.at);
  if (order.length > 1)
    checks.push(sorted ? { ok: true, text: 'Composants dans l’ordre des calques' } : { ok: false, text: 'L’ordre des composants dans le code diffère des calques' });
  for (const n of all) {
    if (!isContainer(n) || n.type !== 'autolayout') continue;
    const l = n.layout;
    const gap = new RegExp(`gap\\s*[:=]\\s*['"{]?\\s*${l.gap}(px|\\b)`);
    const row = /flex-direction\s*:\s*row|flexDirection\s*:\s*['"]row/;
    const label = labelOf(n);
    checks.push(
      gap.test(code) ? { ok: true, text: `${label} : écart de ${l.gap} px` } : { ok: false, text: `${label} : écart de ${l.gap} px introuvable dans le code` },
    );
    if (l.direction === 'row')
      checks.push(row.test(code) ? { ok: true, text: `${label} : horizontal` } : { ok: false, text: `${label} : disposition horizontale introuvable` });
  }
  for (const n of all) {
    if (!n.link) continue;
    const route = pages.find((p) => p.id === n.link)?.path;
    if (!route) continue;
    checks.push(
      code.includes(`'${route}'`) || code.includes(`"${route}"`) || code.includes(`\`${route}`)
        ? { ok: true, text: `${labelOf(n)} ouvre ${route}` }
        : { ok: false, text: `${labelOf(n)} : lien vers ${route} introuvable` },
    );
  }
  return checks;
}
