import { z } from 'zod';
export const projectSchema = z
  .object({
    name: z.string().trim().max(100).default(''),
    audience: z.string().trim().max(1000).default(''),
    goal: z.string().trim().max(2000).default(''),
    figmaUrl: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .max(500)
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === 'https:' &&
              url.hostname === 'www.figma.com' &&
              !url.username &&
              !url.password
            );
          }, 'Lien https://www.figma.com/ attendu, sans identifiants.'),
      ])
      .default(''),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export interface ProjectSnapshot {
  project: Project;
  base: string;
}
