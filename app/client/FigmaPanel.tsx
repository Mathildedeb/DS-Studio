import { useEffect, useState } from 'react';
import { request } from './api.js';

import type { Focus } from '../shared/focus.js';
import type { Level } from './dsRegistry.js';
import type { CodeComponent } from '../shared/components.js';
import type {
  FigmaComponent,
  FigmaNode,
} from '../../connectors/figma/library.js';

// Composants Figma vus dans les onglets du DS : niveau atomique d'une page
// Figma, et fiche d'un composant (rendu, structure, demande à Clodo).

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
// à Clodo de le coder. Utilisé par les onglets Composants et atomiques.
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
