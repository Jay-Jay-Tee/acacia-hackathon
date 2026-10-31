import type { SavedChat } from "../lib/history";

interface Props {
  chats: SavedChat[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

const when = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(ts: number): string {
  const mins = Math.round((ts - Date.now()) / 60000);
  if (mins > -1) return "just now";
  if (mins > -60) return when.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours > -24) return when.format(hours, "hour");
  return when.format(Math.round(hours / 24), "day");
}

/** Saved chats, newest first. Rendered in the desktop sidebar and in the mobile drawer. */
export function ChatHistory({ chats, activeId, onOpen, onNew, onDelete }: Props) {
  return (
    <nav aria-label="Saved chats" className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">History</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          New chat
        </button>
      </div>
      {chats.length === 0 ? (
        <p className="px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
          Your chats are saved in this browser and appear here.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {chats.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  aria-current={active ? "page" : undefined}
                  className={`w-full rounded-md py-2 pr-8 pl-2 text-left ${
                    active ? "bg-stone-200/80 dark:bg-stone-800" : "hover:bg-stone-200/50 dark:hover:bg-stone-800/60"
                  }`}
                >
                  <span className="block truncate text-sm text-stone-800 dark:text-stone-100">{c.title}</span>
                  <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                    {ago(c.updatedAt)} · {c.turns.length} {c.turns.length === 1 ? "question" : "questions"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete chat: ${c.title}`}
                  title="Delete chat"
                  className="absolute top-1.5 right-1 rounded p-1 text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-300/60 hover:text-stone-700 focus:opacity-100 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                >
                  <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-stone-200 px-3 py-2 text-[11px] text-stone-400 dark:border-stone-800">
        Saved answers are snapshots; ask again for the latest.
      </p>
    </nav>
  );
}
