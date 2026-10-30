import { useEffect, useState, type SetStateAction } from 'react';
import type { ChatMessage } from './Chat.js';

type Discussion = { id: string; messages: ChatMessage[] };
type History = { project?: string; active: string; discussions: Discussion[] };
const emptyDiscussion = (): Discussion => ({
  id: crypto.randomUUID(),
  messages: [],
});
function messages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.text === 'string',
    )
    .slice(-100)
    .map(({ role, text }) => ({ role, text: text.slice(0, 10000) }));
}

export function useConversations(project?: string) {
  const [history, setHistory] = useState<History>({
    active: '',
    discussions: [],
  });
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (!project) return;
    let discussions: Discussion[] = [];
    let active = '';
    try {
      const raw = JSON.parse(
        localStorage.getItem(`ds-studio-discussions:${project}`) || 'null',
      );
      if (raw && Array.isArray(raw.discussions)) {
        const ids = new Set<string>();
        discussions = raw.discussions
          .filter(
            (d: Discussion) =>
              d &&
              typeof d.id === 'string' &&
              !ids.has(d.id) &&
              !!ids.add(d.id),
          )
          .map((d: Discussion) => ({
            id: d.id,
            messages: messages(d.messages),
          }));
        active = typeof raw.active === 'string' ? raw.active : '';
      } else {
        const legacy = messages(
          JSON.parse(
            localStorage.getItem(`ds-studio-conversation:${project}`) || '[]',
          ),
        );
        if (legacy.length)
          discussions = [{ ...emptyDiscussion(), messages: legacy }];
      }
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    if (!discussions.length) discussions = [emptyDiscussion()];
    if (!discussions.some((d) => d.id === active)) active = discussions[0].id;
    setHistory({ project, active, discussions });
  }, [project]);
  useEffect(() => {
    if (!project || history.project !== project) return;
    try {
      localStorage.setItem(
        `ds-studio-discussions:${project}`,
        JSON.stringify({
          active: history.active,
          discussions: history.discussions.map((d) => ({
            id: d.id,
            messages: messages(d.messages),
          })),
        }),
      );
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [history, project]);
  const ready = !!project && history.project === project;
  const active = ready ? history.active : '';
  const chat = ready
    ? (history.discussions.find((d) => d.id === active)?.messages ?? [])
    : [];
  const setChat = (next: SetStateAction<ChatMessage[]>) =>
    setHistory((current) => {
      if (current.project !== project) return current;
      return {
        ...current,
        discussions: current.discussions.map((d) =>
          d.id === active
            ? {
                ...d,
                messages: typeof next === 'function' ? next(d.messages) : next,
              }
            : d,
        ),
      };
    });
  const select = (id: string) =>
    setHistory((current) =>
      current.project === project &&
      current.discussions.some((d) => d.id === id)
        ? { ...current, active: id }
        : current,
    );
  const create = () =>
    setHistory((current) => {
      if (current.project !== project) return current;
      if (current.discussions.length >= 50) return current;
      const discussion = emptyDiscussion();
      return {
        ...current,
        active: discussion.id,
        discussions: [discussion, ...current.discussions],
      };
    });
  return {
    chat,
    setChat,
    ready,
    storageError,
    active,
    select,
    create,
    discussions: ready
      ? history.discussions.map((d, index) => ({
          id: d.id,
          title:
            d.messages.find((m) => m.role === 'user')?.text.slice(0, 60) ||
            `Nouveau chat ${history.discussions.length - index}`,
        }))
      : [],
  };
}
