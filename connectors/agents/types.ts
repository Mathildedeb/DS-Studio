import type { AgentReply, Tokens } from '../../app/shared/model.js';
import type { Focus } from '../../app/shared/focus.js';
export interface AgentContext {
  tokens: Tokens;
  brief: string;
  rules: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  // Élément sélectionné à l'écran, si la demande vient de la page Design System.
  focus?: Focus;
}
export interface AgentAdapter {
  id: string;
  status(): Promise<{ available: boolean; detail: string }>;
  reply(
    message: string,
    context: AgentContext,
    signal?: AbortSignal,
  ): Promise<AgentReply>;
}
