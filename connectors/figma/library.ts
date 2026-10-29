import { StudioError } from '../../app/server/store.js';
import { figmaFileKey, type FigmaReader } from './reader.js';

// Ce que DS-Studio lit d'un fichier Figma pour le coder : ses composants, la
// structure simplifiée d'un composant, son rendu, et ses variables (ou
// styles). Tout est borné avant d'aller vers la page ou vers Clodo.
export interface FigmaComponent {
  id: string;
  name: string;
  page: string;
  description: string;
  variants: number;
}
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  size?: { width: number; height: number };
  layout?: {
    mode: string;
    gap?: number;
    padding?: [number, number, number, number];
    align?: string;
    counterAlign?: string;
    wrap?: boolean;
  };
  fills?: string[];
  strokes?: string[];
  strokeWeight?: number;
  radius?: number | number[];
  opacity?: number;
  text?: string;
  font?: {
    family?: string;
    size?: number;
    weight?: number;
    lineHeight?: number;
    letterSpacing?: number;
  };
  props?: Record<
    string,
    { type: string; default: unknown; options?: string[] }
  >;
  children?: FigmaNode[];
}
export interface FigmaVariable {
  name: string;
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'TEXT';
  value: string;
}
export interface FigmaVariables {
  source: 'variables' | 'styles';
  items: FigmaVariable[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 120) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.round(v * 100) / 100
    : undefined;
const hex = (c: unknown, alpha = 1) => {
  const { r, g, b, a } = obj(c);
  const part = (x: unknown) =>
    Math.round((num(x) ?? 0) * 255)
      .toString(16)
      .padStart(2, '0');
  const opacity = (num(a) ?? 1) * alpha;
  return (
    `#${part(r)}${part(g)}${part(b)}`.toUpperCase() +
    (opacity < 1 ? ` ${Math.round(opacity * 100)}%` : '')
  );
};
const paints = (v: unknown) =>
  arr(v)
    .map(obj)
    .filter((p) => p.visible !== false)
    .map((p) =>
      p.type === 'SOLID'
        ? hex(p.color, num(p.opacity) ?? 1)
        : str(p.type).toLowerCase(),
    )
    .slice(0, 6);
export const figmaNodeId = (id: string) =>
  /^I?\d+[:-]\d+(;\d+[:-]\d+)*$/.test(id) && id.length <= 200
    ? id.replaceAll('-', ':')
    : undefined;
const keyOf = (fileUrl: string | undefined) => {
  const key = figmaFileKey(fileUrl);
  if (!key)
    throw new StudioError(
      'Figma : ouvrez un projet avec le lien de son fichier.',
      409,
    );
  return key;
};

// Nœud simplifié : mise en page, couleurs, typo et propriétés, 300 nœuds max.
export function simplify(raw: unknown, budget = { nodes: 300 }, depth = 0) {
  const n = obj(raw);
  budget.nodes--;
  const node: FigmaNode = {
    id: str(n.id, 200),
    name: str(n.name),
    type: str(n.type, 40),
  };
  const box = obj(n.absoluteBoundingBox);
  if (num(box.width) !== undefined)
    node.size = { width: num(box.width)!, height: num(box.height) ?? 0 };
  if (n.layoutMode && n.layoutMode !== 'NONE')
    node.layout = {
      mode: str(n.layoutMode, 20),
      gap: num(n.itemSpacing),
      padding: [
        num(n.paddingTop) ?? 0,
        num(n.paddingRight) ?? 0,
        num(n.paddingBottom) ?? 0,
        num(n.paddingLeft) ?? 0,
      ],
      align: str(n.primaryAxisAlignItems, 20) || undefined,
      counterAlign: str(n.counterAxisAlignItems, 20) || undefined,
      wrap: n.layoutWrap === 'WRAP' || undefined,
    };
  const fills = paints(n.fills);
  if (fills.length) node.fills = fills;
  const strokes = paints(n.strokes);
  if (strokes.length) {
    node.strokes = strokes;
    node.strokeWeight = num(n.strokeWeight);
  }
  if (num(n.cornerRadius)) node.radius = num(n.cornerRadius);
  else if (arr(n.rectangleCornerRadii).length)
    node.radius = arr(n.rectangleCornerRadii).map((r) => num(r) ?? 0);
  if (num(n.opacity) !== undefined && num(n.opacity)! < 1)
    node.opacity = num(n.opacity);
  if (n.type === 'TEXT') {
    node.text = str(n.characters, 300);
    const st = obj(n.style);
    node.font = {
      family: str(st.fontFamily) || undefined,
      size: num(st.fontSize),
      weight: num(st.fontWeight),
      lineHeight: num(st.lineHeightPx),
      letterSpacing: num(st.letterSpacing) || undefined,
    };
  }
  const defs = Object.entries(obj(n.componentPropertyDefinitions)).slice(0, 30);
  if (defs.length)
    node.props = Object.fromEntries(
      defs.map(([k, d]) => {
        const def = obj(d);
        return [
          str(k, 60),
          {
            type: str(def.type, 20),
            default: def.defaultValue,
            options: arr(def.variantOptions).map((o) => str(o, 60)),
          },
        ];
      }),
    );
  const kids = arr(n.children);
  if (kids.length && depth < 8 && budget.nodes > 0) {
    node.children = [];
    for (const k of kids) {
      if (budget.nodes <= 0) break;
      node.children.push(simplify(k, budget, depth + 1));
    }
  }
  return node;
}

// Composants locaux, publiés ou non : l'API « components » ne liste que les
// bibliothèques publiées, on parcourt donc l'arbre du fichier.
export async function figmaComponents(
  reader: FigmaReader,
  fileUrl: string | undefined,
): Promise<FigmaComponent[]> {
  const file = obj(await reader.api(`/v1/files/${keyOf(fileUrl)}?depth=6`));
  const found = new Map<string, FigmaComponent>();
  const walk = (raw: unknown, page: string, inSet: boolean) => {
    const n = obj(raw);
    const id = str(n.id, 200);
    if (n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && !inSet))
      found.set(id, {
        id,
        name: str(n.name),
        page,
        description: str(n.description, 300),
        variants: n.type === 'COMPONENT_SET' ? arr(n.children).length : 1,
      });
    for (const k of arr(n.children)) walk(k, page, n.type === 'COMPONENT_SET');
  };
  for (const p of arr(obj(file.document).children))
    walk(p, str(obj(p).name), false);
  // Les tables du fichier complètent ce que la profondeur a coupé.
  const sets = obj(file.componentSets);
  for (const [id, raw] of Object.entries(obj(file.components))) {
    const c = obj(raw);
    if (c.remote === true) continue;
    const setId = str(c.componentSetId, 200);
    const target = setId || id;
    if (found.has(target)) continue;
    found.set(target, {
      id: target,
      name: str(setId ? obj(sets[setId]).name : c.name),
      page: '',
      description: str(c.description, 300),
      variants: 1,
    });
  }
  return [...found.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 300);
}

