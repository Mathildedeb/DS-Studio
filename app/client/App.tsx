import { useEffect, useRef, useState } from 'react';
import { Scenario } from './DesignSystem.js';
import {
  ComponentWorkspace,
  DsTabs,
  TokenTable,
  type Tab,
} from './AtomicPage.js';
import { focusLabel, type Focus } from '../shared/focus.js';
import { usedBy } from './dsRegistry.js';
import Chat, { type ChatMessage } from './Chat.js';
import CodeReview from './CodeReview.js';
import Clodo from './Clodo.js';
import type { CodeProposal } from '../server/code.js';
import Dashboard from './Dashboard.js';
import PreviewPage from './PreviewPage.js';
import OpenProject from './OpenProject.js';
import FigmaPanel, { figmaLevel } from './FigmaPanel.js';
import type { Level } from './dsRegistry.js';
import type { FigmaComponent } from '../../connectors/figma/library.js';
import type { ConnectionStatus } from '../shared/connection.js';
import type { PublishStatus } from '../server/gitops.js';
import { adviseChange } from '../shared/advice.js';
import type { CodeComponent } from '../shared/components.js';
import {
  circuitConclusion,
  circuitImpact,
  circuitSteps,
  type CircuitData,
} from '../shared/circuit.js';
import type { FigmaFileStatus } from '../../connectors/figma/reader.js';
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
  type TokenType,
} from '../shared/model.js';

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
// Le tableau de bord est l'accueil ; #design-system et #preview sont les deux
// pages de travail. Les ancres internes (#ds-title…) et l'ancien #atelier
// restent sur la page Design System.
type View = 'dashboard' | 'ds' | 'preview';
function useView() {
  const read = (): View =>
    location.hash === '' || location.hash === '#tableau-de-bord'
      ? 'dashboard'
      : location.hash === '#preview'
        ? 'preview'
        : 'ds';
  const [view, setView] = useState<View>(read);
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
  const params = new URLSearchParams(location.search);
  return state ? (
    <Scenario
      tokens={state.tokens}
      scenario={params.get('scenario') ?? 'cards'}
      title={params.get('title') ?? ''}
    />
  ) : (
    <p role="alert">{error || 'Chargement de la page…'}</p>
  );
}
// Ce que l'étudiante vient de valider, écrit comme une demande au chat.
// Une proposition de Clodo a déjà sa demande dans la conversation.
function describeChange(p: Proposal) {
  if (p.source === 'claude' || p.source === 'codex') return null;
  if (p.source === 'import')
    return `Importe ${p.patches.length} changement(s) de tokens.`;
  if (p.source === 'undo')
    return `Annule une révision (${p.patches.length} token(s)).`;
  const [first, ...rest] = p.patches;
  const what =
    first.after === null
      ? `Supprime ${first.key}`
      : first.before === null
        ? `Crée ${first.key} = ${first.after}`
        : `Change ${first.key} : ${first.before} → ${first.after}`;
  return rest.length
    ? `${what} (+ ${rest.length} token(s) lié(s) : ${rest
        .slice(0, 4)
        .map((r) => r.key)
        .join(', ')}${rest.length > 4 ? '…' : ''}).`
    : `${what}.`;
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
      if (typeof saved?.key === 'string') return saved.key;
    } catch {
      /* Facultatif. */
    }
    return 'color.brand';
  });
  // Token sélectionné disparu (supprimé, liste vide) : on passe au premier.
  useEffect(() => {
    if (state && !state.tokens[key] && tokenKeys(state.tokens).length)
      setKey(tokenKeys(state.tokens)[0]);
  }, [state, key]);
  const { draft, setDraft, recovered, discard } = useTokenDraft(
    key,
    state?.tokens[key]?.$value,
  );
  const [adding, setAdding] = useState(false);
  const [newToken, setNewToken] = useState<{
    key: string;
    type: TokenType;
    value: string;
  }>({ key: '', type: 'color', value: '' });
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('tokens');
  const [componentFocus, setComponentFocus] = useState<Focus>();
  const [previewFocus, setPreviewFocus] = useState<Focus>();
  const [figmaFocus, setFigmaFocus] = useState<Focus>();
  const openToken = (k: TokenKey) => {
    setKey(k);
    setTab('tokens');
  };
  const [agents, setAgents] = useState<Bootstrap['agents']>([]);
  const [proposal, setProposal] = useState<Proposal>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [codeProposal, setCodeProposal] = useState<CodeProposal>();
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [lastCode, setLastCode] = useState<{ id: string; files: string[] }>();
  // Composants déjà codés dans le projet ouvert : relus à l'ouverture du
  // projet et après chaque modification de code (création, annulation).
  const [projectCode, setProjectCode] = useState<{
    components: CodeComponent[];
    map: Record<string, string>;
  }>();
  const [clodoOpen, setClodoOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>();
  const [opening, setOpening] = useState(false);
  const [publishCard, setPublishCard] = useState<{
    git: PublishStatus;
    busy: boolean;
    done?: string;
    error?: string;
  }>();
  // Composants du Figma du projet, lus une fois pour tous les onglets du DS.
  const [figmaList, setFigmaList] = useState<FigmaComponent[]>();
  const [figmaError, setFigmaError] = useState('');
  const figmaLinked = connection?.saved.figmaUrl;
  useEffect(() => {
    setFigmaList(undefined);
    setFigmaError('');
    if (figmaLinked)
      request<FigmaComponent[]>('figma/components')
        .then(setFigmaList)
        .catch((e) => setFigmaError(e.message));
  }, [figmaLinked]);
  const askClodo = (text: string) => {
    setMessage(text);
    setClodoOpen(true);
  };
  // Tokens lisibles dans le projet ouvert, importables depuis l'onglet Tokens.
  const importProjectTokens = () =>
    void perform(async () =>
      setProposal(
        await request<Proposal>('project-tokens/import', {
          revision: state!.revision,
        }),
      ),
    );
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
    // Sans réponse, l'écran d'ouverture ne bloque pas l'atelier.
    request<ConnectionStatus>('connection')
      .then(setConnection)
      .catch(() => setConnection({ saved: { skipped: true } }));
    request<FigmaFileStatus>('figma')
      .then(setFigma)
      .catch(() => undefined);
    request<{ id: string; files: string[] } | null>('code/last')
      .then((l) => setLastCode(l ?? undefined))
      .catch(() => undefined);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!connection?.project) return setProjectCode(undefined);
    request<typeof projectCode | null>('project-components')
      .then((c) => setProjectCode(c ?? undefined))
      .catch(() => undefined);
  }, [connection?.project, lastCode]);
  // Checklist de la dernière validation : relue toutes les 2 s tant qu'elle
  // est affichée, pour passer d'elle-même de ⏳ ou ⚠️ à ✅ (plugin rouvert…).
  const [watch, setWatch] = useState<number>();
  const [circuit, setCircuit] = useState<CircuitData>();
  useEffect(() => {
    if (watch === undefined) return setCircuit(undefined);
    let live = true;
    const read = () =>
      request<CircuitData>('circuit')
        .then((c) => live && setCircuit(c))
        .catch(() => undefined);
    void read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watch]);
  // Diff ouvert : Clodo donne son avis AVANT la validation (contrastes,
  // échelle, neutres, alias), dans le diff et dans le chat ; calculé sur
  // place, sans appel à l'IA.
  const [aliases, setAliases] = useState<{
    id: string;
    links: Record<string, string>;
  }>();
  const advised = useRef<string>(undefined);
  // Un import ou une annulation reprend un état connu : pas d'avis.
  const advice =
    proposal && state && proposal.source !== 'import' && proposal.source !== 'undo'
      ? adviseChange(proposal.patches, state.tokens, aliases?.links)
      : [];
  useEffect(() => {
    if (!proposal) return;
    const id = proposal.id;
    request<Record<string, string>>('aliases')
      .catch(() => ({}))
      .then((links) => setAliases({ id, links }));
  }, [proposal]);
  // Une fois les liens connus, l'avis part une seule fois dans le chat.
  useEffect(() => {
    if (
      !proposal ||
      aliases?.id !== proposal.id ||
      advised.current === proposal.id ||
      !advice.length
    )
      return;
    advised.current = proposal.id;
    setChat((c) => [
      ...c,
      {
        role: 'assistant',
        text: `Avant de valider :\n${advice.map((a) => `${a.level === 'warn' ? '⚠' : '•'} ${a.text}`).join('\n')}`,
      },
    ]);
  });
  // Plus rien en cours : Clodo conclut dans le chat (c'est bon, ou le
  // problème et sa solution), une fois par issue ; aucun appel au CLI.
  const concluded = useRef<string>(undefined);
  useEffect(() => {
    if (watch === undefined || !circuit) return;
    const end = circuitConclusion(
      circuitSteps(circuit, watch),
      circuitImpact(circuit, watch),
    );
    if (!end || concluded.current === `${watch}:${end.key}`) return;
    concluded.current = `${watch}:${end.key}`;
    setChat((c) => [...c, { role: 'assistant', text: end.text }]);
  }, [circuit, watch]);
  // Import envoyé par le plugin Figma (« Récupérer depuis Figma ») : son diff
  // s'ouvre ici et Clodo l'annonce ; rien n'est écrit avant « Valider ».
  const seenImport = useRef<string>(undefined);
  useEffect(() => {
    if (!connection?.project) return;
    const timer = setInterval(async () => {
      const pending = await request<{
        proposal: Proposal;
        file: string | null;
        skipped: { name: string; reason: string }[];
      } | null>('figma-import').catch(() => null);
      if (!pending || pending.proposal.id === seenImport.current) return;
      seenImport.current = pending.proposal.id;
      const skipped = pending.skipped.length
        ? ` ${pending.skipped.length} variable(s) non reprise(s) : ${pending.skipped
            .slice(0, 5)
            .map((s) => `${s.name} (${s.reason})`)
            .join(', ')}${pending.skipped.length > 5 ? '…' : ''}.`
        : '';
      setProposal(pending.proposal);
      setChat((c) => [
        ...c,
        {
          role: 'assistant',
          text: `Figma${pending.file ? ` (${pending.file})` : ''} : ${pending.proposal.patches.length} changement(s) récupéré(s). Vérifie le diff avant de valider.${skipped}`,
        },
      ]);
      setClodoOpen(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [connection?.project]);
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
  const current = state?.tokens[key]?.$value;

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
    const token = state?.tokens[key];
    if (!state || !token) return;
    await perform(async () => {
      const value = token.$type === 'dimension' ? Number(draft) : draft;
      setProposal(
        await request<Proposal>('proposals', {
          revision: state.revision,
          changes: [{ key, value }],
        }),
      );
    });
  }
  // Ajout et suppression passent par le même diff que les modifications.
  async function addToken() {
    if (!state) return;
    await perform(async () => {
      const { key: name, type, value } = newToken;
      setProposal(
        await request<Proposal>('proposals', {
          revision: state.revision,
          changes: [
            {
              key: name.trim(),
              type,
              value: type === 'dimension' ? Number(value) : value.trim(),
            },
          ],
        }),
      );
      setNewToken({ key: '', type, value: '' });
      setAdding(false);
    });
  }
  async function removeToken() {
    if (!state?.tokens[key]) return;
    await perform(async () =>
      setProposal(
        await request<Proposal>('proposals', {
          revision: state.revision,
          changes: [{ key, value: null }],
        }),
      ),
    );
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
      // Un token créé est sélectionné seulement une fois enregistré.
      const added = proposal.patches.find((p) => p.before === null);
      if (added) setKey(added.key);
      setProposal(undefined);
      announceChange();
      setNotice(`Révision ${next.revision} enregistrée sur disque.`);
      setWatch(next.revision);
      // La validation se lit comme une conversation : ce qui a été demandé,
      // puis Clodo qui suit chaque étape (checklist en direct).
      const asked = describeChange(proposal);
      setChat((c) => [
        ...c,
        ...(asked ? [{ role: 'user' as const, text: asked }] : []),
        {
          role: 'assistant' as const,
          text: 'C’est validé. Je mets tout à jour :',
          circuit: next.revision,
        },
      ]);
      setClodoOpen(true);
      void offerPublish();
    });
    setSaving(false);
  }
  // Ce que regarde l'étudiante dans la page Design System, envoyé au chat.
  const focus: Focus | undefined =
    view === 'preview'
      ? previewFocus
      : view === 'ds' && tab === 'figma'
        ? figmaFocus
        : view !== 'ds' || !state
          ? undefined
          : tab === 'tokens'
            ? state.tokens[key] && {
                page: 'design-system',
                kind: 'token',
                name: key,
                path: [key],
                value: state.tokens[key].$value,
                tokens: [key],
              }
            : componentFocus;
  // Après une modification (ou « push » dans le chat) : rien ne part avant
  // git.batch modifications validées ; alors Clodo demande l'accord avant de
  // créer une nouvelle branche de travail et de la pousser.
  async function offerPublish(asked = false) {
    if (!connection?.project) return;
    try {
      const git = await request<PublishStatus>('git/status');
      if (git.pending < git.batch) {
        const left = `${git.pending}/${git.batch} modifications validées avant de publier sur Git.`;
        if (asked)
          setChat((c) => [
            ...c,
            {
              role: 'assistant',
              text: `Pas encore : ${left} Je te proposerai la publication à ${git.batch}.`,
            },
          ]);
        else setNotice((n) => (n ? `${n} ${left}` : left));
        return;
      }
      if (!git.files.length && !git.ahead) {
        setChat((c) => [
          ...c,
          {
            role: 'assistant',
            text: 'Rien à publier : ton projet est à jour.',
          },
        ]);
        return;
      }
      setPublishCard({ git, busy: false });
      setChat((c) => [
        ...c,
        {
          role: 'assistant',
          text: `${git.pending} modifications validées : je crée une nouvelle branche design/… et je la pousse sur Git ?`,
        },
      ]);
      setClodoOpen(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function confirmPublish(commitMessage: string) {
    setPublishCard((p) => p && { ...p, busy: true, error: undefined });
    try {
      const done = await request<{
        branch: string;
        commit: string;
        pushed: boolean;
      }>('git/publish', { message: commitMessage });
      const text = done.pushed
        ? `Publié : commit ${done.commit} poussé sur la branche ${done.branch}.`
        : `Commit ${done.commit} fait sur ${done.branch} (pas de dépôt distant).`;
      setPublishCard((p) => p && { ...p, busy: false, done: text });
      setChat((c) => [...c, { role: 'assistant', text }]);
      setConnection(await request<ConnectionStatus>('connection'));
    } catch (e) {
      setPublishCard(
        (p) => p && { ...p, busy: false, error: (e as Error).message },
      );
    }
  }
  async function sendMessage() {
    if (!state || !message.trim() || thinking) return;
    const text = message;
    // « push », « publie » : pas besoin de Clodo, on montre ce qui partira.
    if (
      /^\s*(push|pousse|publie|publish)\b/i.test(text) &&
      connection?.project
    ) {
      setMessage('');
      setChat((c) => [...c, { role: 'user', text }]);
      await offerPublish(true);
      return;
    }
    setMessage('');
    setThinking(true);
    clearError();
    // Les checklists restent dans l'atelier : seule la conversation part.
    const previous = chat
      .filter((m) => m.circuit === undefined)
      .slice(-10)
      .map(({ role, text }) => ({ role, text }));
    setChat([...chat, { role: 'user', text }]);
    const abort = new AbortController();
    controller.current = abort;
    try {
      // Un seul chat : Clodo choisit de proposer des tokens ou du code, et
      // chaque proposition passe par son diff avant toute écriture.
      const reply = await request<{
        message: string;
        proposal: CodeProposal | null;
        tokenProposal: Proposal | null;
      }>('code', { message: text, history: previous, focus }, abort.signal);
      setChat((c) => [...c, { role: 'assistant', text: reply.message }]);
      if (reply.proposal) {
        setCodeError('');
        setCodeProposal(reply.proposal);
      }
      if (reply.tokenProposal) setProposal(reply.tokenProposal);
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
        onSend={() => void sendMessage()}
        onStop={() => controller.current?.abort()}
        onClose={onClose}
        focus={focus && focusLabel(focus)}
        lastCode={lastCode}
        publish={publishCard}
        onPublish={(m) => void confirmPublish(m)}
        onDismissPublish={() => setPublishCard(undefined)}
        circuit={
          watch !== undefined && circuit
            ? { revision: watch, steps: circuitSteps(circuit, watch) }
            : undefined
        }
        onAskFix={askClodo}
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
  const selected = state.tokens[key];
  // Le contraste marque / texte ne s'affiche que si ces deux couleurs existent.
  const colorOf = (k: string) => {
    const t = state.tokens[k];
    return t?.$type === 'color' ? t.$value : undefined;
  };
  const brand = colorOf('color.brand');
  const onBrand = colorOf('color.onBrand');
  const brandContrast = brand && onBrand ? contrast(brand, onBrand) : undefined;
  const draftContrast =
    brand &&
    onBrand &&
    /^#[0-9a-fA-F]{6}$/.test(draft) &&
    (key === 'color.brand' || key === 'color.onBrand')
      ? contrast(
          key === 'color.brand' ? draft : brand,
          key === 'color.onBrand' ? draft : onBrand,
        )
      : undefined;
  const matchingKeys = tokenKeys(state.tokens).filter((k) =>
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
  // Premier lancement : on ouvre un projet (ou on passe) avant l'atelier.
  const mustOpen =
    !!connection && !connection.saved.folder && !connection.saved.skipped;
  return (
    <>
      {view === 'ds' && (
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
            href="#design-system"
            aria-current={view === 'ds' ? 'page' : undefined}
          >
            Design System
          </a>
          <a
            href="#preview"
            aria-current={view === 'preview' ? 'page' : undefined}
          >
            Preview
          </a>
        </nav>
        <div className="header-status">
          <button
            type="button"
            className="project-badge"
            onClick={() => setOpening(true)}
            title={connection?.project?.folder ?? 'Ouvrir un projet'}
          >
            {connection?.project
              ? `${connection.project.name}${connection.project.git?.branch ? ` · ${connection.project.git.branch}` : ''}`
              : 'Ouvrir un projet'}
          </button>
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
      {mustOpen || opening ? (
        <OpenProject
          status={connection}
          onClose={mustOpen ? undefined : () => setOpening(false)}
          onDone={(next) => {
            // Autre projet : ses tokens, son historique et ses pages, à neuf.
            if (next.project?.folder !== connection?.project?.folder)
              return location.reload();
            setConnection(next);
            setOpening(false);
            request<FigmaFileStatus>('figma')
              .then(setFigma)
              .catch(() => undefined);
          }}
        />
      ) : view === 'dashboard' ? (
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
      ) : view === 'ds' ? (
        <>
          <div className="intro">
            <div>
              <h1 id="ds-title" tabIndex={-1}>
                Design System
              </h1>
              <p>
                {connection?.project?.name ?? 'Aucun projet ouvert'} · révision{' '}
                {state.revision}
              </p>
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
            <section className="panel ds-panel" aria-labelledby="ds-title">
              <DsTabs
                tab={tab}
                onTab={setTab}
                extra={(figmaList ?? []).reduce<Partial<Record<Level, number>>>(
                  (n, c) => {
                    const l = figmaLevel(c.page);
                    if (l) n[l] = (n[l] ?? 0) + 1;
                    return n;
                  },
                  {},
                )}
              />
              <div
                className="ds-workspace"
                role="tabpanel"
                id="panel-tokens"
                aria-labelledby="tab-tokens"
                hidden={tab !== 'tokens'}
              >
                <div className="ds-list">
                  <div className="editor-title">
                    <h3>Tokens sémantiques</h3>
                    <span>{tokenKeys(state.tokens).length} tokens</span>
                  </div>
                  <button
                    type="button"
                    className="token-add"
                    aria-expanded={adding}
                    onClick={() => setAdding(!adding)}
                  >
                    + Token
                  </button>
                  {adding && (
                    <form
                      className="token-new"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void addToken();
                      }}
                    >
                      <label className="field">
                        Nom du token
                        <input
                          value={newToken.key}
                          onChange={(e) =>
                            setNewToken({ ...newToken, key: e.target.value })
                          }
                          placeholder="color.brand, space.md…"
                          maxLength={60}
                          required
                        />
                      </label>
                      <label className="field">
                        Type du token
                        <select
                          value={newToken.type}
                          onChange={(e) =>
                            setNewToken({
                              ...newToken,
                              type: e.target.value as TokenType,
                            })
                          }
                        >
                          <option value="color">Couleur</option>
                          <option value="dimension">Dimension (px)</option>
                          <option value="fontFamily">Police</option>
                        </select>
                      </label>
                      <label className="field">
                        Valeur initiale
                        <input
                          value={newToken.value}
                          onChange={(e) =>
                            setNewToken({ ...newToken, value: e.target.value })
                          }
                          placeholder={
                            newToken.type === 'color'
                              ? '#RRGGBB'
                              : newToken.type === 'dimension'
                                ? '16'
                                : 'Inter, system-ui…'
                          }
                          maxLength={60}
                          required
                        />
                      </label>
                      <button className="studio-primary">
                        Proposer l’ajout
                      </button>
                    </form>
                  )}
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
                  <TokenTable
                    tokens={state.tokens}
                    keys={matchingKeys}
                    selected={key}
                    onSelect={setKey}
                  />
                </div>
                {!selected ? (
                  <div className="ds-detail token-editor">
                    <p className="ds-stage-empty">
                      Aucun token pour l’instant. Ajoutez-en avec « + Token »,
                      importez un JSON, ou demandez à Clodo.
                    </p>
                    {connection?.project && (
                      <button
                        type="button"
                        className="studio-primary"
                        onClick={importProjectTokens}
                      >
                        Importer les tokens de {connection.project.name}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="ds-detail token-editor">
                    <header className="ds-detail-head">
                      <div>
                        <h2>{key}</h2>
                        <p>
                          {selected.$type} · --{key.replaceAll('.', '-')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeToken()}
                        disabled={!boot}
                      >
                        Supprimer ce token
                      </button>
                    </header>
                    <div className="ds-stage token-sample">
                      {selected.$type === 'color' ? (
                        <span
                          className="token-sample-color"
                          style={{ background: draft }}
                        />
                      ) : selected.$type === 'dimension' ? (
                        <span
                          className="token-sample-size"
                          style={{ width: `${Number(draft) || 0}px` }}
                        />
                      ) : (
                        <span style={{ fontFamily: draft, fontSize: 28 }}>
                          Aa · Bb · 123
                        </span>
                      )}
                      <small>Aperçu du brouillon, taille réelle</small>
                    </div>
                    <p className="token-hint">
                      Utilisé par :{' '}
                      {usedBy(key).join(', ') || 'aucun composant'}
                    </p>
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
                          onChange={(e) => setKey(e.target.value)}
                        >
                          {[...new Set([key, ...matchingKeys])].map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Valeur
                        <input
                          aria-label="Valeur du token"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          required
                          type={
                            selected.$type === 'dimension' ? 'number' : 'text'
                          }
                          min={selected.$type === 'dimension' ? 0 : undefined}
                          max={
                            selected.$type === 'dimension' ? 2000 : undefined
                          }
                          step={
                            selected.$type === 'dimension' ? 'any' : undefined
                          }
                          maxLength={60}
                        />
                      </label>
                      <button
                        className="studio-primary"
                        disabled={!boot || draft === String(current)}
                      >
                        Proposer
                      </button>
                    </form>
                    {selected.$type === 'color' && (
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
                      {selected.$type === 'color'
                        ? '#RRGGBB · '
                        : selected.$type === 'dimension'
                          ? 'Pixels, de 0 à 2000 · '
                          : 'Nom de police · '}
                      Rien n’est écrit avant validation.
                    </p>
                    {brandContrast !== undefined && (
                      <p className="contrast" aria-live="polite">
                        Marque / texte sur marque :{' '}
                        <strong>{brandContrast.toFixed(2)}:1</strong> ·{' '}
                        {brandContrast >= 4.5
                          ? 'AA texte courant'
                          : 'Contraste à améliorer'}
                      </p>
                    )}
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
                )}
              </div>
              <ComponentWorkspace
                tokens={state.tokens}
                tab={tab}
                onTab={setTab}
                onToken={openToken}
                onFocus={setComponentFocus}
                figma={figmaList}
                code={projectCode}
                onAsk={askClodo}
              />
              <FigmaPanel
                active={tab === 'figma'}
                revision={state.revision}
                onProposal={setProposal}
                onFocus={setFigmaFocus}
                onAsk={askClodo}
                list={figmaList}
                error={figmaError}
              />
            </section>
          </main>
        </>
      ) : (
        <>
          <div className="intro">
            <div>
              <h1 id="preview-title" tabIndex={-1}>
                Preview
              </h1>
              <p>De vrais composants, à largeur réelle</p>
            </div>
          </div>
          {feedback}
          {history}
          <main className="studio-main">
            <PreviewPage
              project={connection?.project}
              onError={setError}
              onFocus={setPreviewFocus}
              code={projectCode}
              onAsk={askClodo}
              onCodeProposal={setCodeProposal}
            />
          </main>
        </>
      )}
      {view !== 'dashboard' && (
        <footer className="studio-footer">
          <span>DS-Studio V2 · Fait pour être transformé.</span>
          <span>JSON local → validation → composants partagés</span>
        </footer>
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
            void offerPublish();
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
        {advice.length > 0 && (
          <section className="diff-advice" aria-label="Avis de Clodo avant de valider">
            <strong>Avant de valider, l’avis de Clodo</strong>
            <ul>
              {advice.map((a) => (
                <li key={a.text} className={`advice-${a.level}`}>
                  {a.text}
                </li>
              ))}
            </ul>
          </section>
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
                    {p.before === null ? (
                      <span className="diff-none">absent</span>
                    ) : (
                      <del>{p.before}</del>
                    )}
                  </td>
                  <td>
                    {p.after === null ? (
                      <span className="diff-none">supprimé</span>
                    ) : (
                      <ins>{p.after}</ins>
                    )}
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
