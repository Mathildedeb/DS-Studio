import { useEffect, useState } from 'react';
import { request } from './api.js';
import type { Proposal } from '../shared/model.js';
import type { Focus } from '../shared/focus.js';
import type {
  FigmaComponent,
  FigmaNode,
} from '../../connectors/figma/library.js';

// Onglet Figma : les composants du fichier relié au projet, leur rendu et
// leur structure, et l'import des tokens du projet (design-system/tokens.json).
interface ProjectTokens {
  file: string;
  tokens: Record<string, unknown>;
  skipped: { name: string; reason: string }[];
}

export default function FigmaPanel({
  active,
  revision,
  onProposal,
  onFocus,
  onAsk,
}: {
  active: boolean;
  revision: number;
  onProposal: (p: Proposal) => void;
  onFocus: (f: Focus) => void;
  onAsk: (message: string) => void;
}) {
  const [list, setList] = useState<FigmaComponent[]>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FigmaComponent>();
  const [node, setNode] = useState<FigmaNode>();
  const [project, setProject] = useState<ProjectTokens>();
  const [tokenError, setTokenError] = useState('');
  useEffect(() => {
    if (!active || list) return;
    request<FigmaComponent[]>('figma/components')
      .then(setList)
      .catch((e) => setError(e.message));
    request<ProjectTokens>('project-tokens')
      .then(setProject)
      .catch((e) => setTokenError(e.message));
  }, [active]);
  useEffect(() => {
    if (!selected) return;
    setNode(undefined);
    onFocus({
      page: 'design-system',
      kind: 'component',
      name: selected.name.slice(0, 80),
      path: [selected.page || 'Figma', selected.name].map((x) =>
        x.slice(0, 80),
      ),
      level: selected.page.slice(0, 20) || undefined,
      source: 'Figma',
      value: selected.id,
    });
    request<FigmaNode>(`figma/node?id=${encodeURIComponent(selected.id)}`)
      .then(setNode)
      .catch(() => undefined);
  }, [selected?.id]);

  const q = query.trim().toLowerCase();
  // Ordre atomique d'abord (Atoms → Template), puis les autres pages.
  const order = (p: string) => {
    const i = ['atom', 'mol', 'org', 'templ'].findIndex((x) =>
      p.toLowerCase().startsWith(x),
    );
    return i < 0 ? 9 : i;
  };
  const pages = [...new Set((list ?? []).map((c) => c.page || 'Autres'))].sort(
    (a, b) => order(a) - order(b),
  );
  return (
    <div
      className="ds-workspace"
      role="tabpanel"
      id="panel-figma"
      aria-labelledby="tab-figma"
      hidden={!active}
    >
      <div className="ds-list">
        <section className="figma-tokens" aria-label="Tokens du projet">
          <strong>Tokens du projet</strong>
          {project ? (
            <>
              <p>
                {Object.keys(project.tokens).length} tokens lisibles dans{' '}
                <code>{project.file}</code>
                {project.skipped.length > 0 &&
                  ` · ${project.skipped.length} non repris (typographies composées, ombres, transparences…)`}
              </p>
              <button
                type="button"
                className="studio-primary"
                onClick={() =>
                  request<Proposal>('project-tokens/import', { revision })
                    .then(onProposal)
                    .catch((e) => setTokenError(e.message))
                }
              >
                Importer dans DS-Studio
              </button>
            </>
          ) : (
            <p>{tokenError || 'Lecture…'}</p>
          )}
          {project && tokenError && <p className="error">{tokenError}</p>}
        </section>
        <label className="field">
          Rechercher un composant Figma
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="button, card, calendar…"
          />
        </label>
        {!list && (
          <p className="ds-list-empty">{error || 'Lecture de Figma…'}</p>
        )}
        {pages.map((page) => {
          const items = (list ?? []).filter(
            (c) =>
              (c.page || 'Autres') === page && c.name.toLowerCase().includes(q),
          );
          if (!items.length) return null;
          return (
            <div key={page}>
              <div className="toc-label">
                {page} <span>{items.length}</span>
              </div>
              <ul>
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === selected?.id ? 'true' : undefined}
                      onClick={() => setSelected(c)}
                    >
                      <strong>{c.name}</strong>
                      <span>
                        {c.variants > 1 ? `${c.variants} variantes` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="ds-detail">
        {!selected ? (
          <p className="ds-stage-empty">
            Choisissez un composant de votre fichier Figma pour voir son rendu
            et sa structure, puis demandez à Clodo de le coder.
          </p>
        ) : (
          <>
            <header className="ds-detail-head">
              <div>
                <h2>{selected.name}</h2>
                <p>
                  Figma · {selected.page || 'page inconnue'}
                  {selected.variants > 1 && ` · ${selected.variants} variantes`}
                </p>
              </div>
              <button
                type="button"
                className="studio-primary"
                onClick={() =>
                  onAsk(
                    `Code le composant Figma « ${selected.name} » dans mon projet, fidèle à Figma, avec mes tokens.`,
                  )
                }
              >
                Demander à Clodo de le coder
              </button>
            </header>
            <div className="ds-stage figma-render">
              <img
                key={selected.id}
                src={`/api/figma/image?id=${encodeURIComponent(selected.id)}`}
                alt={`Rendu Figma de ${selected.name}`}
              />
            </div>
            <p className="ds-stage-foot">
              Rendu exporté par Figma (×2), affiché à demi-taille.
            </p>
            {node && (
              <section className="ds-props" aria-label="Structure Figma">
                <div>
                  <h3>Structure</h3>
                  <p className="ds-crumbs">
                    {node.type}
                    {node.size &&
                      ` · ${Math.round(node.size.width)} × ${Math.round(node.size.height)}`}
                    {node.layout &&
                      ` · auto-layout ${node.layout.mode.toLowerCase()}, gap ${node.layout.gap ?? 0}, padding ${node.layout.padding?.join(' ')}`}
                  </p>
                  {node.fills && (
                    <p className="ds-muted">Fond : {node.fills.join(', ')}</p>
                  )}
                  {node.radius !== undefined && (
                    <p className="ds-muted">Rayon : {String(node.radius)}</p>
                  )}
                </div>
                <div>
                  <h3>Propriétés Figma</h3>
                  {node.props ? (
                    Object.entries(node.props).map(([k, p]) => (
                      <p key={k} className="ds-muted">
                        <strong>{k.replace(/#.*$/, '')}</strong> ·{' '}
                        {p.type.toLowerCase()}
                        {p.options?.length ? ` : ${p.options.join(' | ')}` : ''}
                      </p>
                    ))
                  ) : (
                    <p className="ds-muted">Aucune propriété déclarée.</p>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
