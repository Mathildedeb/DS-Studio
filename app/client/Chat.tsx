import { useEffect, useRef, useState } from 'react';
import type { PublishStatus } from '../server/gitops.js';
import type { CircuitStep } from '../shared/circuit.js';
import { request } from './api.js';
import type { CheckItem } from '../shared/projectCheck.js';
import assistantMascot from './assets/assistant-mascot.png';
import { Card } from './components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from './components/ui/avatar';
import { Textarea } from './components/ui/textarea';

// circuit : réponse de Clodo qui suit une validation (checklist de la
// révision indiquée) ; elle reste dans l'atelier, jamais envoyée au CLI.
export type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  circuit?: number;
};
const stateText = {
  ok: 'fait',
  pending: 'en cours',
  warn: 'à corriger',
  todo: 'en attente',
};

// L'état de la conversation reste dans App ; ce composant ne fait qu'afficher.
export default function Chat({
  agentName,
  detail,
  chat,
  message,
  onMessage,
  thinking,
  available,
  onSend,
  onStop,
  onClose,
  focus,
  lastCode,
  onRevert,
  build,
  project,
  onProjectFix,
  onProjectRefresh,
  onProjectClose,
  onBuildYes,
  onBuildLater,
  publish,
  onPublish,
  onDismissPublish,
  circuit,
  onAskFix,
  onConnectAi,
}: {
  agentName: string;
  detail: string;
  chat: ChatMessage[];
  message: string;
  onMessage: (text: string) => void;
  thinking: boolean;
  available: boolean;
  onSend: () => void;
  onStop: () => void;
  onClose?: () => void;
  // Élément sélectionné dans la page Design System, envoyé avec la demande.
  focus?: string;
  // Dernière modification de code appliquée, annulable depuis la barre.
  lastCode?: { id: string; files: string[] };
  onRevert: () => void;
  // Build d'une page : checklist des étapes et la question de l'étape en cours.
  // Contrôle du projet ouvert : checklist, et pour chaque manque ce que le
  // chat peut faire (ou ce que l'utilisatrice doit faire elle-même).
  project?: {
    project: string;
    items: CheckItem[];
    busy: boolean;
    // Correction qui n'a pas abouti : la cause en clair et la suite proposée.
    note?: { text: string; fix?: CheckItem['fix'] };
  };
  onProjectFix?: (item: CheckItem) => void;
  onProjectRefresh?: () => void;
  onProjectClose?: () => void;
  build?: {
    page: string;
    route?: string | false;
    steps: { label: string; state: 'done' | 'doing' | 'todo' | 'warn' }[];
    checks?: { ok: boolean; text: string }[];
    note?: string;
    busy: boolean;
    question: string;
  };
  onBuildYes?: () => void;
  onBuildLater?: () => void;
  // Carte « Je publie ? » : commit + push du projet, seulement à l'accord.
  publish?: {
    git: PublishStatus;
    busy: boolean;
    done?: string;
    error?: string;
  };
  onPublish: (message: string) => void;
  onDismissPublish: () => void;
  // Checklist de la dernière validation : DS, code, interface, Figma, GitHub.
  circuit?: { revision: number; steps: CircuitStep[] };
  onAskFix: (text: string) => void;
  // Ouvre « Connecte ton IA » quand Clodo n'a pas d'IA disponible.
  onConnectAi?: () => void;
}) {
  const [commitMessage, setCommitMessage] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length, thinking, circuit?.steps.length]);
  return (
    <div className="chat">
      <header className="chat-head">
        <Avatar className="chat-avatar">
          <AvatarImage src={assistantMascot} alt="Mascotte de l’assistant" />
          <AvatarFallback>DS</AvatarFallback>
        </Avatar>
        <div>
          <strong>{agentName}</strong>
          <span className={`chat-status ${available ? 'on' : 'off'}`}>
            {available ? 'Disponible' : 'Indisponible'}
          </span>
          {!available && onConnectAi && (
            <button type="button" className="chat-connect-ai" onClick={onConnectAi}>
              Connecter mon IA
            </button>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="chat-close"
            onClick={onClose}
            aria-label={`Fermer ${agentName}`}
            title="Fermer (Échap)"
          >
            ×
          </button>
        )}
      </header>
      <div
        className={`chat-log${!chat.length && !thinking ? ' is-empty' : ''}`}
        ref={log}
        aria-label="Conversation"
        aria-live="polite"
      >
        {!chat.length && !thinking && (
          <p className="chat-start">Commence la discussion</p>
        )}
        {chat.map((c, i) =>
          c.circuit !== undefined ? (
            <Card className="chat-bubble assistant chat-circuit" key={i}>
              <span className="sr-only">{agentName} :</span>
              <p>{c.text}</p>
              {circuit?.revision === c.circuit ? (
                <>
                  <ul aria-label={`Suivi de la révision ${c.circuit}`}>
                    {circuit.steps.map((s) => (
                      <li key={s.id} className={`circuit-${s.state}`}>
                        <span className="circuit-icon" aria-hidden="true" />
                        <span>
                          {s.label}
                          <span className="sr-only">
                            {' '}
                            ({stateText[s.state]})
                          </span>
                          {s.detail && <small>{s.detail}</small>}
                          {s.fix && (
                            <small className="circuit-fix">{s.fix}</small>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {circuit.steps.some((s) => s.state === 'warn') && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskFix(
                          `Après la révision ${circuit.revision}, une étape n’est pas à jour : ${circuit.steps
                            .filter((s) => s.state === 'warn')
                            .map((s) => `${s.label} : ${s.detail}`)
                            .join(
                              ' ; ',
                            )}. Explique-moi et propose une solution.`,
                        )
                      }
                    >
                      Demander une solution à {agentName}
                    </button>
                  )}
                </>
              ) : (
                <p className="circuit-done">
                  Suivi passé à la modification suivante.
                </p>
              )}
            </Card>
          ) : (
            <Card className={`chat-bubble ${c.role}`} key={i}>
              <span className="sr-only">
                {c.role === 'user' ? 'Vous' : agentName} :
              </span>
              <p>{c.text}</p>
            </Card>
          ),
        )}
        {thinking && <Progress agentName={agentName} />}
      </div>
      {project && (
        <section className="chat-publish chat-build" aria-label={`Contrôle du projet ${project.project}`}>
          <p>
            <strong>Mon projet · {project.project}</strong>
          </p>
          <ol className="chat-build-steps chat-check">
            {project.items.map((i) => (
              <li key={i.id} data-state={i.state === 'ok' ? 'done' : 'doing'}>
                <span aria-hidden="true">{{ ok: '✓', warn: '⚠️', missing: '✗' }[i.state]}</span>{' '}
                <strong>{i.label}</strong> : {i.detail}
                {i.state !== 'ok' && i.fix && (
                  <div className="chat-check-fix">
                    {i.fix.kind === 'manual' ? (
                      <small>{i.fix.label}</small>
                    ) : (
                      <button type="button" disabled={project.busy} onClick={() => onProjectFix?.(i)}>
                        {i.fix.label}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {project.note && (
            <div className="chat-check-note" role="alert">
              <p>⚠️ {project.note.text}</p>
              {project.note.fix &&
                (project.note.fix.kind === 'manual' ? (
                  <small>{project.note.fix.label}</small>
                ) : (
                  <button
                    type="button"
                    disabled={project.busy}
                    onClick={() =>
                      onProjectFix?.({ id: 'note', label: 'Suite', state: 'missing', detail: '', fix: project.note!.fix })
                    }
                  >
                    {project.note.fix.label}
                  </button>
                ))}
            </div>
          )}
          <p>
            {project.items.every((i) => i.state === 'ok')
              ? 'Tout est en place : tu peux composer, coder et publier.'
              : (() => {
                  const missing = project.items.filter((i) => i.state === 'missing').length;
                  const warn = project.items.filter((i) => i.state === 'warn').length;
                  const watch = warn ? `${warn} point(s) à surveiller` : '';
                  return missing
                    ? `Il manque ${missing} chose(s)${watch ? `, et ${watch}` : ''}. Je règle ce que je peux, un bouton à la fois.`
                    : `Rien ne manque ; ${watch}.`;
                })()}
          </p>
          <div>
            <button type="button" onClick={onProjectRefresh} disabled={project.busy}>
              {project.busy ? 'Vérification…' : 'Revérifier'}
            </button>
            <button type="button" onClick={onProjectClose}>
              Fermer
            </button>
          </div>
        </section>
      )}
      {build && (
        <section
          className="chat-publish chat-build"
          aria-label={`Build de la page ${build.page}`}
        >
          <p>
            <strong>Build · {build.page}</strong>
          </p>
          <ol className="chat-build-steps">
            {build.steps.map((s) => (
              <li key={s.label} data-state={s.state}>
                <span aria-hidden="true">
                  {{ done: '✓', doing: '⏳', todo: '○', warn: '⚠️' }[s.state]}
                </span>{' '}
                {s.label}
              </li>
            ))}
          </ol>
          {build.checks && (
            <details open={build.checks.some((c) => !c.ok)}>
              <summary>
                Vérification du code : {build.checks.filter((c) => c.ok).length}
                /{build.checks.length}
              </summary>
              <ul>
                {build.checks.map((c) => (
                  <li key={c.text}>
                    {c.ok ? '✓' : '⚠️'} {c.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {build.note && <p className="error">{build.note}</p>}
          <p>{build.question}</p>
          {!build.busy && (
            <div>
              {build.question !== 'Build terminé.' && (
                <button
                  type="button"
                  className="studio-primary"
                  onClick={onBuildYes}
                >
                  {build.question.startsWith('Tu la testes')
                    ? 'Valider le test'
                    : 'Continuer cette étape'}
                </button>
              )}
              {build.question.startsWith('Tu la testes') && build.route && (
                <a
                  className="chat-build-link"
                  href={`http://localhost:5173${build.route}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ouvrir la page codée ↗
                </a>
              )}
              <button type="button" onClick={onBuildLater}>
                {build.question === 'Build terminé.' ? 'Fermer' : 'Plus tard'}
              </button>
            </div>
          )}
        </section>
      )}
      {publish && (
        <section className="chat-publish" aria-label="Publier sur Git">
          {publish.done ? (
            <p role="status">{publish.done}</p>
          ) : (
            <>
              <p>
                <strong>Je publie sur Git ?</strong> {publish.git.pending}{' '}
                modifications validées · {publish.git.files.length} fichier(s)
                {publish.git.ahead > 0 && ' · commits à pousser'} · nouvelle
                branche design/… créée depuis {publish.git.branch ?? 'main'}
              </p>
              {publish.git.files.length > 0 && (
                <details>
                  <summary>Fichiers</summary>
                  <ul>
                    {publish.git.files.slice(0, 30).map((f) => (
                      <li key={f.path}>
                        <code>{f.state}</code> {f.path}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="sr-only" htmlFor="commit-message">
                Message du commit
              </label>
              <input
                id="commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Message du commit (ex. Bouton : variante outline)"
                maxLength={200}
              />
              {publish.error && (
                <p className="error" role="alert">
                  {publish.error}
                </p>
              )}
              <div>
                <button
                  type="button"
                  className="studio-primary"
                  disabled={publish.busy}
                  onClick={() =>
                    onPublish(
                      commitMessage.trim() || 'Mise à jour depuis DS-Studio',
                    )
                  }
                >
                  {publish.busy
                    ? 'Publication…'
                    : 'Oui, créer la branche et pousser'}
                </button>
                <button
                  type="button"
                  onClick={onDismissPublish}
                  disabled={publish.busy}
                >
                  Plus tard
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {focus && (
        <p className="chat-focus" role="status">
          Sélection : <strong>{focus}</strong>
        </p>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Votre demande
        </label>
        <Textarea
          id="chat-input"
          rows={2}
          value={message}
          onChange={(e) => onMessage(e.target.value)}
          onKeyDown={(e) => {
            // Entrée envoie, Maj+Entrée va à la ligne.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          maxLength={8000}
          placeholder={`Écrire à ${agentName}…`}
          disabled={thinking}
        />
        {lastCode && !thinking && (
          <button
            type="button"
            className="chat-undo"
            onClick={onRevert}
            aria-label={`Annuler la dernière modification de code (${lastCode.files.join(', ')})`}
            title={`Annuler la dernière modification : ${lastCode.files.join(', ')}`}
          >
            ↶
          </button>
        )}
        {thinking ? (
          <button type="button" className="chat-stop" onClick={onStop}>
            Arrêter
          </button>
        ) : (
          <button
            className="chat-send"
            disabled={!message.trim() || !available}
            aria-label={`Envoyer à ${agentName}`}
            title={`Envoyer à ${agentName}`}
          >
            ↑
          </button>
        )}
      </form>
      <details className="chat-info">
        <summary>Ce qui est envoyé</summary>
        <p>{detail}</p>
        <p>
          Tokens, workspace/PFE.md, brief privé, roadmap, DESIGN_RULES.md, 10
          messages récents et l’élément sélectionné dans la page Design System.
          Aucun outil ni commande ; propositions seulement.
        </p>
      </details>
    </div>
  );
}

// Pendant que Clodo travaille : ses étapes réelles, lues sur le serveur, au
// lieu de simples points. La dernière est en cours ; le temps passe à côté.
function Progress({ agentName }: { agentName: string }) {
  const [steps, setSteps] = useState<{ at: number; text: string }[]>([]);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const read = () =>
      request<{ busy: boolean; steps: { at: number; text: string }[] }>(
        'code/progress',
      )
        .then((p) => setSteps(p.steps))
        .catch(() => undefined);
    void read();
    const timer = setInterval(() => {
      setSeconds(Math.round((Date.now() - start) / 1000));
      void read();
    }, 1500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className="chat-thinking chat-progress"
      role="status"
      aria-live="polite"
    >
      {steps.length ? (
        <ol>
          {steps.map((s, i) => (
            <li
              key={i}
              aria-current={i === steps.length - 1 ? 'step' : undefined}
            >
              <span>{i === steps.length - 1 ? '◌' : '✓'}</span> {s.text}
            </li>
          ))}
        </ol>
      ) : (
        <p>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span className="sr-only">{agentName} réfléchit…</span>
        </p>
      )}
      <small>
        {agentName} travaille depuis {seconds} s
      </small>
    </div>
  );
}
