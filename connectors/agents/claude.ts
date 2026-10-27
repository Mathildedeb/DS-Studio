import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentInstruction, parseAgentJson, runCli } from './codex.js';
import type { AgentAdapter, AgentContext } from './types.js';

const cli = { name: 'Claude Code', login: 'claude auth status' };
// Profil volontairement sans outils, comme Codex : aucun outil intégré, aucun MCP,
// pas de commandes slash ni de session enregistrée. Le contexte arrive par stdin.
export const restrictedArgs = [
  '-p',
  '--output-format',
  'json',
  '--tools',
  '',
  '--strict-mcp-config',
  '--setting-sources',
  '',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--system-prompt',
  agentInstruction,
];

export class ClaudeAdapter implements AgentAdapter {
  id = 'claude';
  // baseArgs sert aux tests : un faux CLI lancé par Node, identique sur les trois OS.
  constructor(
    private binary = 'claude',
    private baseArgs: string[] = [],
  ) {}
  async status() {
    try {
      const version = (
        await runCli(
          this.binary,
          [...this.baseArgs, '--version'],
          '',
          {},
          undefined,
          5000,
          cli,
        )
      ).trim();
      return {
        available: true,
        detail: `Claude Code ${version} détecté · compte et quota vérifiés lors de l'envoi. Contexte transmis au service IA.`,
      };
    } catch {
      return {
        available: false,
        detail:
          'CLI Claude Code absent ou inaccessible. Mode manuel disponible.',
      };
    }
  }
  async reply(message: string, context: AgentContext, signal?: AbortSignal) {
    const status = await this.status();
    if (!status.available) throw new Error(status.detail);
    // Dossier vide : ni CLAUDE.md ni réglages du projet ne sont chargés.
    const cwd = await mkdtemp(path.join(tmpdir(), 'ds-studio-agent-'));
    // Les identifiants ne sont ni lus ni copiés. Claude Code gère sa propre authentification.
    const names = [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'SystemRoot',
      'WINDIR',
      'COMSPEC',
      'PATHEXT',
      'TEMP',
      'TMP',
      'XDG_CONFIG_HOME',
      'CLAUDE_CONFIG_DIR',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'NO_PROXY',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
    ];
    const env = Object.fromEntries(
      names
        .filter((n) => process.env[n] !== undefined)
        .map((n) => [n, process.env[n]!]),
    );
    try {
      const raw = await runCli(
        this.binary,
        [...this.baseArgs, ...restrictedArgs],
        JSON.stringify({ context, message }),
        { cwd, env },
        signal,
        120_000,
        cli,
      );
      let result: {
        is_error?: boolean;
        subtype?: string;
        num_turns?: number;
        permission_denials?: unknown[];
        result?: string;
      };
      try {
        result = JSON.parse(raw);
      } catch {
        throw new Error('Réponse Claude Code illisible. Intégration refusée.');
      }
      if (result.is_error || result.subtype !== 'success')
        throw new Error(
          'Échec Claude Code. Vérifiez votre authentification et votre quota.',
        );
      // Sans outil, une réponse tient en un tour. Plus de tours = outil tenté.
      if ((result.num_turns ?? 1) > 1 || result.permission_denials?.length)
        throw new Error(
          'Le CLI a tenté d’utiliser un outil. Intégration refusée.',
        );
      return parseAgentJson(result.result ?? '');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
