import { useSyncExternalStore } from "react";

// The watchlist lives in the browser (localStorage), so there are no accounts and nothing is stored server-side.
// An entry is a docket plus the record_id the user last reviewed; record_id is stable across index rebuilds.

export interface WatchEntry {
  docket: string;
  seenRecordId: string | null;
  addedAt: string;
}

export const MAX_WATCH = 100;
const KEY = "adfinder.watchlist.v1";
const EVENT = "adfinder:watchlist";

let memory: string | null = null; // fallback when localStorage is blocked (private mode)

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}

function writeRaw(value: string): void {
  memory = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // keep the in-memory copy
  }
  window.dispatchEvent(new Event(EVENT));
}

function parse(raw: string | null): WatchEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: WatchEntry[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const e = item as Record<string, unknown>;
      if (typeof e.docket !== "string" || !e.docket) continue;
      out.push({
        docket: e.docket.slice(0, 40),
        seenRecordId: typeof e.seenRecordId === "string" ? e.seenRecordId.slice(0, 40) : null,
        addedAt: typeof e.addedAt === "string" ? e.addedAt : "",
      });
    }
    return out.slice(0, MAX_WATCH);
  } catch {
    return [];
  }
}

let cacheRaw: string | null | undefined;
let cache: WatchEntry[] = [];

/** Stable between calls while storage is unchanged, as useSyncExternalStore requires. */
export function getWatchlist(): WatchEntry[] {
  const raw = readRaw();
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = parse(raw);
  }
  return cache;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useWatchlist(): WatchEntry[] {
  return useSyncExternalStore(subscribe, getWatchlist);
}

function save(entries: WatchEntry[]): void {
  writeRaw(JSON.stringify(entries));
}

/** Returns false when the list is full. Watching an already-watched docket is a no-op that returns true. */
export function addWatch(docket: string, seenRecordId: string | null): boolean {
  const list = getWatchlist();
  if (list.some((e) => e.docket === docket)) return true;
  if (list.length >= MAX_WATCH) return false;
  save([...list, { docket, seenRecordId, addedAt: new Date().toISOString() }]);
  return true;
}

export function removeWatch(docket: string): void {
  save(getWatchlist().filter((e) => e.docket !== docket));
}

/** The user has looked at the current notice: stop flagging the notices up to it as new. */
export function markReviewed(docket: string, recordId: string | null): void {
  save(getWatchlist().map((e) => (e.docket === docket ? { ...e, seenRecordId: recordId } : e)));
}
