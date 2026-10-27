import { useEffect, useRef } from 'react';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };

const suggestions = {
  tokens: [
    'Propose une couleur de marque plus chaleureuse.',
    'Vérifie le contraste de mes boutons.',
    'Quels tokens revoir pour les écrans coach ?',
  ],
  code: [
    'Ajoute un widget « Notes » au tableau de bord.',
    'Arrondis davantage les cartes du tableau de bord.',
    'Ajoute une tâche « Icônes » à la checklist par défaut.',
  ],
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
  mode,
  onMode,
  lastCode,
  onRevert,
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
  mode: 'tokens' | 'code';
  onMode: (mode: 'tokens' | 'code') => void;
  lastCode?: { id: string; files: string[] };
  onRevert: () => void;
}) {
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
        <div
          className="chat-mode"
          role="group"
          aria-label="Ce que Clodo propose"
        >
          {(['tokens', 'code'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              disabled={thinking}
            >
              {m === 'tokens' ? 'Tokens' : 'Code'}
            </button>
          ))}
        </div>
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
              {mode === 'code'
                ? `Demandez une modification de l’atelier. ${agentName} propose le code, vous validez le diff avant toute écriture.`
                : `Posez une question sur votre Design System. ${agentName} propose, vous validez chaque changement dans le diff.`}
            </p>
            <div className="chat-suggestions">
              {suggestions[mode].map((s) => (
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
      {lastCode && (
        <p className="chat-applied">
          Code modifié : {lastCode.files.join(', ')}
          <button type="button" onClick={onRevert} disabled={thinking}>
            Annuler cette modification
          </button>
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
          placeholder={
            mode === 'code'
              ? `Décrire une modification pour ${agentName}…`
              : `Écrire à ${agentName}…`
          }
          disabled={thinking}
        />
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
          Tokens, workspace/PFE.md, brief privé, roadmap, DESIGN_RULES.md et 10
          messages récents. Aucun outil ni commande ; propositions seulement.
        </p>
      </details>
    </div>
  );
}
