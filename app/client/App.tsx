import { useEffect, useRef, useState } from 'react';
import { Catalogue, Scenario } from './DesignSystem.js';
import Chat, { type ChatMessage } from './Chat.js';
import CodeReview from './CodeReview.js';
import Clodo from './Clodo.js';
import type { CodeProposal } from '../server/code.js';
import Dashboard from './Dashboard.js';
import Board from './Board.js';
import type { FigmaFileStatus } from '../../connectors/figma/reader.js';
import { atelierIds, defaultAtelierLayout } from '../shared/dashboard.js';

const atelierTitles = {
  tokens: 'Tokens et composants',
  preview: 'Aperçu responsive',
};
import { useTokenDraft } from './useTokenDraft.js';
import {
  bootstrap,
  commit,
  exportTokens,
  getState,
  request,
  type Bootstrap,
} from './api.js';
import {
  contrast,
  tokenKeys,
  type Proposal,
  type State,
  type TokenKey,
} from '../shared/model.js';

const devices = [
  { label: 'Compact · 320', width: 320 },
  { label: 'Standard · 375', width: 375 },
  { label: 'Grand · 430', width: 430 },
  { label: 'Desktop · 1024', width: 1024 },
];
function useDesignState() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || !live) return;
      inFlight = true;
      try {
        const s = await getState();
        if (live) {
          setState((current) =>
            !current || s.revision >= current.revision ? s : current,
          );
          setError('');
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1200);
    const channel = new BroadcastChannel('ds-studio');
    channel.onmessage = refresh;
    return () => {
      live = false;
      clearInterval(timer);
      channel.close();
    };
  }, []);
  return { state, setState, error };
}
// Le tableau de bord est l'accueil ; #atelier ouvre l'espace de travail du DS.
// Les ancres internes de l'atelier (#ds-title…) restent dans l'atelier.
function useView() {
  const read = () =>
    location.hash === '' || location.hash === '#tableau-de-bord'
      ? 'dashboard'
      : ('atelier' as const);
  const [view, setView] = useState<'atelier' | 'dashboard'>(read);
  useEffect(() => {
    const onHash = () => {
      setView(read());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return view;
}
function announceChange() {
  const c = new BroadcastChannel('ds-studio');
  c.postMessage('updated');
  c.close();
}
export function Preview() {
  const { state, error } = useDesignState();
  const scenario =
    new URLSearchParams(location.search).get('scenario') ?? 'cards';
  return state ? (
    <Scenario tokens={state.tokens} scenario={scenario} />
  ) : (
    <p role="alert">{error || 'Chargement du scénario…'}</p>
  );
}
export default function App() {
  const { state, setState, error: stateError } = useDesignState();
  const [boot, setBoot] = useState<Bootstrap>();
  const [figma, setFigma] = useState<FigmaFileStatus>();
  const [key, setKey] = useState<TokenKey>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem('ds-studio-token-draft-v2') || 'null',
      );
      if (tokenKeys.includes(saved?.key)) return saved.key;
    } catch {
      /* Facultatif. */
    }
    return 'color.brand';
  });
  const { draft, setDraft, recovered, discard } = useTokenDraft(
    key,
    state?.tokens[key].$value,
  );
  const [search, setSearch] = useState('');
  const [agents, setAgents] = useState<Bootstrap['agents']>([]);
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [device, setDevice] = useState(1);
  const [scenario, setScenario] = useState('cards');
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatMode, setChatMode] = useState<'tokens' | 'code'>('tokens');
  const [codeProposal, setCodeProposal] = useState<CodeProposal>();
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [lastCode, setLastCode] = useState<{ id: string; files: string[] }>();
  const [clodoOpen, setClodoOpen] = useState(false);
  const view = useView();
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    bootstrap()
      .then(setBoot)
      .catch((e) => setError(e.message));
    request<FigmaFileStatus>('figma')
      .then(setFigma)
      .catch(() => undefined);
    request<{ id: string; files: string[] } | null>('code/last')
      .then((l) => setLastCode(l ?? undefined))
      .catch(() => undefined);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (clodoOpen)
      request<Bootstrap['agents']>('agents')
        .then(setAgents)
        .catch((e) => setError(e.message));
  }, [clodoOpen]);
  useEffect(() => {
    // Panneau ouvert : la page laisse la place à gauche, Échap le referme.
    document.body.classList.toggle('clodo-open', clodoOpen);
    if (!clodoOpen) return;
    document.getElementById('chat-input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]'))
        setClodoOpen(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [clodoOpen]);
  const current = state?.tokens[key].$value;

  useEffect(() => {
    if (proposal) {
      dialog.current?.showModal();
      cancelButton.current?.focus();
    } else dialog.current?.close();
  }, [proposal]);
  const clearError = () => {
    setError('');
    setNotice('');
  };
  async function perform(action: () => Promise<void>) {
    clearError();
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function proposeToken() {
    if (!state) return;
    await perform(async () => {
      const token = state.tokens[key];
      const value = token.$type === 'dimension' ? Number(draft) : draft;
      setProposal(
        await request<Proposal>('proposals', {
          revision: state.revision,
          changes: [{ key, value }],
        }),
      );
    });
  }
  async function accept() {
    if (!proposal) return;
    setSaving(true);
    await perform(async () => {
      const next = await commit(proposal);
      try {
        sessionStorage.removeItem('ds-studio-token-draft-v2');
      } catch {
        /* Facultatif. */
      }
      setState(next);
      setProposal(undefined);
      announceChange();
      setNotice(`Révision ${next.revision} enregistrée sur disque.`);
    });
    setSaving(false);
  }
  async function sendMessage(agentId: string) {
    if (!state || !message.trim() || thinking) return;
    const text = message;
    setMessage('');
    setThinking(true);
    clearError();
    const previous = chat.slice(-10);
    setChat([...chat, { role: 'user', text }]);
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (chatMode === 'code') {
        const coded = await request<{
          message: string;
          proposal: CodeProposal | null;
        }>('code', { message: text, history: previous }, abort.signal);
        setChat((c) => [...c, { role: 'assistant', text: coded.message }]);
        if (coded.proposal) {
          setCodeError('');
          setCodeProposal(coded.proposal);
        }
        return;
      }
      const result = await request<{
        message: string;
        proposal: Proposal | null;
      }>(
        'agent',
        {
          agent: agentId,
          message: text,
          revision: state.revision,
          history: previous,
        },
        abort.signal,
      );
      setChat((c) => [...c, { role: 'assistant', text: result.message }]);
      if (result.proposal) setProposal(result.proposal);
    } catch (e) {
      setError(
        abort.signal.aborted
          ? 'Demande interrompue. Aucun changement accepté.'
          : (e as Error).message,
      );
    } finally {
      setThinking(false);
      controller.current = null;
    }
  }
  if (!state)
    return (
      <main className="loading">
        <h1>DS-Studio</h1>
        <p role="alert">{stateError || 'Ouverture du Design System…'}</p>
        <p>Lancez le serveur local puis rechargez cette page.</p>
      </main>
    );
  const chatBox = (agentId: string, onClose?: () => void) => {
    const status = agents.find((a) => a.id === agentId);
    return (
      <Chat
        agentName={agentId === 'claude' ? 'Clodo' : 'Codex'}
        detail={status?.detail ?? 'Détection du CLI…'}
        chat={chat}
        message={message}
        onMessage={setMessage}
        thinking={thinking}
        available={!!status?.available}
        onSend={() => void sendMessage(agentId)}
        onStop={() => controller.current?.abort()}
        mode={chatMode}
        onMode={setChatMode}
        lastCode={lastCode}
        onClose={onClose}
        onRevert={() =>
          void perform(async () => {
            if (!lastCode) return;
            await request('code/revert', { id: lastCode.id });
            setNotice(`Modification annulée : ${lastCode.files.join(', ')}.`);
            setLastCode(undefined);
          })
        }
      />
    );
  };
  const staleProposal = !!proposal && proposal.revision !== state.revision;
  const draftContrast =
    /^#[0-9a-fA-F]{6}$/.test(draft) &&
    (key === 'color.brand' || key === 'color.onBrand')
      ? contrast(
          key === 'color.brand' ? draft : state.tokens['color.brand'].$value,
          key === 'color.onBrand'
            ? draft
            : state.tokens['color.onBrand'].$value,
        )
      : undefined;
  const matchingKeys = tokenKeys.filter((k) =>
    k.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const feedback = (
    <div className="feedback" aria-live="polite">
      {(error || stateError) && (
        <p className="error" role="alert">
          {error || stateError}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
  const history = (
    <>
      {historyOpen && (
        <section className="history" aria-label="Historique des changements">
          <h2>Un historique, pas un écrasement.</h2>
          <p>
            Annulez un changement précis. Les autres tokens restent intacts. Une
            annulation s’enregistre elle aussi.
          </p>
          {!state.history.length && <p>Aucun changement enregistré.</p>}
          <ol>
            {[...state.history].reverse().map((event) => (
              <li key={event.id}>
                <div>
                  <strong>Révision {event.revision}</strong> · {event.source} ·{' '}
                  <time>{new Date(event.date).toLocaleString('fr-FR')}</time>
                  <p>{event.patches.map((p) => p.key).join(', ')}</p>
                </div>
                <button
                  onClick={() =>
                    void perform(async () =>
                      setProposal(
                        await request('undo', {
                          revision: state.revision,
                          id: event.id,
                        }),
                      ),
                    )
                  }
                >
                  Annuler la révision {event.revision}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
  return (
    <>
      {view === 'atelier' && (
        <a className="skip-link" href="#ds-title">
          Aller aux tokens
        </a>
      )}
      <header className="studio-header">
        <div className="wordmark">
          <span className="brand-symbol">ds.</span>
          <div>
            <strong>DS-Studio</strong>
            <span>Votre atelier de Design System</span>
          </div>
        </div>
        <nav className="view-nav" aria-label="Vues">
          <a
            href="#tableau-de-bord"
            aria-current={view === 'dashboard' ? 'page' : undefined}
          >
            Tableau de bord
          </a>
          <a
            href="#atelier"
            aria-current={view === 'atelier' ? 'page' : undefined}
          >
            Atelier
          </a>
        </nav>
        <div className="header-status">
          <span className="local-badge">● Local · V2</span>
          {figma?.file ? (
            <a
              className="figma-status connected"
              href={figma.file.url}
              target="_blank"
              rel="noreferrer"
            >
              {figma.label}
            </a>
          ) : (
            <span className="muted">
              {figma?.label ?? boot?.figma.label ?? 'Figma non connecté'}
            </span>
          )}
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            aria-expanded={historyOpen}
          >
            Historique · {state.revision}
          </button>
        </div>
      </header>
      {view === 'dashboard' ? (
        <>
          {feedback}
          {history}
          <Dashboard
            tokens={state.tokens}
            revision={state.revision}
            lastChange={state.history.at(-1)?.date}
            figma={figma}
            onError={setError}
          />
        </>
      ) : (
        <>
          <div className="intro">
            <div>
              <h1>L’atelier</h1>
            </div>
            <div className="intro-actions">
              <button onClick={() => void perform(exportTokens)}>
                Exporter les tokens
              </button>
              <label className="file-button">
                Importer un JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file)
                      void perform(async () => {
                        if (file.size > 128000)
                          throw new Error(
                            'Fichier trop volumineux (128 Ko maximum).',
                          );
                        const tokens = JSON.parse(await file.text());
                        setProposal(
                          await request('import', {
                            revision: state.revision,
                            tokens,
                          }),
                        );
                      });
                  }}
                />
              </label>
            </div>
          </div>
          {feedback}
          {history}
          <main className="studio-main">
            <Board
              name="atelier"
              label="atelier"
              ids={atelierIds}
              titles={atelierTitles}
              fallback={defaultAtelierLayout}
              onError={setError}
              render={(id) =>
                id === 'tokens' ? (
                  <section
                    className="panel ds-panel"
                    aria-labelledby="ds-title"
                  >
                    <div className="panel-heading">
                      <span className="panel-index">B</span>
                      <div>
                        <h2 id="ds-title" tabIndex={-1}>
                          Design System
                        </h2>
                        <p>Lisière · exemple fictif, sources locales</p>
                      </div>
                      <span className="revision-tag">r{state.revision}</span>
                    </div>
                    <div className="token-editor">
                      <div className="editor-title">
                        <h3>Tokens sémantiques</h3>
                        <span>{tokenKeys.length} tokens</span>
                      </div>
                      <label className="field token-search">
                        Rechercher un token
                        <input
                          type="search"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="color, space, font…"
                        />
                      </label>
                      <p className="token-hint" role="status">
                        {matchingKeys.length} résultat(s).{' '}
                        {search && 'La sélection courante reste accessible.'}
                      </p>
                      <div className="swatches">
                        {matchingKeys
                          .filter((k) => k.startsWith('color.'))
                          .map((k) => (
                            <button
                              title={k}
                              aria-label={`Sélectionner ${k}`}
                              aria-pressed={key === k}
                              key={k}
                              style={{
                                background: String(state.tokens[k].$value),
                              }}
                              onClick={() => setKey(k)}
                            >
                              <span className="sr-only">{k}</span>
                            </button>
                          ))}
                      </div>
                      <form
                        className="token-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void proposeToken();
                        }}
                      >
                        <label className="field">
                          Token
                          <select
                            value={key}
                            onChange={(e) => setKey(e.target.value as TokenKey)}
                          >
                            {[...new Set([key, ...matchingKeys])].map((k) => (
                              <option key={k}>{k}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          Valeur
                          {state.tokens[key].$type === 'fontFamily' ? (
                            <select
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                            >
                              {['system-ui', 'Arial', 'Georgia', 'Verdana'].map(
                                (f) => (
                                  <option key={f}>{f}</option>
                                ),
                              )}
                            </select>
                          ) : (
                            <input
                              aria-label="Valeur du token"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              required
                              type={
                                state.tokens[key].$type === 'dimension'
                                  ? 'number'
                                  : 'text'
                              }
                              min={
                                state.tokens[key].$type === 'dimension'
                                  ? 0
                                  : undefined
                              }
                              max={
                                state.tokens[key].$type === 'dimension'
                                  ? 128
                                  : undefined
                              }
                              step={
                                state.tokens[key].$type === 'dimension'
                                  ? 'any'
                                  : undefined
                              }
                              maxLength={20}
                            />
                          )}
                        </label>
                        <button
                          className="studio-primary"
                          disabled={!boot || draft === String(current)}
                        >
                          Proposer
                        </button>
                      </form>
                      {state.tokens[key].$type === 'color' && (
                        <label className="color-picker">
                          Choisir visuellement
                          <input
                            aria-label="Sélecteur de couleur"
                            type="color"
                            value={
                              /^#[0-9a-fA-F]{6}$/.test(draft)
                                ? draft
                                : String(current)
                            }
                            onChange={(e) => setDraft(e.target.value)}
                          />
                        </label>
                      )}
                      {draft !== String(current) && (
                        <p className="draft-status" role="status">
                          {recovered
                            ? 'Brouillon récupéré dans cet onglet.'
                            : 'Brouillon non enregistré.'}{' '}
                          Rien n’est appliqué.
                          <button type="button" onClick={discard}>
                            Abandonner le brouillon
                          </button>
                        </p>
                      )}
                      <p className="token-hint">
                        {state.tokens[key].$type === 'color'
                          ? '#RRGGBB · '
                          : state.tokens[key].$type === 'dimension'
                            ? 'Pixels, de 0 à 128 · '
                            : ''}
                        Rien n’est écrit avant validation.
                      </p>
                      <p className="contrast" aria-live="polite">
                        Marque / texte sur marque :{' '}
                        <strong>
                          {contrast(
                            state.tokens['color.brand'].$value,
                            state.tokens['color.onBrand'].$value,
                          ).toFixed(2)}
                          :1
                        </strong>{' '}
                        ·{' '}
                        {contrast(
                          state.tokens['color.brand'].$value,
                          state.tokens['color.onBrand'].$value,
                        ) >= 4.5
                          ? 'AA texte courant'
                          : 'Contraste à améliorer'}
                      </p>
                      {draftContrast !== undefined &&
                        draft !== String(current) && (
                          <p className="contrast" role="status">
                            Contraste proposé :{' '}
                            <strong>{draftContrast.toFixed(2)}:1</strong> ·{' '}
                            {draftContrast >= 4.5
                              ? 'AA texte courant'
                              : 'Contraste à améliorer'}
                            . Cette indication ne certifie pas tous les états du
                            composant.
                          </p>
                        )}
                    </div>
                    <Catalogue tokens={state.tokens} />
                  </section>
                ) : (
                  <section
                    className="panel mobile-panel"
                    aria-labelledby="mobile-title"
                  >
                    <div className="panel-heading">
                      <span className="panel-index">C</span>
                      <div>
                        <h2 id="mobile-title" tabIndex={-1}>
                          Aperçu responsive
                        </h2>
                        <p>De vrais composants, à largeur réelle</p>
                      </div>
                    </div>
                    <div className="preview-controls">
                      <label className="field">
                        Viewport
                        <select
                          value={device}
                          onChange={(e) => setDevice(Number(e.target.value))}
                        >
                          {devices.map((d, i) => (
                            <option key={d.width} value={i}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Scénario
                        <select
                          value={scenario}
                          onChange={(e) => setScenario(e.target.value)}
                        >
                          <option value="cards">Découvrir</option>
                          <option value="form">Inscription</option>
                        </select>
                      </label>
                    </div>
                    <div className="viewport-scroll">
                      <iframe
                        title="Aperçu responsive"
                        src={`/?preview=1&scenario=${scenario}`}
                        width={devices[device].width}
                        height={760}
                      />
                    </div>
                    <div className="panel-foot">
                      {devices[device].width} px CSS · aucun zoom appliqué ·
                      défilez si nécessaire
                    </div>
                  </section>
                )
              }
            />
          </main>
          <footer className="studio-footer">
            <span>DS-Studio V2 · Fait pour être transformé.</span>
            <span>JSON local → validation → composants partagés</span>
          </footer>
        </>
      )}
      <Clodo open={clodoOpen} onOpen={() => setClodoOpen(true)}>
        {chatBox('claude', () => setClodoOpen(false))}
      </Clodo>
      <CodeReview
        proposal={codeProposal}
        busy={codeBusy}
        error={codeError}
        onCancel={() => setCodeProposal(undefined)}
        onApply={async () => {
          if (!codeProposal) return;
          setCodeBusy(true);
          setCodeError('');
          try {
            const applied = await request<{ id: string; files: string[] }>(
              'code/apply',
              { id: codeProposal.id },
            );
            setCodeProposal(undefined);
            setLastCode(applied);
            setNotice(`Code modifié : ${applied.files.join(', ')}.`);
          } catch (e) {
            setCodeError((e as Error).message);
          } finally {
            setCodeBusy(false);
          }
        }}
      />
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (saving) e.preventDefault();
          else setProposal(undefined);
        }}
        aria-labelledby="diff-title"
      >
        <h2 id="diff-title">Valider le changement</h2>
        <p>
          Proposition {proposal?.source} · basée sur la révision{' '}
          {proposal?.revision}. Ces valeurs seront enregistrées sur votre
          machine.
        </p>
        {staleProposal && (
          <p role="alert" className="error">
            Une autre validation a modifié le DS. Fermez ce diff et refaites
            votre proposition ; aucun écrasement n’est permis.
          </p>
        )}
        <div className="diff-scroll">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Avant</th>
                <th>Après</th>
              </tr>
            </thead>
            <tbody>
              {proposal?.patches.map((p) => (
                <tr key={p.key}>
                  <th>{p.key}</th>
                  <td>
                    <del>{p.before}</del>
                  </td>
                  <td>
                    <ins>{p.after}</ins>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            ref={cancelButton}
            onClick={() => setProposal(undefined)}
            disabled={saving}
          >
            Ne pas appliquer
          </button>
          <button
            className="studio-primary"
            onClick={() => void accept()}
            disabled={saving || staleProposal}
          >
            {saving ? 'Enregistrement…' : 'Valider et enregistrer'}
          </button>
        </div>
      </dialog>
    </>
  );
}
