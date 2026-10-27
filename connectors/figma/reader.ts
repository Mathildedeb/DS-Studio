import { z } from 'zod';

// Lecture seule par l'API REST officielle, avec un jeton personnel de l'étudiant
// (portée file_content:read). Aucune écriture, aucun accès aux variables (Enterprise).
export interface FigmaFileStatus {
  connected: boolean;
  label: string;
  file?: { name: string; lastModified: string; pages: string[]; url: string };
}
const fileSchema = z.object({
  name: z.string().max(300),
  lastModified: z.string().max(40),
  document: z.object({
    children: z.array(z.object({ name: z.string().max(300) })).max(500),
  }),
});
export function figmaFileKey(url: string | undefined) {
  return url?.match(
    /^https:\/\/www\.figma\.com\/(?:design|file)\/([0-9a-zA-Z]{22,128})(?:[/?#]|$)/,
  )?.[1];
}
export class FigmaReader {
  private cache = new Map<string, { at: number; status: FigmaFileStatus }>();
  constructor(
    private token: string | undefined,
    private fetcher: typeof fetch = fetch,
    private ttl = 60_000,
  ) {}
  get hasToken() {
    return !!this.token;
  }
  async status(fileUrl: string | undefined): Promise<FigmaFileStatus> {
    if (!this.token)
      return {
        connected: false,
        label: 'Figma non connecté · jeton absent',
      };
    const key = figmaFileKey(fileUrl);
    if (!key)
      return {
        connected: false,
        label: 'Figma : ajoutez le lien du fichier dans Mon PFE',
      };
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttl) return cached.status;
    const status = await this.read(key);
    this.cache.set(key, { at: Date.now(), status });
    return status;
  }
  private async read(key: string): Promise<FigmaFileStatus> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.figma.com/v1/files/${key}?depth=1`,
        {
          headers: { 'X-Figma-Token': this.token! },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      return {
        connected: false,
        label: 'Figma injoignable · le mode local continue',
      };
    }
    // Le corps des erreurs n'est jamais renvoyé : seul un message rédigé ici l'est.
    if (response.status === 401 || response.status === 403)
      return { connected: false, label: 'Figma : jeton refusé ou expiré' };
    if (response.status === 404)
      return {
        connected: false,
        label: 'Figma : fichier introuvable ou non partagé',
      };
    if (response.status === 429)
      return {
        connected: false,
        label: 'Figma : trop de demandes, réessayez plus tard',
      };
    if (!response.ok)
      return {
        connected: false,
        label: 'Figma injoignable · le mode local continue',
      };
    const parsed = fileSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success)
      return { connected: false, label: 'Figma : réponse illisible' };
    return {
      connected: true,
      label: `Figma connecté · ${parsed.data.name}`,
      file: {
        name: parsed.data.name,
        lastModified: parsed.data.lastModified,
        pages: parsed.data.document.children.map((p) => p.name),
        url: `https://www.figma.com/design/${key}`,
      },
    };
  }
}
