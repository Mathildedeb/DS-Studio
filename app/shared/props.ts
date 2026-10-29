// Propriétés modifiables d'un composant, lues dans son vrai code : l'interface
// <Nom>Props, ses types (union de chaînes → liste, boolean, string, number)
// et les valeurs par défaut de la déstructuration. Rien n'est déduit du nom
// du composant ; un type que le panneau ne sait pas éditer (icône, fonction…)
// est laissé de côté.
export interface PropSpec {
  name: string;
  kind: 'enum' | 'boolean' | 'string' | 'number';
  options?: string[];
  required: boolean;
  default?: string | number | boolean;
  doc?: string;
}

// Propriétés techniques, jamais proposées dans le panneau.
const technical = new Set(['className', 'style', 'key', 'ref', 'id', 'type']);

const literals = (type: string) => {
  const parts = type.split('|').map((x) => x.trim()).filter(Boolean);
  const values = parts.map((p) => p.match(/^(['"])(.*)\1$/)?.[2]);
  return values.every((v) => v !== undefined) ? (values as string[]) : null;
};

export function readProps(source: string, component: string): PropSpec[] {
  const body = source.match(
    new RegExp(
      `(?:interface\\s+${component}Props\\b([^{]*)|type\\s+${component}Props\\s*=\\s*)\\{([\\s\\S]*?)\\n\\}`,
    ),
  );
  if (!body) return [];
  const heritage = body[1] ?? '';
  // Alias de types du fichier : type ButtonSize = 'small' | 'default'
  const aliases = new Map<string, string>();
  for (const m of source.matchAll(/type\s+(\w+)\s*=\s*([^;\n]+)/g))
    aliases.set(m[1], m[2].trim());
  // Valeurs par défaut : function Nom({ a = 'x', b = true, … })
  const signature =
    source.match(
      new RegExp(
        `(?:function\\s+${component}\\s*\\(|const\\s+${component}\\s*=\\s*\\()\\s*\\{([\\s\\S]*?)\\}\\s*:`,
      ),
    )?.[1] ?? '';
  const defaults = new Map<string, string | number | boolean>();
  for (const m of signature.matchAll(
    /(\w+)\s*=\s*('[^']*'|"[^"]*"|true|false|-?\d+(?:\.\d+)?)/g,
  ))
    defaults.set(
      m[1],
      /^['"]/.test(m[2])
        ? m[2].slice(1, -1)
        : m[2] === 'true' || (m[2] === 'false' ? false : Number(m[2])),
    );
  const specs: PropSpec[] = [];
  let doc = '';
  for (const raw of body[2].split('\n')) {
    const line = raw.trim();
    const comment = line.match(/^\/\*\*?\s*(.*?)\s*\*\/$/) ?? line.match(/^\/\/\s*(.*)$/);
    if (comment) {
      doc = comment[1];
      continue;
    }
    const m = line.match(/^(\w+)(\?)?\s*:\s*([^;]+?);?$/);
    if (!m) continue;
    const [, name, optional, rawType] = m;
    const type = aliases.get(rawType.trim()) ?? rawType.trim();
    const options = literals(type);
    const kind = options
      ? 'enum'
      : type === 'boolean'
        ? 'boolean'
        : type === 'string'
          ? 'string'
          : type === 'number'
            ? 'number'
            : null;
    if (kind && !technical.has(name))
      specs.push({
        name,
        kind,
        ...(options ? { options } : {}),
        required: !optional,
        ...(defaults.has(name) ? { default: defaults.get(name) } : {}),
        ...(doc ? { doc } : {}),
      });
    doc = '';
  }
  const known = new Set(specs.map((s) => s.name));
  // Texte affiché par le composant (children déstructuré et rendu).
  if (/\bchildren\b/.test(signature) && !known.has('children'))
    specs.push({ name: 'children', kind: 'string', required: false, doc: 'Texte' });
  // Un composant qui étend un élément HTML interactif hérite de disabled.
  if (/(Button|Input|Select|TextArea)HTMLAttributes/.test(heritage) && !known.has('disabled'))
    specs.push({ name: 'disabled', kind: 'boolean', required: false, default: false });
  return specs;
}
