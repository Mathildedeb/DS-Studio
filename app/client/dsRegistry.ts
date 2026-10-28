import type { TokenKey } from '../shared/model.js';

// Registre atomique du DS : ce que chaque élément est réellement dans le code.
// Un élément du rendu est reconnu par son sélecteur CSS (ou data-ds) : aucune
// prop n'est inventée, les valeurs affichées sont lues sur le DOM.
export type Level = 'atom' | 'molecule' | 'organism' | 'template';
export const levels: Record<Level, string> = {
  atom: 'Atomes',
  molecule: 'Molécules',
  organism: 'Organismes',
  template: 'Templates',
};
export interface PropSpec {
  name: string;
  type: 'text' | 'enum' | 'bool';
  options?: string[];
  default: string | boolean;
  read: (el: HTMLElement) => string | boolean;
}
export interface Entry {
  name: string;
  level: Level;
  kind: string;
  source: string | null;
  selector?: string;
  props: PropSpec[];
  states: string[];
  missing: string[];
  tokens: TokenKey[];
  uses?: string[];
}

// Vide pour l'instant : chaque composant ajouté au DS y sera décrit.
export const registry: Entry[] = [
  {
    name: 'Pages',
    level: 'template',
    kind: 'pages du proto',
    source: 'React · DesignSystem.tsx › Scenario',
    props: [],
    states: [],
    missing: [],
    tokens: ['color.canvas', 'color.text', 'font.heading'],
  },
];
export const entry = (name: string) => registry.find((e) => e.name === name);
export const usedBy = (key: TokenKey) =>
  registry.filter((e) => e.tokens.includes(key)).map((e) => e.name);
export const usedIn = (name: string) =>
  registry.filter((e) => e.uses?.includes(name)).map((e) => e.name);
// Les organismes passent avant les molécules puis les atomes : un
// article.ds-card de BookingCard est BookingCard avant d'être une Card.
const byPriority = (['organism', 'molecule', 'atom'] as Level[]).flatMap((l) =>
  registry.filter((e) => e.level === l),
);
export function match(el: Element) {
  return byPriority.find((e) => e.selector && el.matches(e.selector));
}
