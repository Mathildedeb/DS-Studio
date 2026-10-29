import { z } from 'zod';

// Plan d'une page de la Preview : la liste ordonnée des instances de
// composants du DS, chacune avec ses propres valeurs de propriétés. La Preview
// et le chat modifient ce même plan ; il ne touche jamais au code du projet
// (le Build, étape séparée, génère les vraies pages). Un composant du DS pas
// encore codé entre dans la page comme maquette Figma : il sera codé au Build.
const value = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
export const instanceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    // Nom du composant et fichier qui le code : l'instance reste liée au DS.
    component: z.string().regex(/^[\p{L}\d][\p{L}\d .,%+/&-]{0,79}$/u),
    file: z.string().max(300).regex(/^src\/[\w./-]+\.(tsx|jsx)$/).optional(),
    // Pas encore codé : son composant Figma, rendu en maquette jusqu'au Build.
    figma: z.string().max(200).regex(/^I?\d+[:-]\d+(;\d+[:-]\d+)*$/).optional(),
    // Propriétés de code, ou variantes Figma (« Size », « style »…) d'une maquette.
    props: z.record(z.string().regex(/^[\p{L}\w .#-]{1,60}$/u), value),
  })
  .strict();
export const planSchema = z
  .object({ instances: z.array(instanceSchema).max(200) })
  .strict();
export type Instance = z.infer<typeof instanceSchema>;
export type PagePlan = z.infer<typeof planSchema>;

const newId = () => Math.random().toString(36).slice(2, 10);

export const addInstance = (
  plan: PagePlan,
  at: number,
  instance: Omit<Instance, 'id'>,
): { plan: PagePlan; id: string } => {
  const id = newId();
  const instances = [...plan.instances];
  instances.splice(Math.max(0, Math.min(at, instances.length)), 0, { id, ...instance });
  return { plan: { instances }, id };
};
export const moveInstance = (plan: PagePlan, id: string, to: number): PagePlan => {
  const from = plan.instances.findIndex((i) => i.id === id);
  if (from < 0) return plan;
  const instances = [...plan.instances];
  const [moved] = instances.splice(from, 1);
  instances.splice(Math.max(0, Math.min(to, instances.length)), 0, moved);
  return { instances };
};
export const duplicateInstance = (
  plan: PagePlan,
  id: string,
): { plan: PagePlan; id?: string } => {
  const at = plan.instances.findIndex((i) => i.id === id);
  if (at < 0) return { plan };
  const copy = { ...plan.instances[at], id: newId(), props: { ...plan.instances[at].props } };
  const instances = [...plan.instances];
  instances.splice(at + 1, 0, copy);
  return { plan: { instances }, id: copy.id };
};
export const removeInstance = (plan: PagePlan, id: string): PagePlan => ({
  instances: plan.instances.filter((i) => i.id !== id),
});
// Une seule instance change : les autres instances du composant gardent leurs valeurs.
export const setProp = (
  plan: PagePlan,
  id: string,
  name: string,
  next: string | number | boolean | undefined,
): PagePlan => ({
  instances: plan.instances.map((i) => {
    if (i.id !== id) return i;
    const props = { ...i.props };
    if (next === undefined) delete props[name];
    else props[name] = next;
    return { ...i, props };
  }),
});

// Opérations du chat sur le plan : même modèle que les actions faites à la
// main dans la Preview. Chaque composant doit être dans le DS (codé, ou en
// maquette Figma) et chaque valeur respecter le type réel de sa propriété ;
// le reste est écarté avec une explication, jamais inventé.
type Specs = {
  name: string;
  kind: 'enum' | 'boolean' | 'string' | 'number';
  options?: string[];
}[];
export const opSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      component: z.string().max(80),
      props: z.record(z.string().max(60), value).optional(),
      // Position : avant l'instance indiquée, sinon à la fin.
      before: z.string().max(40).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set'),
      id: z.string().max(40),
      props: z.record(z.string().max(60), value.nullable()),
    })
    .strict(),
  z.object({ op: z.literal('move'), id: z.string().max(40), to: z.number().int().min(0) }).strict(),
  z.object({ op: z.literal('duplicate'), id: z.string().max(40) }).strict(),
  z.object({ op: z.literal('remove'), id: z.string().max(40) }).strict(),
]);
export type PageOp = z.infer<typeof opSchema>;

export function applyOps(
  plan: PagePlan,
  ops: PageOp[],
  catalog: Record<string, { file?: string; figma?: string; specs: Specs }>,
) {
  const notes: string[] = [];
  const checked = (component: string, props: Record<string, unknown>) => {
    const specs = catalog[component]?.specs ?? [];
    const out: Record<string, string | number | boolean | null> = {};
    for (const [name, v] of Object.entries(props)) {
      const spec = specs.find((s) => s.name === name);
      const ok =
        spec &&
        (v === null ||
          (spec.kind === 'enum' && spec.options?.includes(String(v))) ||
          (spec.kind === 'boolean' && typeof v === 'boolean') ||
          (spec.kind === 'string' && typeof v === 'string') ||
          (spec.kind === 'number' && typeof v === 'number'));
      if (ok) out[name] = v as string | number | boolean | null;
      else notes.push(`${component} : « ${name} = ${String(v)} » n’existe pas dans le DS, ignoré.`);
    }
    return out;
  };
  for (const op of ops) {
    const target = 'id' in op ? plan.instances.find((i) => i.id === op.id) : undefined;
    if ('id' in op && !target) {
      notes.push(`Instance ${op.id} introuvable, ignorée.`);
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
      const at = op.before
        ? Math.max(0, plan.instances.findIndex((i) => i.id === op.before))
        : plan.instances.length;
      plan = addInstance(plan, at, {
        component: op.component,
        ...(entry.file ? { file: entry.file } : {}),
        ...(entry.figma ? { figma: entry.figma } : {}),
        props,
      }).plan;
    } else if (op.op === 'set') {
      for (const [name, v] of Object.entries(checked(target!.component, op.props)))
        plan = setProp(plan, target!.id, name, v === null ? undefined : v);
    } else if (op.op === 'move') plan = moveInstance(plan, target!.id, op.to);
    else if (op.op === 'duplicate') plan = duplicateInstance(plan, target!.id).plan;
    else plan = removeInstance(plan, target!.id);
  }
  return { plan, notes };
}
