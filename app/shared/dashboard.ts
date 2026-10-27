import { z } from 'zod';

// Instantané versionné de la roadmap Notion : aucune connexion Notion à l'exécution.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');
const link = z
  .string()
  .url()
  .max(500)
  .refine((v) => new URL(v).protocol === 'https:', 'Lien https attendu.');
export const roadmapSchema = z
  .object({
    project: z
      .object({
        name: z.string().max(100),
        tagline: z.string().max(200),
        deliveryDate: day,
        defenseDate: day,
      })
      .strict(),
    source: z
      .object({ label: z.string().max(100), url: link, syncedAt: day })
      .strict(),
    links: z
      .array(z.object({ label: z.string().max(100), url: link }).strict())
      .max(12),
    phases: z.array(z.string().max(100)).min(1).max(20),
    // Phases affichées dans le tableau de bord : la production DS et écrans.
    focusPhases: z.array(z.string().max(100)).min(1).max(20),
    // Checklist de départ, recopiée dans l'état privé à la première modification.
    checklist: z
      .array(
        z
          .object({
            group: z.string().max(100),
            items: z.array(z.string().max(200)).max(30),
          })
          .strict(),
      )
      .max(10),
    steps: z
      .array(
        z
          .object({
            title: z.string().max(200),
            phase: z.string().max(100),
            type: z.enum(['Tâche', 'Jalon']),
            status: z.enum(['À venir', 'En cours', 'Terminé']),
            start: day,
            end: z.union([z.literal(''), day]),
            deliverable: z.string().max(300),
            skills: z.array(z.string().max(20)).max(10),
            url: link,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type Roadmap = z.infer<typeof roadmapSchema>;
export type RoadmapStep = Roadmap['steps'][number];

export const checklistSchema = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        group: z.string().trim().min(1).max(100),
        label: z.string().trim().min(1).max(200),
        done: z.boolean(),
      })
      .strict(),
  )
  .max(150);
export type Checklist = z.infer<typeof checklistSchema>;

export const widgetIds = [
  'brief',
  'checklist',
  'countdown',
  'roadmap',
  'designSystem',
] as const;
export type WidgetId = (typeof widgetIds)[number];
export const widgetSizes = ['s', 'm', 'l'] as const;
export type WidgetSize = (typeof widgetSizes)[number];
export const layoutSchema = z
  .object({
    widgets: z
      .array(
        z.object({ id: z.enum(widgetIds), size: z.enum(widgetSizes) }).strict(),
      )
      .max(widgetIds.length)
      .refine(
        (w) => new Set(w.map((x) => x.id)).size === w.length,
        'Widget en double.',
      ),
  })
  .strict();
export type Layout = z.infer<typeof layoutSchema>;
export const defaultLayout: Layout = {
  widgets: [
    { id: 'checklist', size: 'm' },
    { id: 'countdown', size: 's' },
    { id: 'brief', size: 'm' },
    { id: 'designSystem', size: 's' },
    { id: 'roadmap', size: 'l' },
  ],
};
