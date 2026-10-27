import { z } from 'zod';

// Projet ouvert dans DS-Studio, comme un dossier dans Claude Code : un
// dépôt Git local et un fichier Figma précis. Choisi au premier lancement.
export const connectionSchema = z
  .object({
    folder: z.string().min(1).max(1000).optional(),
    figmaUrl: z.string().url().max(500).optional(),
    // « Plus tard » : l'écran d'ouverture ne s'impose plus.
    skipped: z.boolean().optional(),
  })
  .strict();
export type Connection = z.infer<typeof connectionSchema>;

export interface FolderInfo {
  folder: string;
  name: string;
  git: { remote: string | null; branch: string | null } | null;
}
export interface ConnectionStatus {
  saved: Connection;
  project?: FolderInfo;
  folderError?: string;
}
