import { z } from 'zod';

// Élément sélectionné dans la page Design System, transmis au chat pour que
// « ce composant » désigne bien ce que l'étudiante regarde. Données bornées,
// décrites par le registre et lues sur le rendu : aucune n'est exécutée.
export const focusSchema = z
  .object({
    page: z.enum(['design-system']),
    kind: z.enum(['component', 'token']),
    name: z.string().max(80),
    path: z.array(z.string().max(80)).max(10),
    level: z.string().max(20).optional(),
    source: z.string().max(200).optional(),
    selector: z.string().max(200).optional(),
    props: z
      .record(z.string().max(40), z.union([z.string().max(300), z.boolean()]))
      .optional(),
    tokens: z.array(z.string().max(40)).max(30).optional(),
    value: z.union([z.string().max(100), z.number()]).optional(),
  })
  .strict();
export type Focus = z.infer<typeof focusSchema>;

export const focusLabel = (f: Focus) =>
  f.kind === 'token' ? `token ${f.name}` : f.path.join(' › ');
