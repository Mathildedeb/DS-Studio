import { useEffect, useRef, useState } from 'react';
import type { GitStatus } from '../server/gitops.js';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };

const suggestions = [
  'Propose une couleur de marque plus chaleureuse.',
  'Resserre l’espacement de ce composant.',
  'Vérifie le contraste de mes boutons.',
];

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
  publish,
  onPublish,
  onDismissPublish,
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
  // Carte « Je publie ? » : commit + push du projet, seulement à l'accord.
  publish?: { git: GitStatus; busy: boolean; done?: string; error?: string };
  onPublish: (message: string) => void;
  onDismissPublish: () => void;
}) {
  const [commitMessage, setCommitMessage] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length, thinking]);
  return (
    <div className="chat">
      <header className="chat-head">
        <span className="chat-avatar" aria-hidden="true">
          ✳
        </span>
        <div>
          <strong>{agentName}</strong>
          <span className={`chat-status ${available ? 'on' : 'off'}`}>
            {available ? 'Disponible' : 'Indisponible'}
          </span>
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
        className="chat-log"
        ref={log}
        aria-label="Conversation"
        aria-live="polite"
      >
        {!chat.length && (
          <div className="chat-empty">
            <p>
              Demandez une modification. {agentName} choisit de changer des
              tokens ou le code, et vous validez le diff avant toute écriture.
            </p>
            <div className="chat-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onMessage(s)}
                  disabled={thinking}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((c, i) => (
          <article className={`chat-bubble ${c.role}`} key={i}>
            <span className="sr-only">
              {c.role === 'user' ? 'Vous' : agentName} :
            </span>
            <p>{c.text}</p>
          </article>
        ))}
        {thinking && (
          <p className="chat-thinking" role="status">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span className="sr-only">{agentName} réfléchit…</span>
          </p>
        )}
      </div>
      {publish && (
        <section className="chat-publish" aria-label="Publier sur Git">
          {publish.done ? (
            <p role="status">{publish.done}</p>
          ) : (
            <>
              <p>
                <strong>Je publie sur Git ?</strong> {publish.git.files.length}{' '}
                fichier(s) modifié(s)
                {publish.git.ahead > 0 && ' · commits à pousser'} ·{' '}
                {publish.git.protected
                  ? `nouvelle branche ds-studio/… (jamais ${publish.git.branch ?? 'main'})`
                  : `branche ${publish.git.branch}`}
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
                  {publish.busy ? 'Publication…' : 'Oui, commit et push'}
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
        <textarea
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
