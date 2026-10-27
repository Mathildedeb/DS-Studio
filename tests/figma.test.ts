import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FigmaReader, figmaFileKey } from '../connectors/figma/reader.js';

const url = 'https://www.figma.com/design/KpumlnYQdqqk0j0Q0GxPmA/Untitled';
const token = 'figd_FAUX_JETON_DE_TEST';
const reply = (status: number, body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('Figma : clé de fichier extraite des seuls liens www.figma.com', () => {
  assert.equal(figmaFileKey(url), 'KpumlnYQdqqk0j0Q0GxPmA');
  assert.equal(figmaFileKey(url + '?node-id=0-1'), 'KpumlnYQdqqk0j0Q0GxPmA');
  assert.equal(
    figmaFileKey('https://evil.invalid/design/KpumlnYQdqqk0j0Q0GxPmA'),
    undefined,
  );
  assert.equal(figmaFileKey(undefined), undefined);
});
test('Figma : sans jeton ni lien, aucun appel réseau', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response('{}');
  }) as unknown as typeof fetch;
  assert.equal(
    (await new FigmaReader(undefined, fetcher).status(url)).connected,
    false,
  );
  assert.match(
    (await new FigmaReader(token, fetcher).status(undefined)).label,
    /lien du fichier/,
  );
  assert.equal(calls, 0);
});
test('Figma : lecture seule réussie, jeton envoyé en en-tête et jamais renvoyé', async () => {
  let sent: RequestInit | undefined;
  let calls = 0;
  const fetcher = (async (_: string, init: RequestInit) => {
    calls++;
    sent = init;
    return new Response(
      JSON.stringify({
        name: 'Untitled',
        lastModified: '2026-10-27T10:00:00Z',
        document: { children: [{ name: 'Page 1' }] },
      }),
    );
  }) as unknown as typeof fetch;
  const reader = new FigmaReader(token, fetcher);
  const status = await reader.status(url);
  assert.equal(status.connected, true);
  assert.equal(status.label, 'Figma connecté · Untitled');
  assert.deepEqual(status.file?.pages, ['Page 1']);
  assert.equal(
    (sent?.headers as Record<string, string>)['X-Figma-Token'],
    token,
  );
  assert.equal(sent?.method ?? 'GET', 'GET');
  assert(!JSON.stringify(status).includes(token));
  await reader.status(url);
  assert.equal(calls, 1, 'réponse mise en cache');
});
test('Figma : refus, fichier absent et réseau coupé sans fuite de détails', async () => {
  const refused = await new FigmaReader(
    token,
    reply(403, { err: 'Invalid token DETAIL_PRIVE' }),
  ).status(url);
  assert.equal(refused.label, 'Figma : jeton refusé ou expiré');
  assert(!JSON.stringify(refused).includes('DETAIL_PRIVE'));
  assert.match(
    (await new FigmaReader(token, reply(404, {})).status(url)).label,
    /introuvable/,
  );
  const offline = (async () => {
    throw new Error('ENOTFOUND api.figma.com');
  }) as unknown as typeof fetch;
  const down = await new FigmaReader(token, offline).status(url);
  assert.equal(down.connected, false);
  assert.match(down.label, /mode local continue/);
});