export async function figmaNode(
  reader: FigmaReader,
  fileUrl: string | undefined,
  nodeId: string,
) {
  const id = figmaNodeId(nodeId);
  if (!id) throw new StudioError('Identifiant Figma invalide.');
  const body = obj(
    await reader.api(
      `/v1/files/${keyOf(fileUrl)}/nodes?ids=${encodeURIComponent(id)}`,
    ),
  );
  const doc = obj(obj(obj(body.nodes)[id]).document);
  if (!doc.id) throw new StudioError('Figma : élément introuvable.', 404);
  return simplify(doc);
}

// Variantes d'un composant Figma pas encore codé : ses propriétés de variante
// (valeurs autorisées, défaut) et l'identifiant de chaque combinaison, pour
// que la maquette de la Preview change de rendu comme le vrai composant.
export async function figmaVariants(
  reader: FigmaReader,
  fileUrl: string | undefined,
  nodeId: string,
) {
  const id = figmaNodeId(nodeId);
  if (!id) throw new StudioError('Identifiant Figma invalide.');
  const body = obj(
    await reader.api(
      `/v1/files/${keyOf(fileUrl)}/nodes?ids=${encodeURIComponent(id)}&depth=1`,
    ),
  );
  const doc = obj(obj(obj(body.nodes)[id]).document);
  if (!doc.id) throw new StudioError('Figma : élément introuvable.', 404);
  const props = Object.entries(obj(doc.componentPropertyDefinitions))
    .map(([name, raw]): Record<string, unknown> & { name: string } => ({ ...obj(raw), name: str(name, 60) }))
    .filter((p) => p.type === 'VARIANT')
    .slice(0, 20)
    .map((p) => ({
      name: p.name,
      kind: 'enum' as const,
      options: arr(p.variantOptions).map((o) => str(o, 60)).slice(0, 40),
      required: false,
      default: str(p.defaultValue, 60),
      doc: 'Variante Figma',
    }));
  const variants =
    doc.type === 'COMPONENT_SET'
      ? arr(doc.children)
          .map(obj)
          .slice(0, 200)
          .map((v) => ({
            id: str(v.id, 200),
            values: Object.fromEntries(
              str(v.name, 300)
                .split(',')
                .map((part) => part.split('=').map((x) => x.trim()))
                .filter((kv) => kv.length === 2),
            ) as Record<string, string>,
          }))
      : [{ id: str(doc.id, 200), values: {} }];
  // Sans définitions dans la réponse, les noms des variantes les donnent
  // (« style=filled, Size=small ») : valeurs vues, défaut = première variante.
  if (!props.length && variants.length > 1)
    for (const name of Object.keys(variants[0].values).slice(0, 20))
      props.push({
        name,
        kind: 'enum',
        options: [...new Set(variants.map((v) => v.values[name]).filter(Boolean))].slice(0, 40),
        required: false,
        default: variants[0].values[name],
        doc: 'Variante Figma',
      });
  return { props, variants };
}

