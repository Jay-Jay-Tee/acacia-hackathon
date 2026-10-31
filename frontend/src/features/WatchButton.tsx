import { useState } from "react";
import { addWatch, MAX_WATCH, removeWatch, useWatchlist } from "./watchlistStore";

// Toggle for a document card. Watching records the notice the user is looking at now as "reviewed";
// anything newer in the docket is flagged in the watchlist panel.

export interface WatchButtonProps {
  docket: string;
  /** record_id of the notice currently shown (the current version), so only later notices count as new. */
  recordId?: string | null;
}

export function WatchButton({ docket, recordId }: WatchButtonProps) {
  const watched = useWatchlist().some((e) => e.docket === docket);
  const [full, setFull] = useState(false);

  function toggle() {
    if (watched) return removeWatch(docket);
    setFull(!addWatch(docket, recordId ?? null));
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-pressed={watched}
        onClick={toggle}
        className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800"
      >
        {watched ? "Watching ✓" : "Watch docket"}
      </button>
      {full && <span role="status" className="text-xs text-amber-800 dark:text-amber-300">Watchlist is full ({MAX_WATCH}).</span>}
    </span>
  );
}
