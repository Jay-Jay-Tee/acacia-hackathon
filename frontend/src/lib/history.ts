import { useCallback, useEffect, useState } from "react";
import type { Turn } from "../components/Thread";

/** A saved conversation. Answers are stored as they were returned, so reopening a chat shows the same
 * cited answers without new API calls. Kept in this browser only (localStorage). */
export interface SavedChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
}

const KEY = "adf.chats.v1";
const MAX_CHATS = 30;
const TITLE_MAX = 60;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function titleFrom(query: string): string {
  const t = query.replace(/\s+/g, " ").trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t || "Untitled chat";
}

function load(): SavedChat[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c) => c && typeof c.id === "string" && Array.isArray(c.turns))
      .map((c: SavedChat) => ({
        ...c,
        // a reload during a request leaves a turn "loading" forever; offer a retry instead
        turns: c.turns.map((t) =>
          t.state === "loading" ? { ...t, state: "error" as const, error: "Interrupted before the answer arrived." } : t,
        ),
      }));
  } catch {
    return [];
  }
}

/** Save, dropping the oldest chats if the browser's storage quota is hit. Never throws. */
function save(chats: SavedChat[]) {
  let keep = [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
  while (true) {
    try {
      localStorage.setItem(KEY, JSON.stringify(keep));
      return;
    } catch {
      if (keep.length <= 1) return; // storage unavailable (private mode, quota): history just isn't kept
      keep = keep.slice(0, -1);
    }
  }
}

export function maxTurnId(chats: SavedChat[]): number {
  return chats.reduce((m, c) => c.turns.reduce((n, t) => Math.max(n, t.id), m), 0);
}

export function useChatHistory() {
  const [chats, setChats] = useState<SavedChat[]>(load);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => save(chats), [chats]);

  /** Update one chat's turns. Takes the chat id so an answer that arrives after the user switched chats
   * still lands in the chat that asked it. */
  const updateTurns = useCallback((chatId: string, fn: (turns: Turn[]) => Turn[]) => {
    setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, turns: fn(c.turns), updatedAt: Date.now() } : c)));
  }, []);

  const startChat = useCallback((firstQuery: string): string => {
    const now = Date.now();
    const chat: SavedChat = { id: newId(), title: titleFrom(firstQuery), createdAt: now, updatedAt: now, turns: [] };
    setChats((cs) => [chat, ...cs]);
    setActiveId(chat.id);
    return chat.id;
  }, []);

  const remove = useCallback((id: string) => {
    setChats((cs) => cs.filter((c) => c.id !== id));
    setActiveId((a) => (a === id ? null : a));
  }, []);

  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const active = chats.find((c) => c.id === activeId) ?? null;
  return { chats: sorted, active, activeId, open: setActiveId, newChat: () => setActiveId(null), startChat, updateTurns, remove };
}
