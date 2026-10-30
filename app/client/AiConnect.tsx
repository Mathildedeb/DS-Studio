import { useEffect, useState } from 'react';
import { request } from './api.js';

// « Connecte ton IA » : chaque personne qui récupère DS-Studio branche sa
// propre IA. Par défaut, Claude Code avec son compte ; sinon sa clé
// Anthropic, ou son propre serveur compatible OpenAI. Le réglage reste sur
// son ordinateur ; la clé n'est jamais réaffichée.
export type AiInfo = {
  kind: 'claude-code' | 'anthropic' | 'openai';
  model?: string;
  baseUrl?: string;
  keyHint?: string;
  configured: boolean;
  available: boolean;
  detail: string;
};

export default function AiConnect({ onClose, onSaved }: { onClose: () => void; onSaved: (info: AiInfo) => void }) {
  const [info, setInfo] = useState<AiInfo>();
  const [kind, setKind] = useState<AiInfo['kind']>('claude-code');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('claude-opus-5-5');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string }>();
  useEffect(() => {
    request<AiInfo>('ai')
      .then((i) => {
        setInfo(i);
        setKind(i.kind);
        if (i.model) setModel(i.model);
        if (i.baseUrl) setBaseUrl(i.baseUrl);
      })
      .catch(() => undefined);
  }, []);
  const save = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      const body =
        kind === 'claude-code'
          ? { kind }
          : kind === 'anthropic'
            ? { kind, model: model.trim() || 'claude-opus-5-5', ...(key.trim() ? { key: key.trim() } : {}) }
            : { kind, baseUrl: baseUrl.trim(), model: model.trim(), ...(key.trim() ? { key: key.trim() } : {}) };
      const saved = await request<AiInfo>('ai', body);
      setInfo(saved);
      setKey('');
      onSaved(saved);
      // Enregistré : on teste tout de suite, pour savoir si ça marche vraiment.
      setResult(await request<{ ok: boolean; detail: string }>('ai/test', {}));
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const sameKind = info?.kind === kind;
  return (
    <div className="ai-connect-backdrop" role="presentation" onClick={onClose}>
      <section
        className="ai-connect"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-connect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="ai-connect-title">Connecte ton IA</h2>
          <button type="button" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>
        <p>
          Clodo utilise <strong>ton</strong> IA, avec ton compte : rien ne passe par celui de quelqu’un
          d’autre. Ce réglage reste sur cet ordinateur.
        </p>
        {info && (
          <p className={info.available ? 'ai-ok' : 'ai-off'}>
            {info.available ? '✓' : '✗'} {info.detail}
          </p>
        )}
        <fieldset>
          <legend>Ton IA</legend>
          <label>
            <input type="radio" name="ai-kind" checked={kind === 'claude-code'} onChange={() => setKind('claude-code')} />
            <span>
              <strong>Claude Code</strong> (recommandé)
              <small>Ton compte claude.ai ou Claude, sans clé à copier.</small>
            </span>
          </label>
          <label>
            <input type="radio" name="ai-kind" checked={kind === 'anthropic'} onChange={() => setKind('anthropic')} />
            <span>
              <strong>Ma clé Anthropic</strong>
              <small>Une clé d’API de console.anthropic.com, facturée à ton compte.</small>
            </span>
          </label>
          <label>
            <input type="radio" name="ai-kind" checked={kind === 'openai'} onChange={() => setKind('openai')} />
            <span>
              <strong>Mon serveur</strong>
              <small>Un serveur compatible OpenAI : OpenAI, Mistral, LM Studio, Ollama, ou le tien.</small>
            </span>
          </label>
        </fieldset>
        {kind === 'claude-code' && (
          <ol className="ai-steps">
            <li>
              Installe Claude Code :{' '}
              <a href="https://code.claude.com/docs" target="_blank" rel="noreferrer">
                guide d’installation ↗
              </a>
              .
            </li>
            <li>
              Dans un Terminal, tape <code>claude</code>, puis <code>/login</code>, et connecte-toi avec ton compte.
            </li>
            <li>Reviens ici et clique « Enregistrer et tester ».</li>
          </ol>
        )}
        {kind !== 'claude-code' && (
          <div className="ai-fields">
            {kind === 'openai' && (
              <label>
                Adresse du serveur
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1 · http://localhost:11434/v1"
                />
              </label>
            )}
            <label>
              Modèle
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={kind === 'anthropic' ? 'claude-opus-5-5' : 'gpt-…, mistral-large-latest, llama3…'}
              />
            </label>
            <label>
              Clé{kind === 'openai' ? ' (facultative pour un serveur local)' : ''}
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={sameKind && info?.keyHint ? `Clé enregistrée ${info.keyHint} · laisser vide pour la garder` : 'Colle ta clé ici'}
              />
            </label>
            <small>La clé est gardée sur cet ordinateur, dans le dossier privé de DS-Studio, et n’est jamais réaffichée.</small>
          </div>
        )}
        {result && (
          <p className={result.ok ? 'ai-ok' : 'ai-off'} role="status">
            {result.ok ? '✓' : '✗'} {result.detail}
          </p>
        )}
        <div className="ai-actions">
          <button
            type="button"
            className="studio-primary"
            disabled={
              busy ||
              (kind === 'anthropic' && !key.trim() && !(sameKind && info?.keyHint)) ||
              (kind === 'openai' && (!baseUrl.trim() || !model.trim()))
            }
            onClick={() => void save()}
          >
            {busy ? 'Test en cours…' : 'Enregistrer et tester'}
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
