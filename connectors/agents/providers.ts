import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Ask } from './coder.js';

// D'où vient l'IA de Clodo, sur cet ordinateur : Claude Code (le compte de la
// personne, par défaut), sa propre clé Anthropic, ou son propre serveur
// compatible OpenAI (OpenAI, Mistral, modèle local…). Le réglage reste dans
// le dossier de données de DS-Studio ; la clé n'est jamais renvoyée au
// navigateur ni écrite dans un journal.
export const defaultModel = 'claude-opus-5-5';
export const aiSettingsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claude-code') }).strict(),
  z
    .object({
      kind: z.literal('anthropic'),
      key: z.string().trim().min(20).max(400),
      model: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{2,79}$/).default(defaultModel),
    })
    .strict(),
  z
    .object({
      kind: z.literal('openai'),
      baseUrl: z.string().trim().url().max(300).regex(/^https?:\/\//),
      key: z.string().trim().max(400).optional(),
      model: z.string().trim().min(1).max(120),
    })
    .strict(),
]);
export type AiSettings = z.infer<typeof aiSettingsSchema>;

// Ce que le navigateur voit : jamais la clé, seulement ses 4 derniers signes.
export const publicSettings = (s: AiSettings) => ({
  kind: s.kind,
  ...(s.kind !== 'claude-code' ? { model: s.model } : {}),
  ...(s.kind === 'openai' ? { baseUrl: s.baseUrl } : {}),
  ...(s.kind !== 'claude-code' && s.key ? { keyHint: `…${s.key.slice(-4)}` } : {}),
});

// Clé Anthropic, par le SDK officiel : réponse en flux (les réponses de
// code sont longues), et repli automatique sur un autre modèle si celui-ci
// décline la demande.
export function anthropicAsk(key: string, model: string, fetcher?: typeof fetch): Ask {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, ...(fetcher ? { fetch: fetcher } : {}) });
  return async (system, input, signal, timeout = 120_000) => {
    try {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          system,
          messages: [{ role: 'user', content: input }],
          output_config: { effort: 'high' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal, timeout },
      );
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal')
        throw new Error('Claude a décliné cette demande. Reformule-la, ou découpe-la.');
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      if (message.stop_reason === 'max_tokens')
        throw new Error('Réponse coupée avant la fin : demande trop longue pour une seule fois.');
      return text;
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof Anthropic.AuthenticationError)
        throw new Error('Clé Anthropic refusée : vérifie-la dans « Connecte ton IA ».');
      if (e instanceof Anthropic.PermissionDeniedError)
        throw new Error('Cette clé Anthropic n’a pas accès à ce modèle.');
      if (e instanceof Anthropic.NotFoundError)
        throw new Error(`Modèle « ${model} » introuvable chez Anthropic.`);
      if (e instanceof Anthropic.RateLimitError)
        throw new Error('Limite d’utilisation Anthropic atteinte : réessaie dans un moment.');
      if (e instanceof Anthropic.APIConnectionError)
        throw new Error('API Anthropic injoignable : vérifie ta connexion Internet.');
      if (e instanceof Anthropic.APIError)
        throw new Error(`Erreur de l’API Anthropic (${e.status ?? '?'}).`);
      throw e;
    }
  };
}

// Serveur compatible OpenAI (/chat/completions) : OpenAI, Mistral, LM Studio,
// Ollama, ou le serveur de la personne.
export function openaiAsk(
  baseUrl: string,
  model: string,
  key?: string,
  fetcher: typeof fetch = fetch,
): Ask {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return async (system, input, signal, timeout = 120_000) => {
    const limit = AbortSignal.timeout(timeout);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: input },
          ],
        }),
        signal: signal ? AbortSignal.any([signal, limit]) : limit,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (limit.aborted) throw new Error('Ton serveur d’IA n’a pas répondu à temps.');
      throw new Error(`Serveur d’IA injoignable (${new URL(url).host}) : est-il lancé ?`);
    }
    // Le corps des erreurs n'est jamais renvoyé tel quel : un message rédigé ici.
    if (response.status === 401 || response.status === 403)
      throw new Error('Ton serveur d’IA refuse la clé.');
    if (response.status === 404)
      throw new Error('Adresse ou modèle introuvable sur ton serveur d’IA.');
    if (response.status === 429) throw new Error('Ton serveur d’IA limite les demandes : réessaie plus tard.');
    if (!response.ok) throw new Error(`Ton serveur d’IA a répondu par une erreur (${response.status}).`);
    const body = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: unknown } }[];
    } | null;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Réponse illisible de ton serveur d’IA.');
    return text;
  };
}

export function askFor(settings: AiSettings, claudeCode: Ask): Ask {
  if (settings.kind === 'anthropic') return anthropicAsk(settings.key, settings.model);
  if (settings.kind === 'openai') return openaiAsk(settings.baseUrl, settings.model, settings.key);
  return claudeCode;
}
