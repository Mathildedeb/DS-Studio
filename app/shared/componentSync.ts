import { z } from 'zod';
import type { PropSpec } from './props.js';

// Synchronisation des composants entre Figma et le code du projet : leurs
// propriétés de variante et les valeurs de chacune. Le plugin Figma envoie
// ce qu'il voit ; le code donne l'interface <Nom>Props. Un registre garde
// ce qui a déjà été synchronisé, pour savoir de quel côté vient un écart
// (pas de boucle) et repérer un conflit au lieu d'écraser une version.

// Propriété d'un composant Figma, lue par le plugin.
export const figmaPropSchema = z
  .object({
    name: z.string().max(80),
    type: z.enum(['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP']),
    options: z.array(z.string().max(80)).max(60).optional(),
    default: z.union([z.string().max(200), z.boolean()]).optional(),
  })
  .strict();
export const figmaComponentSchema = z
  .object({
    // Identifiant stable : celui que le plugin écrit sur le composant
    // (sharedPluginData), à défaut l'id du nœud.
    id: z.string().max(200),
    name: z.string().max(200),
    page: z.string().max(200),
    props: z.array(figmaPropSchema).max(40),
  })
  .strict();
export type FigmaProp = z.infer<typeof figmaPropSchema>;
export type FigmaComponentProps = z.infer<typeof figmaComponentSchema>;

// Ce que le plugin doit faire dans Figma : ajouter une valeur de variante
// (une nouvelle variante, copiée de la plus proche).
export const figmaOpSchema = z
  .object({
    id: z.string().max(60),
    component: z.string().max(200),
    property: z.string().max(80),
    value: z.string().max(80),
  })
  .strict();
export type FigmaOp = z.infer<typeof figmaOpSchema>;

// Registre : pour chaque composant et propriété, les valeurs vues des deux
// côtés lors de la dernière synchronisation réussie.
export type Ledger = Record<string, Record<string, { values: string[]; at: string }>>;

// « Par défaut » ↔ « default », « Rêveur » ↔ « reveur » : mêmes valeurs.
const synonyms: Record<string, string> = { pardefaut: 'default', defaut: 'default', oui: 'yes', non: 'no', true: 'yes', false: 'no' };
export const normValue = (s: string) => {
  const n = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return synonyms[n] ?? n;
};

// Propriété Figma qui correspond à une propriété du code : celle que nomme
// son commentaire (« Variante Figma « user type » »), sinon le même nom.
export const figmaNameOf = (spec: PropSpec) =>
  spec.doc?.match(/Figma\s*«\s*([^»]+?)\s*»/)?.[1] ?? spec.name;

export type SyncItem = {
  component: string;
  figmaId: string;
  file: string;
  property: string;
  codeProp: string;
  value: string;
  // figma : à coder (vient de Figma) ; code : à créer dans Figma (vient de
  // DS-Studio) ; removed-* : disparue d'un côté depuis la dernière synchro ;
  // conflict : changée des deux côtés.
  kind: 'figma' | 'code' | 'removed-figma' | 'removed-code' | 'conflict';
};
export type SyncSummary = {
  items: SyncItem[];
  synced: { component: string; property: string; values: number }[];
  // Propriétés sans correspondance : signalées, jamais modifiées.
  unsupported: { component: string; property: string; reason: string }[];
  ledger: Ledger;
};

export function compareComponents(
  pairs: { figma: FigmaComponentProps; file: string; specs: PropSpec[] }[],
  ledger: Ledger,
  now = new Date().toISOString(),
): SyncSummary {
  const items: SyncItem[] = [];
  const synced: SyncSummary['synced'] = [];
  const unsupported: SyncSummary['unsupported'] = [];
  const next: Ledger = structuredClone(ledger);
  for (const { figma, file, specs } of pairs) {
    for (const fp of figma.props) {
      if (fp.type !== 'VARIANT') {
        unsupported.push({ component: figma.name, property: fp.name, reason: `propriété ${fp.type.toLowerCase()} : pas encore synchronisée` });
        continue;
      }
      const spec = specs.find((s) => normValue(figmaNameOf(s)) === normValue(fp.name));
      if (!spec) {
        unsupported.push({ component: figma.name, property: fp.name, reason: 'aucune propriété du code ne lui correspond' });
        continue;
      }
      const figmaValues = fp.options ?? [];
      // Un booléen du code vaut une variante à deux états dans Figma, quels
      // que soient leurs noms (« Default / yes », « off / on »…).
      const codeValues =
        spec.kind === 'enum'
          ? (spec.options ?? [])
          : spec.kind === 'boolean'
            ? figmaValues.length <= 2
              ? figmaValues
              : figmaValues.filter((v) => ['yes', 'no', 'default'].includes(normValue(v)))
            : [];
      if (spec.kind !== 'enum' && spec.kind !== 'boolean') {
        unsupported.push({ component: figma.name, property: fp.name, reason: `type ${spec.kind} dans le code` });
        continue;
      }
      const inFigma = new Map(figmaValues.map((v) => [normValue(v), v]));
      const inCode = new Map(codeValues.map((v) => [normValue(v), v]));
      const known = new Set((ledger[figma.id]?.[fp.name]?.values ?? []).map(normValue));
      const first = !ledger[figma.id]?.[fp.name];
      let clean = true;
      for (const [k, v] of inFigma)
        if (!inCode.has(k)) {
          clean = false;
          items.push({
            component: figma.name,
            figmaId: figma.id,
            file,
            property: fp.name,
            codeProp: spec.name,
            value: v,
            kind: !first && known.has(k) ? 'removed-code' : 'figma',
          });
        }
      for (const [k, v] of inCode)
        if (!inFigma.has(k)) {
          clean = false;
          items.push({
            component: figma.name,
            figmaId: figma.id,
            file,
            property: fp.name,
            codeProp: spec.name,
            value: v,
            kind: !first && known.has(k) ? 'removed-figma' : 'code',
          });
        }
      // Première rencontre : sans registre, impossible de savoir qui a
      // ajouté ; un écart des deux côtés à la fois est un conflit à trancher.
      if (first && !clean) {
        const kinds = new Set(items.filter((i) => i.figmaId === figma.id && i.property === fp.name).map((i) => i.kind));
        if (kinds.has('figma') && kinds.has('code'))
          for (const i of items)
            if (i.figmaId === figma.id && i.property === fp.name) i.kind = 'conflict';
      }
      if (clean) {
        synced.push({ component: figma.name, property: fp.name, values: figmaValues.length });
        next[figma.id] = { ...next[figma.id], [fp.name]: { values: figmaValues, at: now } };
      }
    }
  }
  return { items, synced, unsupported, ledger: next };
}

// Nom d'une variante Figma avec une valeur changée :
// « style=filled, Size=small » + style=ghost → « style=ghost, Size=small ».
export const variantName = (name: string, property: string, value: string) =>
  name
    .split(',')
    .map((part) => {
      const [k, ...rest] = part.split('=');
      return k.trim() === property && rest.length ? `${k.trim()}=${value}` : `${k.trim()}=${rest.join('=').trim()}`;
    })
    .join(', ');
