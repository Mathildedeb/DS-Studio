import type { CSSProperties, ReactNode } from 'react';
import { tokenCss, type Tokens } from '../shared/model.js';

export function DSProvider({
  tokens,
  children,
}: {
  tokens: Tokens;
  children: ReactNode;
}) {
  return (
    <div className="ds" style={tokenCss(tokens) as CSSProperties}>
      {children}
    </div>
  );
}
// Les composants du Design System viendront ici (Figma, Clodo ou à la main).
// Pour l'instant le DS est vide : seuls les tokens s'appliquent.

// Pages du proto : chaque page s'affiche vide, avec son nom, en attendant
// son contenu.
export function Scenario({
  tokens,
  title = '',
}: {
  tokens: Tokens;
  scenario: string;
  title?: string;
}) {
  return (
    <DSProvider tokens={tokens}>
      <div className="scenario">
        <main className="scenario-empty">
          <h1>{title || 'Nouvelle page'}</h1>
          <p>Page vide. Demandez à Clodo d’y ajouter du contenu.</p>
        </main>
      </div>
    </DSProvider>
  );
}