// Rendu PNG d'un nœud, relayé par le serveur : la page n'appelle jamais Figma.
export async function figmaImage(
  reader: FigmaReader,
  fileUrl: string | undefined,
  nodeId: string,
) {
  const id = figmaNodeId(nodeId);
  if (!id) throw new StudioError('Identifiant Figma invalide.');
  const body = obj(
    await reader.api(
      `/v1/images/${keyOf(fileUrl)}?ids=${encodeURIComponent(id)}&format=png&scale=2`,
    ),
  );
  return reader.download(str(obj(body.images)[id], 2000));
}

// Variables (offre Enterprise), sinon styles de couleur et de texte.
export async function figmaVariables(
  reader: FigmaReader,
  fileUrl: string | undefined,
): Promise<FigmaVariables> {
  const key = keyOf(fileUrl);
  const vars = await reader.api(`/v1/files/${key}/variables/local`, true);
  if (vars) {
    const meta = obj(obj(vars).meta);
    const variables = obj(meta.variables);
    const collections = obj(meta.variableCollections);
    const items = Object.values(variables)
      .map(obj)
      .filter((v) => v.remote !== true)
      .slice(0, 500)
      .map((v): FigmaVariable => {
        const col = obj(collections[str(v.variableCollectionId, 200)]);
        const value = obj(v.valuesByMode)[str(col.defaultModeId, 200)];
        const alias = obj(value);
        return {
          name: `${str(col.name)}/${str(v.name)}`,
          type: (str(v.resolvedType, 20) || 'STRING') as FigmaVariable['type'],
          value:
            alias.type === 'VARIABLE_ALIAS'
              ? `→ ${str(obj(variables[str(alias.id, 200)]).name)}`
              : v.resolvedType === 'COLOR'
                ? hex(value)
                : String(value).slice(0, 100),
        };
      });
    return { source: 'variables', items };
  }
  const file = obj(await reader.api(`/v1/files/${key}?depth=1`));
  const styles = Object.entries(obj(file.styles))
    .map(([id, s]): Raw & { id: string } => ({ ...obj(s), id }))
    .filter((s) => s.remote !== true && /^(FILL|TEXT)$/.test(str(s.styleType)))
    .slice(0, 100);
  if (!styles.length) return { source: 'styles', items: [] };
  const nodes = obj(
    obj(
      await reader.api(
        `/v1/files/${key}/nodes?ids=${encodeURIComponent(styles.map((s) => s.id).join(','))}`,
      ),
    ).nodes,
  );
  return {
    source: 'styles',
    items: styles.map((s): FigmaVariable => {
      const doc = obj(obj(nodes[s.id]).document);
      const st = obj(doc.style);
      return s.styleType === 'FILL'
        ? {
            name: str(s.name),
            type: 'COLOR',
            value: paints(doc.fills)[0] ?? '—',
          }
        : {
            name: str(s.name),
            type: 'TEXT',
            value: `${str(st.fontFamily)} · ${num(st.fontSize) ?? ''}px · ${num(st.fontWeight) ?? ''}`,
          };
    }),
  };
}

// Proposition de tokens DS-Studio à partir des variables Figma : seules les
// valeurs que le format de tokens sait porter sont reprises.
export function variablesToTokens(items: FigmaVariable[]) {
  const tokens: Record<string, { $type: string; $value: string | number }> = {};
  const skipped: string[] = [];
  for (const v of items) {
    const parts = v.name
      .split('/')
      .map((p) =>
        p
          .normalize('NFD')
          .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) =>
            c ? c.toUpperCase() : '',
          )
          .replace(/^[A-Z]/, (c) => c.toLowerCase()),
      )
      .filter(Boolean);
    const group =
      v.type === 'COLOR'
        ? 'color'
        : v.type === 'FLOAT'
          ? 'space'
          : v.type === 'STRING'
            ? 'font'
            : '';
    // Le nom de collection est souvent générique : on garde les 2 derniers niveaux.
    const key = [group, ...parts.slice(-2)].join('.');
    const color = v.value.match(/^#[0-9A-F]{6}$/)?.[0];
    const size = Number(v.value);
    if (!group || !/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,3}$/.test(key)) {
      skipped.push(v.name);
    } else if (v.type === 'COLOR' && color)
      tokens[key] = { $type: 'color', $value: color };
    else if (v.type === 'FLOAT' && size >= 0 && size <= 128)
      tokens[key] = { $type: 'dimension', $value: size };
    else if (
      v.type === 'STRING' &&
      /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/.test(v.value)
    )
      tokens[key] = { $type: 'fontFamily', $value: v.value };
    else skipped.push(v.name);
  }
  return { tokens, skipped };
}
