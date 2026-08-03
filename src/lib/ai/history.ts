import type { Content } from "@google/generative-ai";

const MAX_TURNS = 10;

type ChatEntry = {
  history: Content[];
  updatedAt: number;
};

const store = new Map<string, ChatEntry>();

const TTL_MS = 60 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.updatedAt > TTL_MS) store.delete(key);
  }
}

export function getChatHistory(chatId: string): Content[] {
  prune();
  return store.get(chatId)?.history ?? [];
}

export function setChatHistory(chatId: string, history: Content[]) {
  prune();
  // Keep last N user/model turns (each turn is one Content)
  const trimmed = history.slice(-MAX_TURNS * 2);
  store.set(chatId, { history: trimmed, updatedAt: Date.now() });
}

export function clearChatHistory(chatId: string) {
  store.delete(chatId);
}
