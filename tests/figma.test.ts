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

test('Figma : composants non publiés, nœud simplifié, variables et repli sur les styles', async () => {
  const { figmaComponents, figmaNode, figmaVariables, variablesToTokens } =
    await import('../connectors/figma/library.js');
  const routes: string[] = [];
  const answer = (route: string): unknown => {
    if (route.includes('/variables/local')) return null;
    if (route.includes('/nodes?ids=1%3A2'))
      return {
        nodes: {
          '1:2': {
            document: {
              id: '1:2',
              name: 'Button',
              type: 'COMPONENT_SET',
              layoutMode: 'HORIZONTAL',
              itemSpacing: 8,
              paddingTop: 10,
              fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
              componentPropertyDefinitions: {
                variant: {
                  type: 'VARIANT',
                  defaultValue: 'primary',
                  variantOptions: ['primary', 'ghost'],
                },
              },
              children: [
                {
                  id: '1:3',
                  name: 'Label',
                  type: 'TEXT',
                  characters: 'OK',
                  style: { fontFamily: 'Inter', fontSize: 14 },
                },
              ],
            },
          },
        },
      };
    if (route.includes('/nodes?ids=9%3A1'))
      return {
        nodes: {
          '9:1': {
            document: {
              fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }],
            },
          },
        },
      };
    if (route.includes('depth=1'))
      return {
        styles: { '9:1': { name: 'Brand/Primary', styleType: 'FILL' } },
      };
    return {
      document: {
        children: [
          {
            name: 'Composants',
            children: [
              {
                id: '1:2',
                name: 'Button',
                type: 'COMPONENT_SET',
                children: [
                  { id: '1:4', type: 'COMPONENT' },
                  { id: '1:5', type: 'COMPONENT' },
                ],
              },
              { id: '2:1', name: 'Badge', type: 'COMPONENT' },
            ],
          },
        ],
      },
    };
  };
  const fetcher = (async (url: string) => {
    const route = url.replace('https://api.figma.com', '');
    routes.push(route);
    const body = answer(route);
    return body === null
      ? new Response('{}', { status: 403 })
      : new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  const reader = new FigmaReader(token, fetcher);
  const list = await figmaComponents(reader, url);
  assert.deepEqual(
    list.map((c) => [c.name, c.variants, c.page]),
    [
      ['Badge', 1, 'Composants'],
      ['Button', 2, 'Composants'],
    ],
  );
  const node = await figmaNode(reader, url, '1-2');
  assert.equal(node.layout?.gap, 8);
  assert.deepEqual(node.fills, ['#FF0000']);
  assert.deepEqual(node.props?.variant.options, ['primary', 'ghost']);
  assert.equal(node.children?.[0].text, 'OK');
  await assert.rejects(figmaNode(reader, url, '../evil'), /invalide/);
  // Sans offre Enterprise, les variables se replient sur les styles.
  const vars = await figmaVariables(reader, url);
  assert.equal(vars.source, 'styles');
  assert.deepEqual(vars.items, [
    { name: 'Brand/Primary', type: 'COLOR', value: '#0000FF' },
  ]);
  assert.deepEqual(variablesToTokens(vars.items).tokens, {
    'color.brand.primary': { $type: 'color', $value: '#0000FF' },
  });
  assert(routes.every((r) => r.startsWith('/v1/')));
});
