import { z } from 'zod';

// Plan d'une page de la Preview : la liste ordonnée des instances de
// composants du DS, chacune avec ses propres valeurs de propriétés. La Preview
// et le chat modifient ce même plan ; il ne touche jamais au code du projet
// (le Build, étape séparée, génère les vraies pages).
const value = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
export const instanceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    // Nom du composant et fichier qui le code : l'instance reste liée au DS.
    component: z.string().regex(/^[A-Za-z]\w{0,79}$/),
    file: z.string().max(300).regex(/^src\/[\w./-]+\.(tsx|jsx)$/),
    props: z.record(z.string().regex(/^\w{1,60}$/), value),
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
