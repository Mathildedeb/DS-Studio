import { useEffect, useState } from 'react';
import { request } from './api.js';

import type { Proposal } from '../shared/model.js';
import type { Focus } from '../shared/focus.js';
import type { Level } from './dsRegistry.js';
import type { CodeComponent } from '../shared/components.js';
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
  list,
  error,
  revision,
  onProposal,
  onFocus,
  onAsk,
}: {
  active: boolean;
  // Composants lus une fois par App, partagés avec les onglets atomiques.
  list?: FigmaComponent[];
  error: string;
  revision: number;
  onProposal: (p: Proposal) => void;
  onFocus: (f: Focus) => void;
  onAsk: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FigmaComponent>();
  const [project, setProject] = useState<ProjectTokens>();
  const [tokenError, setTokenError] = useState('');
  const [pairing, setPairing] = useState<{ token: string; manifest: string }>();
  const [showCode, setShowCode] = useState(false);
  useEffect(() => {
    if (!active || project) return;
    request<{ token: string; manifest: string }>('plugin/pairing')
      .then(setPairing)
      .catch(() => undefined);
    request<ProjectTokens>('project-tokens')
      .then(setProject)
      .catch((e) => setTokenError(e.message));
  }, [active]);

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
        <a className="ux-text-link" href="#synchro">
          Voir les écarts Figma et code →
        </a>
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
        <details className="figma-tokens figma-plugin">
          <summary>
            <strong>Plugin Figma DS-Studio</strong>
          </summary>
          <p>
            Il applique tes tokens validés aux variables de ton fichier Figma :
            les composants qui les utilisent suivent.
          </p>
          <ol>
            <li>
              Figma (app de bureau) → Plugins → Développement → Importer un
              plugin depuis un manifeste.
            </li>
            <li>
              Choisis :{' '}
              <code>{pairing?.manifest ?? 'figma-plugin/manifest.json'}</code>
            </li>
            <li>Lance « DS-Studio » dans ton fichier, colle ce code :</li>
          </ol>
          {pairing && (
            <div className="plugin-code">
              <code>{showCode ? pairing.token : '•'.repeat(12)}</code>
              <button type="button" onClick={() => setShowCode(!showCode)}>
                {showCode ? 'Masquer' : 'Afficher'}
              </button>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard?.writeText(pairing.token)
                }
              >
                Copier
              </button>
              <button
                type="button"
                title="Le plugin devra recevoir le nouveau code"
                onClick={() =>
                  request<{ token: string; manifest: string }>(
                    'plugin/pairing/renew',
                    {},
                  )
                    .then(setPairing)
                    .catch(() => undefined)
                }
              >
                Renouveler
              </button>
            </div>
          )}
        </details>
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
          <FigmaDetail component={selected} onFocus={onFocus} onAsk={onAsk} />
        )}
      </div>
    </div>
  );
}

// Niveau atomique déduit du nom de la page Figma (Atoms, Molécules, Organism…).
export function figmaLevel(page: string): Level | undefined {
  const p = page.toLowerCase();
  if (p.startsWith('atom')) return 'atom';
  if (p.startsWith('mol')) return 'molecule';
  if (p.startsWith('org')) return 'organism';
  if (p.startsWith('templ')) return 'template';
  return undefined;
}

// Détail d'un composant Figma : rendu, structure, propriétés, et la demande
// à Clodo de le coder. Utilisé par l'onglet Figma et les onglets atomiques.
export function FigmaDetail({
  component,
  onFocus,
  onAsk,
  coded,
}: {
  component: FigmaComponent;
  onFocus: (f: Focus) => void;
  onAsk: (message: string) => void;
  // Composant déjà codé dans le projet : Clodo le modifie, ne le recode pas.
  coded?: CodeComponent;
}) {
  const [node, setNode] = useState<FigmaNode>();
  useEffect(() => {
    setNode(undefined);
    onFocus({
      page: 'design-system',
      kind: 'component',
      name: component.name.slice(0, 80),
      path: [component.page || 'Figma', component.name].map((x) =>
        x.slice(0, 80),
      ),
      level: component.page.slice(0, 20) || undefined,
      source: 'Figma',
      value: component.id,
    });
    request<FigmaNode>(`figma/node?id=${encodeURIComponent(component.id)}`)
      .then(setNode)
      .catch(() => undefined);
  }, [component?.id]);
  return (
    <>
      <header className="ds-detail-head">
        <div>
          <h2>{component.name}</h2>
          <p>
            Figma · {component.page || 'page inconnue'}
            {component.variants > 1 && ` · ${component.variants} variantes`}
          </p>
        </div>
        <button
          type="button"
          className="studio-primary"
          onClick={() =>
            onAsk(
              coded
                ? `Compare le composant ${coded.name} (${coded.file}) au composant Figma « ${component.name} » et propose ce qu'il faut ajuster.`
                : `Code le composant Figma « ${component.name} » dans mon projet, fidèle à Figma, avec mes tokens.`,
            )
          }
        >
          {coded ? 'Comparer avec Figma' : 'Demander à Clodo de le coder'}
        </button>
      </header>
      <div className="ds-stage figma-render">
        <img
          key={component.id}
          src={`/api/figma/image?id=${encodeURIComponent(component.id)}`}
          alt={`Rendu Figma de ${component.name}`}
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
  );
}
