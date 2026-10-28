// Correspondance entre un composant Figma et un composant déjà codé dans le
// projet : DS-Studio l'affiche « codé » et Clodo le réutilise au lieu de le
// recoder.
export interface CodeComponent {
  name: string;
  file: string;
}

// « calendar/date-item » → « calendardateitem », « Rêveur » → « reveur »
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Fichier indiqué dans design-system/components.json, sinon même nom complet
// (« calendar/date-item » ↔ CalendarDateItem), sinon même dernier segment
// s'il ne désigne qu'un composant (« button/toggle » ↔ Toggle).
export function codedFor(
  figmaName: string,
  code: CodeComponent[],
  map: Record<string, string> = {},
): CodeComponent | undefined {
  const forced = map[figmaName];
  if (forced)
    return code.find((c) => c.file === forced) ?? { name: figmaName, file: forced };
  const full = norm(figmaName);
  const exact = code.find((c) => norm(c.name) === full);
  if (exact) return exact;
  const last = norm(figmaName.split('/').pop() ?? '');
  const byLast = code.filter((c) => norm(c.name) === last);
  return new Set(byLast.map((c) => c.file)).size === 1 ? byLast[0] : undefined;
}
