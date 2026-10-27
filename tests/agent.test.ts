import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodexAdapter,
  restrictedArgs,
  runCli,
} from '../connectors/agents/codex.js';
import { unvalidatedAdapter } from '../connectors/agents/unvalidated.js';
import {
  ClaudeAdapter,
  restrictedArgs as claudeArgs,
} from '../connectors/agents/claude.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
test('Gemini indisponible explicitement', async () => {
  const a = unvalidatedAdapter('gemini');
  assert.equal((await a.status()).available, false);
  await assert.rejects(() => a.reply('test', {} as never), /non implémenté/);
});
// Faux CLI Claude lancé par Node : répond à --version, sinon renvoie RESULT en JSON.
async function fakeClaude(result: object, exitCode = 0) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ds-studio-fake-claude-'));
  const script = path.join(dir, 'claude.mjs');
  await writeFile(
    script,
    `if (process.argv.includes('--version')) { process.stdout.write('9.9.9 (Claude Code)'); process.exit(0); }
let input = ''; process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  JSON.parse(input);
  process.stderr.write('FAKE_PRIVATE_AUTH_DETAIL');
  process.stdout.write(${JSON.stringify(JSON.stringify(result))});
  process.exit(${exitCode});
});`,
  );
  return new ClaudeAdapter(process.execPath, [script]);
}
const claudeContext = {
  tokens: {} as never,
  brief: '',
  rules: '',
  history: [],
};
test('Claude : réponse sans outil convertie en proposition', async () => {
  const a = await fakeClaude({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    permission_denials: [],
    result:
      '```json\n{"message":"Bonjour","changes":[{"key":"color.brand","value":"#171717"}]}\n```',
  });
  assert.equal((await a.status()).available, true);
  const reply = await a.reply('test', claudeContext);
  assert.equal(reply.message, 'Bonjour');
  assert.deepEqual(reply.changes, [{ key: 'color.brand', value: '#171717' }]);
});
test('Claude : tentative d’outil refusée', async () => {
  const a = await fakeClaude({
    subtype: 'success',
    is_error: false,
    num_turns: 3,
    permission_denials: [{ tool_name: 'Bash' }],
    result: '{"message":"ok","changes":[]}',
  });
  await assert.rejects(() => a.reply('test', claudeContext), /outil/);
});
test('Claude : échec de compte sans fuite de stderr', async () => {
  const a = await fakeClaude({ is_error: true, subtype: 'error' }, 1);
  await assert.rejects(
    () => a.reply('test', claudeContext),
    (e) =>
      /Claude Code indisponible/.test((e as Error).message) &&
      !(e as Error).message.includes('PRIVATE'),
  );
});
test('Claude : CLI absent, mode manuel disponible', async () => {
  const a = new ClaudeAdapter('ds-studio-definitely-missing-cli');
  assert.equal((await a.status()).available, false);
  await assert.rejects(() => a.reply('test', claudeContext), /absent/);
});
test('Claude : profil sans outil ni MCP ni permission automatique', () => {
  const i = claudeArgs.indexOf('--tools');
  assert.equal(claudeArgs[i + 1], '');
  assert(claudeArgs.includes('--strict-mcp-config'));
  assert(!claudeArgs.includes('--mcp-config'));
  assert(
    !claudeArgs.some(
      (a) => a.includes('dangerously') || a.includes('bypassPermissions'),
    ),
  );
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
