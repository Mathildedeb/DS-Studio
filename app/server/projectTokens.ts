import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, readPrivate } from './files.js';
import { StudioError } from './store.js';
import { tokensSchema, type Tokens } from '../shared/model.js';

// Tokens du projet ouvert : design-system/tokens.json au format W3C DTCG
// (groupes imbriqués, $type, $value). DS-Studio reprend ce que son format
// sait porter ; le reste (typographies composées, ombres…) est listé.
export const projectTokensFile = 'design-system/tokens.json';
const segment = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());

export function convertDtcg(json: unknown) {
  const tokens: Record<string, unknown> = {};
  // Un alias {groupe.nom} prend la valeur du token visé (4 sauts au plus) :
  // DS-Studio ne garde pas les alias, seulement leur valeur.
  const resolve = (value: unknown, hops = 0): unknown => {
    const ref = typeof value === 'string' && value.match(/^\{([^}]+)\}$/)?.[1];
    if (!ref || hops > 4) return value;
    let target: unknown = json;
    for (const part of ref.split('.'))
      target = (target as Record<string, unknown> | undefined)?.[part];
    const next = (target as { $value?: unknown } | undefined)?.$value;
    return next === undefined ? value : resolve(next, hops + 1);
  };
  const skipped: { name: string; reason: string }[] = [];
  const walk = (node: unknown, trail: string[], inherited?: string) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const type = typeof o.$type === 'string' ? o.$type : inherited;
    if ('$value' in o) {
      const name = trail.join('.');
      const key = trail.map(segment).join('.');
      const value = resolve(o.$value);
      if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,3}$/.test(key))
        return void skipped.push({ name, reason: 'nom trop profond' });
      if (typeof value === 'string' && value.startsWith('{'))
        return void skipped.push({ name, reason: 'alias introuvable' });
      if (type === 'color' && typeof value === 'string') {
        if (/^#[0-9a-fA-F]{6}$/.test(value))
          tokens[key] = { $type: 'color', $value: value.toUpperCase() };
        else skipped.push({ name, reason: 'couleur avec transparence' });
      } else if (type === 'dimension') {
        const n = Number(String(value).replace(/px$/, ''));
        if (Number.isFinite(n) && n >= 0 && n <= 2000)
          tokens[key] = { $type: 'dimension', $value: n };
        else skipped.push({ name, reason: 'dimension hors 0–2000 px' });
      } else if (
        type === 'fontFamily' &&
        typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/.test(value)
      )
        tokens[key] = { $type: 'fontFamily', $value: value };
      else skipped.push({ name, reason: `type ${type ?? 'inconnu'}` });
      return;
    }
    for (const [k, v] of Object.entries(o))
      if (!k.startsWith('$')) walk(v, [...trail, k], type);
  };
  walk(json, []);
  // Au-delà de 300 tokens, le format refuse : on garde les premiers.
  const kept = Object.fromEntries(Object.entries(tokens).slice(0, 300));
  return { tokens: tokensSchema.parse(kept) as Tokens, skipped };
}

// design-system/tokens.json d'abord ; sinon le premier *tokens*.json du
// projet (3 niveaux, sans dépendances ni dossiers cachés) qui contient des $value.
async function findTokensFile(folder: string) {
  const preferred = path.join(folder, ...projectTokensFile.split('/'));
  if (await fs.stat(preferred).catch(() => undefined)) return projectTokensFile;
  const skip = new Set([
    'node_modules',
    'dist',
    'build',
    'out',
    'coverage',
    // Jeux d'essai : jamais pris pour les tokens du projet.
    'test',
    'tests',
    '__tests__',
    'fixtures',
  ]);
  const queue: string[] = [''];
  while (queue.length) {
    const dir = queue.shift()!;
    const entries = await fs
      .readdir(path.join(folder, dir), { withFileTypes: true })
      .catch(() => []);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (
          !e.name.startsWith('.') &&
          !skip.has(e.name) &&
          rel.split('/').length < 3
        )
          queue.push(rel);
      } else if (e.isFile() && /tokens?\.json$/i.test(e.name)) {
        const raw = await readPrivate(path.join(folder, rel), 2_000_000).catch(
          () => '',
        );
        if (raw.includes('"$value"')) return rel;
      }
    }
  }
  return undefined;
}

