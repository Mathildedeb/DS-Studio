import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiSettingsSchema, openaiAsk, publicSettings } from '../connectors/agents/providers.js';

test('source d’IA : réglages validés, clé jamais renvoyée au navigateur', () => {
  const s = aiSettingsSchema.parse({ kind: 'anthropic', key: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234' });
  assert.equal(s.kind === 'anthropic' && s.model, 'claude-opus-5-5');
  const shown = publicSettings(s);
  assert.equal(JSON.stringify(shown).includes('abcdefghijklmnop'), false);
  assert.equal(shown.keyHint, '…1234');
  assert.throws(() => aiSettingsSchema.parse({ kind: 'openai', baseUrl: 'file:///etc', model: 'x' }));
  assert.deepEqual(publicSettings({ kind: 'claude-code' }), { kind: 'claude-code' });
});

test('serveur compatible OpenAI : réponse lue, erreurs en clair', async () => {
  const calls: { url: string; auth?: string; body: { model: string; messages: { role: string }[] } }[] = [];
  const reply = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      auth: (init?.headers as Record<string, string>)?.Authorization,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(body), { status });
  };
  const ok = openaiAsk('http://localhost:11434/v1/', 'llama3', undefined, reply(200, { choices: [{ message: { content: 'OK' } }] }) as typeof fetch);
  assert.equal(await ok('système', 'question'), 'OK');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[0].auth, undefined);
  assert.deepEqual(calls[0].body.messages.map((m) => m.role), ['system', 'user']);
  const keyed = openaiAsk('https://api.example.com/v1', 'm', 'secret', reply(401, { error: 'nope' }) as typeof fetch);
  await assert.rejects(keyed('s', 'q'), /refuse la clé/);
  assert.equal(calls[1].auth, 'Bearer secret');
  const down = openaiAsk('http://localhost:9/v1', 'm', undefined, (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch);
  await assert.rejects(down('s', 'q'), /injoignable/);
});

test('clé Anthropic refusée : message clair, sans appel réseau réel', async () => {
  const { anthropicAsk } = await import('../connectors/agents/providers.js');
  const refused = (async () =>
    new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  await assert.rejects(anthropicAsk('sk-ant-faux', 'claude-opus-5-5', refused)('s', 'q'), /Clé Anthropic refusée/);
});
