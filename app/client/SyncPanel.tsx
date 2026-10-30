import { useEffect, useState } from 'react';
import { request } from './api.js';
import type { FigmaOp, SyncItem } from '../shared/componentSync.js';

type Status = {
  pluginSeenAt: number | null;
  snapshotAt: string | null;
  figmaComponents: number;
  matched: number;
  items: (SyncItem & { queued: boolean })[];
  synced: { component: string; property: string; values: number }[];
  unsupported: { component: string; property: string; reason: string }[];
  queue: FigmaOp[];
  results: { op: FigmaOp; ok: boolean; reason: string; at: string }[];
  git: { branch?: string; files: unknown[]; ahead?: number } | null;
  pr: { number: number; url: string; title: string } | null;
};

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `il y a ${s} s` : `il y a ${Math.round(s / 60)} min`;
};

// Espace Synchro : composants Figma ↔ code. Ce qui vient de Figma se code
// (Clodo, diff, PR) ; ce qui vient du code se crée dans Figma par le plugin.
// Un écart des deux côtés est un conflit : rien n'est écrasé sans choix.
export default function SyncPanel({
  active,
  onAsk,
}: {
  active: boolean;
  onAsk: (message: string) => void;
}) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const load = () =>
    request<Status>('component-sync')
      .then((s) => {
        setStatus(s);
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [active]);
  if (!status)
    return (
      <div className="sync-loading">
        {error ? (
          <>
            <p className="sync-error" role="alert">
              {error}
            </p>
            <button onClick={() => void load()}>Réessayer</button>
          </>
        ) : (
          <p role="status">Vérification de Figma et du code…</p>
        )}
      </div>
    );

  const pluginOn =
    !!status.pluginSeenAt && Date.now() - status.pluginSeenAt < 15_000;
  const send = (i: SyncItem) =>
    request('component-sync/send', {
      component: i.figmaId,
      property: i.property,
      value: i.value,
    })
      .then(load)
      .catch((e) => setError(e.message));
  const code = (i: SyncItem) =>
    onAsk(
      `Ajoute la valeur « ${i.value} » à la propriété \`${i.codeProp}\` du composant ${i.component} (${i.file}), fidèle à sa variante Figma « ${i.property}=${i.value} », avec mes tokens.`,
    );
  const groups: { title: string; kinds: SyncItem['kind'][] }[] = [
    { title: 'Conflits : changés des deux côtés', kinds: ['conflict'] },
    { title: 'Nouveau dans Figma, à coder', kinds: ['figma'] },
    { title: 'Nouveau dans le code, à créer dans Figma', kinds: ['code'] },
    { title: 'Supprimé d’un côté', kinds: ['removed-figma', 'removed-code'] },
  ];

  return (
    <section className="sync" aria-label="Synchro composants Figma et code">
      <header>
        <strong>Variantes des composants</strong>
        <span className={pluginOn ? 'sync-on' : 'sync-off'}>
          {pluginOn
            ? `Plugin Figma ouvert (${ago(status.pluginSeenAt!)})`
            : 'Plugin Figma fermé : ouvre-le en mode automatique'}
        </span>
      </header>
      <p className="sync-meta">
        {status.snapshotAt
          ? `${status.figmaComponents} composants lus dans Figma ${ago(Date.parse(status.snapshotAt))} · ${status.matched} reliés au code · ${status.synced.length} propriétés à jour`
          : 'Aucune lecture Figma encore : ouvre le plugin.'}
        {status.git &&
          ` · Git : ${status.git.branch ?? '?'}${status.git.files.length ? `, ${status.git.files.length} fichier(s) à publier` : ''}`}
      </p>
      <p className="sync-meta">
        {status.pr ? (
          <>
            PR du projet :{' '}
            <a href={status.pr.url} target="_blank" rel="noreferrer">
              #{status.pr.number} · {status.pr.title} ↗
            </a>
          </>
        ) : (
          'Aucune Pull Request ouverte dans le projet.'
        )}
      </p>
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
      {!status.items.length && status.snapshotAt && (
        <p className="sync-ok">
          ✓ Aucun écart détecté sur les variantes prises en charge.
        </p>
      )}
      {groups.map((g) => {
        const items = status.items.filter((i) => g.kinds.includes(i.kind));
        if (!items.length) return null;
        return (
          <div key={g.title} className="sync-group">
            <h4>{g.title}</h4>
            <ul>
              {items.map((i) => (
                <li key={`${i.figmaId}-${i.property}-${i.value}-${i.kind}`}>
                  <span>
                    <b>{i.component}</b> · {i.property} = <code>{i.value}</code>
                    {i.kind === 'removed-figma' &&
                      ' : retirée de Figma, encore dans le code'}
                    {i.kind === 'removed-code' &&
                      ' : retirée du code, encore dans Figma'}
                    {i.kind === 'conflict' &&
                      ' : à trancher, garde-la dans le code ou crée-la dans Figma'}
                  </span>
                  {(i.kind === 'figma' ||
                    i.kind === 'conflict' ||
                    i.kind === 'removed-figma') && (
                    <button
                      type="button"
                      onClick={() => code(i)}
                      title="Clodo l’ajoute au code, en diff"
                    >
                      {i.kind === 'removed-figma'
                        ? 'Garder dans le code'
                        : 'Coder'}
                    </button>
                  )}
                  {(i.kind === 'code' || i.kind === 'conflict') &&
                    (i.queued ? (
                      <small>En attente du plugin…</small>
                    ) : (
                      <button
                        type="button"
                        className="studio-primary"
                        onClick={() => send(i)}
                        title="Le plugin crée la variante dans Figma"
                      >
                        Créer dans Figma
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {status.results.length > 0 && (
        <details>
          <summary>Dernières actions dans Figma</summary>
          <ul>
            {status.results.map((r) => (
              <li key={r.op.id} className={r.ok ? 'sync-ok' : 'sync-error'}>
                {r.ok ? '✓' : '✗'} {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {status.unsupported.length > 0 && (
        <details>
          <summary>
            {status.unsupported.length} propriété(s) non synchronisée(s)
          </summary>
          <ul>
            {status.unsupported.slice(0, 40).map((u) => (
              <li key={`${u.component}-${u.property}`}>
                {u.component} · {u.property} : {u.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
