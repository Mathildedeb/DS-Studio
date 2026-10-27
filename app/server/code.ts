import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite, readPrivate } from './files.js';
import { StudioError } from './store.js';

// Fichiers que Clodo peut proposer de modifier : l'interface et le contexte du PFE.
// Jamais le serveur, les connecteurs, les tests, les scripts, package.json ni .env.
const editable = [
  /^app\/client\/[A-Za-z0-9_-]+\.(tsx|ts|css)$/,
  /^workspace\/(PFE|DESIGN_RULES|DECISIONS)\.md$/,
  /^workspace\/roadmap\.json$/,
];
const maxFile = 120_000;
const ttl = 30 * 60_000;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export const codeEditSchema = z
  .object({
    file: z.string().max(200),
    search: z.string().min(1).max(20_000),
    replace: z.string().max(40_000),
  })
  .strict();
export type CodeEdit = z.infer<typeof codeEditSchema>;
export interface CodeHunk {
  file: string;
  line: number;
  removed: string[];
  added: string[];
}
export interface CodeProposal {
  id: string;
  files: string[];
  hunks: CodeHunk[];
}
interface Pending {
  created: number;
  before: Map<string, string>;
  after: Map<string, string>;
  proposal: CodeProposal;
}
interface Applied {
  id: string;
  date: string;
  files: Record<string, { before: string; after: string }>;
}

