import { useEffect, useState } from 'react';
import { FigmaDetail, figmaLevel } from './FigmaPanel.js';
import { codedFor, type CodeComponent } from '../shared/components.js';
import type { FigmaComponent } from '../../connectors/figma/library.js';
import type { Focus } from '../shared/focus.js';

export default function ComponentLibrary({
  figma,
  code,
  error,
  onFocus,
  onAsk,
}: {
  figma?: FigmaComponent[];
  code?: { components: CodeComponent[]; map: Record<string, string> };
  error: string;
  onFocus: (focus: Focus) => void;
  onAsk: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('');
  const fromFigma = (figma ?? []).map((component) => ({
    id: `figma:${component.id}`,
    name: component.name,
    component,
    coded: code
      ? codedFor(component.name, code.components, code.map)
      : undefined,
  }));
  const linked = new Set(
    fromFigma.flatMap((item) => (item.coded ? [item.coded.file] : [])),
  );
  const entries = [
    ...fromFigma,
    ...(code?.components ?? [])
      .filter((c) => !linked.has(c.file))
      .map((coded) => ({
        id: `code:${coded.file}:${coded.name}`,
        name: coded.name,
        component: undefined,
        coded,
      })),
  ];
  const filtered = entries.filter(
    (item) =>
      item.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()) &&
      (category === 'all' ||
        (category === 'code'
          ? !!item.coded
          : item.component && figmaLevel(item.component.page) === category)),
  );
  const picked = entries.find((item) => item.id === selected);
  useEffect(() => {
    if (!picked || picked.component) return;
    onFocus({
      page: 'design-system',
      kind: 'component',
      name: picked.name.slice(0, 80),
      path: [picked.name.slice(0, 80)],
      source: picked.coded?.file.slice(0, 200),
    });
  }, [picked?.id]);
  return (
    <div
      className="ds-workspace"
      role="tabpanel"
      id="panel-components"
      aria-labelledby="tab-components"
    >
      <div className="ds-list">
        <label className="field">
          Rechercher dans les composants
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom du composant…"
          />
        </label>
        <label className="field">
          Catégorie
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Tous les composants</option>
            <option value="atom">Atomes</option>
            <option value="molecule">Molécules</option>
            <option value="organism">Organismes</option>
            <option value="template">Templates</option>
            <option value="code">Déjà codés</option>
          </select>
        </label>
        <p role="status" className="token-hint">
          {filtered.length} composant(s)
        </p>
        {error && (
          <p role="alert" className="error">
            Lecture Figma indisponible : {error}. Les composants du code restent
            consultables.
          </p>
        )}
        {!figma && !code && !error && (
          <p role="status">Lecture des composants…</p>
        )}
        <ul className="ux-component-list">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={picked?.id === item.id ? 'true' : undefined}
                onClick={() => setSelected(item.id)}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.component ? 'Figma' : 'Code'} ·{' '}
                  {item.coded
                    ? 'Codé'
                    : code
                      ? 'Correspondance code à vérifier'
                      : 'Code non chargé'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!filtered.length && (figma || code) && (
          <p>
            Aucun composant ne correspond. Essaie un autre nom ou une autre
            catégorie.
          </p>
        )}
      </div>
      <div className="ds-detail">
        {picked?.component ? (
          <FigmaDetail
            key={picked.id}
            component={picked.component}
            coded={picked.coded}
            onFocus={onFocus}
            onAsk={onAsk}
          />
        ) : picked ? (
          <>
            <h2>{picked.name}</h2>
            <p>
              Composant présent dans le code. Aucun rendu Figma associé dans
              cette liste.
            </p>
            <p>
              <code>{picked.coded?.file}</code>
            </p>
            <button
              onClick={() =>
                onAsk(
                  `Examine le composant ${picked.name} dans ${picked.coded?.file} et propose les améliorations à valider.`,
                )
              }
            >
              Préparer une demande à Clodo
            </button>
          </>
        ) : (
          <div className="ds-stage-empty">
            <h2>Ta bibliothèque de composants</h2>
            <p>
              Choisis un composant pour consulter ses propriétés et sa
              correspondance avec le code.
            </p>
            <p>
              Les badges indiquent sa source. La présence dans le code ne
              garantit pas sa fidélité visuelle.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
