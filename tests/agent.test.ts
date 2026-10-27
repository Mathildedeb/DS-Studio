import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodexAdapter,
  restrictedArgs,
  runCli,
} from '../connectors/agents/codex.js';
import { unvalidatedAdapter } from '../connectors/agents/unvalidated.js';
test('CLI réellement absent : erreur exploitable et mode manuel disponible', async () => {
  const adapter = new CodexAdapter('ds-studio-definitely-missing-cli');
  assert.equal((await adapter.status()).available, false);
  await assert.rejects(
    () =>
      runCli('ds-studio-definitely-missing-cli', [], '', {}, undefined, 500),
    /CLI Codex absent/,
  );
});
test('erreur CLI non authentifié simulée, stderr sensible jamais exposé', async () => {
  await assert.rejects(
    () =>
      runCli(
        process.execPath,
        [
          '-e',
          "process.stderr.write('FAKE_PRIVATE_AUTH_DETAIL');process.exit(1)",
        ],
        '',
      ),
    (e) =>
      /Codex indisponible/.test((e as Error).message) &&
      !(e as Error).message.includes('PRIVATE'),
  );
});
test('arrêt interrompt réellement un processus enfant', async () => {
  const c = new AbortController();
  const result = runCli(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    '',
    {},
    c.signal,
  );
  c.abort();
  await assert.rejects(() => result, /interrompue/);
});
test('timeout du processus enfant exécuté', async () => {
  await assert.rejects(
    () =>
      runCli(
        process.execPath,
        ['-e', 'setInterval(()=>{},1000)'],
        '',
        {},
        undefined,
        50,
      ),
    /Délai CLI/,
  );
});
test('Claude et Gemini indisponibles explicitement', async () => {
  for (const id of ['claude', 'gemini'] as const) {
    const a = unvalidatedAdapter(id);
    assert.equal((await a.status()).available, false);
    await assert.rejects(() => a.reply('test', {} as never), /non implémenté/);
  }
});
test('configuration restrictive ne contient aucune permission automatique', () => {
  assert(restrictedArgs.includes('--ignore-user-config'));
  assert(restrictedArgs.includes('read-only'));
  assert(restrictedArgs.includes('mcp_servers={}'));
  assert(
    !restrictedArgs.some(
      (a) => a.includes('dangerously') || a.includes('approve-for-me'),
    ),
  );
});

test('sortie UTF-8 scindée entre buffers conservée', async () => {
  const result = await runCli(
    process.execPath,
    [
      '-e',
      'process.stdout.write(Buffer.from([0xc3]));setTimeout(()=>process.stdout.write(Buffer.from([0xa9])),20)',
    ],
    '',
  );
  assert.equal(result, 'é');
});