export class CodeStore {
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private historyDir: string;
  constructor(
    private root: string,
    directory: string,
  ) {
    this.historyDir = path.join(directory, 'code-history');
  }
  isEditable(file: string) {
    return editable.some((r) => r.test(file));
  }
  // Chemin relatif contrôlé, fichier ordinaire (pas de lien), taille bornée.
  private async read(file: string) {
    if (!this.isEditable(file) || path.posix.normalize(file) !== file)
      throw new StudioError(`Fichier non modifiable par Clodo : ${file}`);
    const full = path.join(this.root, ...file.split('/'));
    if (!full.startsWith(this.root + path.sep))
      throw new StudioError(`Chemin refusé : ${file}`);
    try {
      return await readPrivate(full, maxFile);
    } catch {
      throw new StudioError(`Fichier absent ou non sûr : ${file}`);
    }
  }
  // Liste montrée à Clodo pour qu'il choisisse ce qu'il doit lire.
  async catalogue() {
    const files: { file: string; size: number }[] = [];
    for (const dir of ['app/client', 'workspace']) {
      for (const name of await fs.readdir(path.join(this.root, dir))) {
        const file = `${dir}/${name}`;
        if (!this.isEditable(file)) continue;
        const stat = await fs.lstat(path.join(this.root, dir, name));
        if (stat.isFile() && stat.size <= maxFile)
          files.push({ file, size: stat.size });
      }
    }
    return files.sort((a, b) => a.file.localeCompare(b.file));
  }
  async contents(files: string[]) {
    const out: Record<string, string> = {};
    for (const file of files.slice(0, 5)) out[file] = await this.read(file);
    return out;
  }
  // Chaque remplacement doit viser un passage présent une seule fois : pas de
  // remplacement approximatif, pas de réécriture de fichier entier.
  async propose(edits: CodeEdit[]): Promise<CodeProposal> {
    if (!edits.length) throw new StudioError('Aucune modification proposée.');
    if (edits.length > 20)
      throw new StudioError('Trop de modifications en une fois (20 maximum).');
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    const hunks: CodeHunk[] = [];
    for (const edit of edits.map((e) => codeEditSchema.parse(e))) {
      if (!before.has(edit.file)) {
        const text = await this.read(edit.file);
        before.set(edit.file, text);
        after.set(edit.file, text);
      }
      const current = after.get(edit.file)!;
      const at = current.indexOf(edit.search);
      if (at < 0)
        throw new StudioError(
          `Passage introuvable dans ${edit.file}. Aucune modification préparée.`,
        );
      if (current.indexOf(edit.search, at + 1) >= 0)
        throw new StudioError(
          `Passage ambigu (présent plusieurs fois) dans ${edit.file}.`,
        );
      after.set(
        edit.file,
        current.slice(0, at) +
          edit.replace +
          current.slice(at + edit.search.length),
      );
      hunks.push({
        file: edit.file,
        line: current.slice(0, at).split('\n').length,
        removed: edit.search.split('\n'),
        added: edit.replace === '' ? [] : edit.replace.split('\n'),
      });
    }
    for (const [file, text] of after)
      if (text.length > maxFile)
        throw new StudioError(
          `Fichier trop volumineux après modification : ${file}`,
        );
    const now = Date.now();
    for (const [id, p] of this.pending)
      if (now - p.created > ttl) this.pending.delete(id);
    const proposal = { id: randomUUID(), files: [...before.keys()], hunks };
    this.pending.set(proposal.id, { created: now, before, after, proposal });
    return proposal;
  }
  // Validation humaine : usage unique, et refus si un fichier a changé depuis.
  apply(id: string) {
    const work = this.queue.then(async () => {
      const p = this.pending.get(id);
      if (!p || Date.now() - p.created > ttl)
        throw new StudioError('Proposition expirée ou déjà traitée.', 409);
      this.pending.delete(id);
      for (const [file, text] of p.before)
        if (sha(await this.read(file)) !== sha(text))
          throw new StudioError(
            `${file} a changé depuis la proposition. Redemandez à Clodo.`,
            409,
          );
      const record: Applied = {
        id,
        date: new Date().toISOString(),
        files: Object.fromEntries(
          [...p.before].map(([f, before]) => [
            f,
            { before, after: p.after.get(f)! },
          ]),
        ),
      };
      await fs.mkdir(this.historyDir, { recursive: true, mode: 0o700 });
      await atomicWrite(
        path.join(this.historyDir, `${id}.json`),
        JSON.stringify(record) + '\n',
      );
      for (const [file, text] of p.after)
        await atomicWrite(path.join(this.root, ...file.split('/')), text);
      return { id, files: p.proposal.files };
    });
    this.queue = work.catch(() => {});
    return work;
  }
  // Dernière modification appliquée et non annulée : survit au rechargement de la page.
  async last(): Promise<{ id: string; files: string[] } | null> {
    let names: string[];
    try {
      names = await fs.readdir(this.historyDir);
    } catch {
      return null;
    }
    let best: { at: number; name: string } | undefined;
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const at = (await fs.lstat(path.join(this.historyDir, name))).mtimeMs;
      if (!best || at > best.at) best = { at, name };
    }
    if (!best) return null;
    const record: Applied = JSON.parse(
      await readPrivate(path.join(this.historyDir, best.name), 2_000_000),
    );
    return { id: record.id, files: Object.keys(record.files) };
  }
  // Annulation : seulement si personne n'a retouché les fichiers depuis.
  revert(id: string) {
    const work = this.queue.then(async () => {
      if (!/^[0-9a-f-]{36}$/.test(id))
        throw new StudioError('Identifiant invalide.');
      const file = path.join(this.historyDir, `${id}.json`);
      let record: Applied;
      try {
        record = JSON.parse(await readPrivate(file, 2_000_000));
      } catch {
        throw new StudioError('Modification introuvable.', 404);
      }
      for (const [f, v] of Object.entries(record.files))
        if (sha(await this.read(f)) !== sha(v.after))
          throw new StudioError(
            `${f} a été modifié depuis. Annulation refusée pour ne rien perdre.`,
            409,
          );
      for (const [f, v] of Object.entries(record.files))
        await atomicWrite(path.join(this.root, ...f.split('/')), v.before);
      await fs.rename(file, file.replace(/\.json$/, '.reverted.json'));
      return { id, files: Object.keys(record.files) };
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
