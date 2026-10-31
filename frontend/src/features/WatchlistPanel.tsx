import { useEffect, useState, type FormEvent } from "react";
import { useSidePanel } from "../components/SidePanel";
import { getWatchStatus, type WatchStatus } from "./changesApi";
import { openRevisionTimeline } from "./openTimeline";
import { WhatChanged } from "./WhatChanged";
import { addWatch, markReviewed, removeWatch, useWatchlist } from "./watchlistStore";

// Watched dockets, kept in this browser. Each one shows the current notice and whether anything newer than the
// notice you last reviewed has appeared. Plain text only.

const btn =
  "rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800";

export function WatchlistPanel() {
  const panel = useSidePanel();
  const list = useWatchlist();
  const [status, setStatus] = useState<Record<string, WatchStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [docket, setDocket] = useState("");
  const [comparing, setComparing] = useState<string | null>(null); // docket whose comparison is open

  // refetch when the set of dockets or what was last reviewed changes
  const key = JSON.stringify(list.map((e) => [e.docket, e.seenRecordId]));
  useEffect(() => {
    if (list.length === 0) {
      setStatus({});
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    getWatchStatus(list.map((e) => ({ docket: e.docket, seen_record_id: e.seenRecordId })), ctrl.signal)
      .then((items) => {
        setStatus(Object.fromEntries(items.map((s): [string, WatchStatus] => [s.docket, s])));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Could not load the watchlist");
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [key]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const d = docket.trim();
    if (!d) return;
    setError(null);
    try {
      const [s] = await getWatchStatus([{ docket: d, seen_record_id: null }]);
      if (!s || !s.found) return setError(`Docket ${d} is not in the corpus.`);
      if (!addWatch(d, s.current.record_id)) return setError("The watchlist is full.");
      setDocket("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the docket");
    }
  }

  const changedCount = Object.values(status).filter((s) => s.found && s.changed).length;

  return (
    <div className="space-y-4 text-sm">
      <form onSubmit={onAdd} className="flex gap-2">
        <input
          value={docket}
          onChange={(e) => setDocket(e.target.value)}
          maxLength={40}
          placeholder="Docket, e.g. FAA-2026-11794"
          aria-label="Docket to watch"
          className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1.5 dark:border-stone-600"
        />
        <button className="rounded-md bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={!docket.trim()}>
          Watch
        </button>
      </form>

      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
      {list.length === 0 && <p className="text-xs text-stone-500">No dockets watched yet. Add one above, or use "Watch docket" on a document.</p>}
      {list.length > 0 && (
        <p role="status" className="text-xs text-stone-500">
          {loading ? "Checking…" : changedCount > 0 ? `${changedCount} of ${list.length} watched dockets changed.` : "No watched docket has changed."}
        </p>
      )}

      <ul className="space-y-3">
        {list.map((entry) => {
          const s = status[entry.docket];
          return (
            <li key={entry.docket} className="space-y-2 rounded border border-stone-300 p-2 dark:border-stone-600">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{entry.docket}</p>
                <button type="button" className={btn} onClick={() => removeWatch(entry.docket)} aria-label={`Stop watching ${entry.docket}`}>
                  Remove
                </button>
              </div>

              {!s && <p className="text-xs text-stone-500">Checking…</p>}
              {s && !s.found && <p className="text-xs text-amber-800 dark:text-amber-300">{s.note}</p>}
              {s && s.found && (
                <>
                  <p className="line-clamp-2 text-xs text-stone-600 dark:text-stone-400">{s.subject}</p>
                  <p className="text-xs">
                    Current: <span className="font-medium">{s.current.record_id ?? s.current.docket}</span> ({s.current.publish_date}) · {s.headline}
                  </p>
                  <p
                    role="status"
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      s.changed
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        : "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200"
                    }`}
                  >
                    {!s.seen_known
                      ? "The notice you last reviewed is no longer in the corpus. Review this docket again."
                      : s.new_notices > 0
                        ? `${s.new_notices} new notice${s.new_notices === 1 ? "" : "s"} since you last reviewed`
                        : "No change since you last reviewed"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {s.count > 1 && (
                      <button
                        type="button"
                        className={btn}
                        onClick={() => setComparing(comparing === entry.docket ? null : entry.docket)}
                        aria-expanded={comparing === entry.docket}
                      >
                        {s.changed && s.seen_ad_id !== null ? "What changed since I reviewed" : "What changed (latest notice)"}
                      </button>
                    )}
                    <button type="button" className={btn} onClick={() => openRevisionTimeline(s.current.ad_id, panel)}>
                      Timeline
                    </button>
                    {s.changed && (
                      <button type="button" className={btn} onClick={() => markReviewed(entry.docket, s.current.record_id)}>
                        Mark reviewed
                      </button>
                    )}
                  </div>
                  {comparing === entry.docket && (
                    <div className="max-h-96 overflow-y-auto border-t border-stone-200 pt-2 dark:border-stone-700">
                      <WhatChanged
                        key={`${s.current.ad_id}-${s.seen_ad_id ?? "prev"}`}
                        newId={s.current.ad_id}
                        oldId={s.changed && s.seen_ad_id !== null ? s.seen_ad_id : undefined}
                      />
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-stone-500">The watchlist is stored in this browser only.</p>
    </div>
  );
}
