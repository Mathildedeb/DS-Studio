import { z } from 'zod';
import { StudioError } from '../../app/server/store.js';

// Lecture seule par l'API REST officielle, avec un jeton personnel de l'étudiant
// (portée file_content:read). Aucune écriture. Les variables ne sont lisibles
// qu'avec l'offre Enterprise : library.ts se replie alors sur les styles.
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
  private data = new Map<string, { at: number; value: unknown }>();
  // GET borné vers api.figma.com, en cache ; erreurs réécrites sans leur corps.
  // optional : 403/404 renvoient undefined (variables hors Enterprise).
  async api(route: string, optional = false): Promise<unknown> {
    if (!this.token)
      throw new StudioError('Figma non connecté · jeton absent.', 409);
    const hit = this.data.get(route);
    if (hit && Date.now() - hit.at < this.ttl) return hit.value;
    let response: Response;
    try {
      response = await this.fetcher(`https://api.figma.com${route}`, {
        headers: { 'X-Figma-Token': this.token },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new StudioError('Figma injoignable · réessayez plus tard.', 502);
    }
    if (optional && (response.status === 403 || response.status === 404))
      return undefined;
    if (response.status === 401 || response.status === 403)
      throw new StudioError('Figma : jeton refusé ou expiré.', 502);
    if (response.status === 404)
      throw new StudioError('Figma : fichier ou élément introuvable.', 404);
    if (response.status === 429)
      throw new StudioError(
        'Figma : trop de demandes, réessayez dans une minute.',
        429,
      );
    if (!response.ok) throw new StudioError('Figma : erreur du service.', 502);
    const text = await response.text();
    if (text.length > 40_000_000)
      throw new StudioError('Figma : réponse trop volumineuse.', 502);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new StudioError('Figma : réponse illisible.', 502);
    }
    if (this.data.size > 200) this.data.clear();
    this.data.set(route, { at: Date.now(), value });
    return value;
  }
  // Rendu PNG hébergé par Figma : seul un hôte Figma ou AWS est suivi.
  async download(link: string) {
    let host = '';
    try {
      const u = new URL(link);
      host = u.protocol === 'https:' ? u.hostname : '';
    } catch {
      /* Lien invalide : refusé ci-dessous. */
    }
    if (!/(^|\.)(amazonaws\.com|figma\.com)$/.test(host))
      throw new StudioError('Figma : rendu indisponible.', 502);
    let response: Response;
    try {
      response = await this.fetcher(link, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new StudioError('Figma : rendu injoignable.', 502);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      !response.ok ||
      bytes.length > 8_000_000 ||
      bytes.subarray(1, 4).toString() !== 'PNG'
    )
      throw new StudioError('Figma : rendu illisible.', 502);
    return bytes;
  }
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
