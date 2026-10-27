import type { AgentAdapter } from './types.js';
export const unvalidatedAdapter = (id: 'claude' | 'gemini'): AgentAdapter => ({
  id,
  async status() {
    return {
      available: false,
      detail: `${id} : adaptateur non implémenté, protocole documenté mais non validé.`,
    };
  },
  async reply() {
    throw new Error(
      `${id} non implémenté. Utilisez le mode manuel ou Codex qualifié.`,
    );
  },
});