export async function readProjectTokens(folder: string) {
  const file = await findTokensFile(folder);
  if (!file)
    throw new StudioError(
      'Aucun fichier de tokens (format DTCG, *tokens.json) dans le projet ouvert.',
      404,
    );
  let raw: string;
  try {
    raw = await readPrivate(path.join(folder, ...file.split('/')), 2_000_000);
  } catch {
    throw new StudioError(`${file} illisible.`, 422);
  }
  try {
    return { file, ...convertDtcg(JSON.parse(raw)) };
  } catch {
    throw new StudioError(`${file} illisible.`, 422);
  }
}

// Écrit les tokens validés dans le fichier DTCG du projet, sans changer sa
// structure : valeur modifiée en place (alias gardé s'il donne déjà la même
// valeur), token nouveau ajouté sous son chemin, token supprimé retiré.
export async function writeProjectTokens(folder: string, tokens: Tokens) {
  const file = (await findTokensFile(folder)) ?? projectTokensFile;
  const full = path.join(folder, ...file.split('/'));
  const json: Record<string, unknown> = JSON.parse(
    await readPrivate(full, 2_000_000).catch(() => '{}'),
  );
  const known = convertDtcg(json).tokens;
  // Fichier présent mais aucun token lisible : ce n'est pas un DTCG, on n'y
  // écrit rien plutôt que de le déformer.
  if (Object.keys(json).length && !Object.keys(known).length) return undefined;
  const seen = new Set<string>();
  const walk = (node: Record<string, unknown>, trail: string[]) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !v || typeof v !== 'object') continue;
      const leaf = v as Record<string, unknown>;
      if (!('$value' in leaf)) {
        walk(leaf, [...trail, k]);
        continue;
      }
      const key = [...trail, k].map(segment).join('.');
      if (!(key in known)) continue;
      seen.add(key);
      const next = tokens[key];
      if (!next) delete node[k];
      else if (next.$value !== known[key].$value)
        leaf.$value =
          next.$type === 'dimension' && String(leaf.$value).endsWith('px')
            ? `${next.$value}px`
            : next.$value;
    }
  };
  walk(json, []);
  // Un alias qui ne donne plus la valeur affichée dans DS-Studio (sa cible a
  // changé) est écrit en clair : le projet et DS-Studio montrent la même chose.
  const after = convertDtcg(json).tokens;
  const fix = (node: Record<string, unknown>, trail: string[]) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !v || typeof v !== 'object') continue;
      const leaf = v as Record<string, unknown>;
      if (!('$value' in leaf)) {
        fix(leaf, [...trail, k]);
        continue;
      }
      const key = [...trail, k].map(segment).join('.');
      const want = tokens[key];
      if (
        want &&
        typeof leaf.$value === 'string' &&
        leaf.$value.startsWith('{') &&
        after[key]?.$value !== want.$value
      )
        leaf.$value = want.$value;
    }
  };
  fix(json, []);
  for (const [key, t] of Object.entries(tokens)) {
    if (seen.has(key)) continue;
    let node = json;
    const parts = key.split('.');
    for (const p of parts.slice(0, -1))
      node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = {
      $type: t.$type,
      $value: t.$type === 'dimension' ? `${t.$value}px` : t.$value,
    };
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  const mode = await fs
    .stat(full)
    .then((s) => s.mode & 0o777)
    .catch(() => 0o644);
  await atomicWrite(full, JSON.stringify(json, null, 2) + '\n');
  await fs.chmod(full, mode);
  return file;
}
