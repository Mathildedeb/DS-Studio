import { useState, type CSSProperties, type ReactNode } from 'react';
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
export function Button({
  variant = 'primary',
  children,
  disabled = false,
  onClick,
}: {
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`ds-button ${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function BookingCard() {
  const [booked, setBooked] = useState(false);
  return (
    <article className="ds-card">
      <div className="card-kicker">ATELIER · 45 MIN</div>
      <h3>Faire moins, mais mieux.</h3>
      <p>Un atelier pour imaginer des services plus attentifs au quotidien.</p>
      <div className="card-meta">
        <span className="ds-badge">6 places disponibles</span>
        <span>Gratuit</span>
      </div>
      <Button onClick={() => setBooked(!booked)}>
        {booked ? 'Réservation confirmée ✓' : 'Réserver une place'}
      </Button>
      <span role="status" className="ds-feedback">
        {booked ? 'Inscription de démonstration, aucune donnée envoyée.' : ''}
      </span>
    </article>
  );
}
export function ExampleForm() {
  const [sent, setSent] = useState(false);
  return (
    <form
      className="ds-form"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
    >
      <label>
        Votre prénom
        <input placeholder="Camille" required onChange={() => setSent(false)} />
      </label>
      <label>
        Adresse e-mail
        <input
          type="email"
          placeholder="camille@example.com"
          required
          onChange={() => setSent(false)}
        />
      </label>
      <label>
        Champ désactivé
        <input placeholder="Non disponible" disabled />
      </label>
      <label className="ds-check">
        <input type="checkbox" required /> J’accepte les conditions de
        démonstration
      </label>
      <button className="ds-button primary" type="submit">
        S’inscrire
      </button>
      <p role="status">
        {sent ? 'Merci ! Démonstration locale, aucune inscription réelle.' : ''}
      </p>
    </form>
  );
}
export function Navigation() {
  const [tab, setTab] = useState('Découvrir');
  return (
    <nav aria-label="Navigation du scénario" className="ds-nav">
      {['Découvrir', 'Favoris', 'Profil'].map((t) => (
        <button
          key={t}
          aria-current={tab === t ? 'page' : undefined}
          onClick={() => setTab(t)}
        >
          {t}
        </button>
      ))}
      <p className="nav-context" aria-live="polite">
        {tab === 'Favoris'
          ? 'Vos ateliers favoris apparaîtront ici.'
          : tab === 'Profil'
            ? 'Votre espace personnel de démonstration.'
            : 'Des idées à explorer près de chez vous.'}
      </p>
    </nav>
  );
}
export function Catalogue({ tokens }: { tokens: Tokens }) {
  return (
    <DSProvider tokens={tokens}>
      <div className="catalogue">
        <section>
          <div className="section-label">01 / ACTIONS</div>
          <h3>Un langage commun.</h3>
          <p>Les mêmes tokens, du composant à l’écran.</p>
          <div className="button-row">
            <Button>Action principale</Button>
            <Button variant="secondary">Secondaire</Button>
            <Button variant="danger">Supprimer</Button>
            <Button disabled>Indisponible</Button>
          </div>
          <p className="ds-caption">
            Survolez, utilisez Tab et activez les boutons. Focus et états natifs
            inclus.
          </p>
        </section>
        <section>
          <div className="section-label">02 / CONTENUS</div>
          <BookingCard />
        </section>
        <section>
          <div className="section-label">03 / SAISIE</div>
          <ExampleForm />
        </section>
        <section>
          <div className="section-label">04 / NAVIGATION</div>
          <Navigation />
        </section>
      </div>
    </DSProvider>
  );
}
export function Scenario({
  tokens,
  scenario,
}: {
  tokens: Tokens;
  scenario: string;
}) {
  return (
    <DSProvider tokens={tokens}>
      <div className="scenario">
        <header className="scenario-head">
          <strong>
            lisière<span>®</span>
          </strong>
          <span className="ds-badge">Bordeaux</span>
        </header>
        <Navigation />
        <main>
          <div className="section-label">LE QUOTIDIEN, AUTREMENT</div>
          <h1>
            De petites idées.
            <br />
            De vrais liens.
          </h1>
          <p>Des ateliers pour apprendre, partager et se rencontrer.</p>
          {scenario === 'form' ? (
            <div className="ds-card">
              <h2>Rejoignez le mouvement.</h2>
              <ExampleForm />
            </div>
          ) : (
            <div className="scenario-grid">
              <BookingCard />
              <article className="ds-card">
                <div className="card-kicker">À VOTRE RYTHME</div>
                <h3>Un quartier qui inspire.</h3>
                <p>Explorez vos prochaines rencontres.</p>
                <Button variant="secondary">Voir les ateliers</Button>
              </article>
            </div>
          )}
        </main>
        <footer>lisière · Design System d’exemple fictif</footer>
      </div>
    </DSProvider>
  );
}
