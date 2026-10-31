import { useEffect, useState } from "react";
import { safeUrl } from "../lib/safeUrl";
import { getTimeline, type Timeline, type TimelineKind } from "./timelineApi";

// Visual timeline for one docket: proposed -> revised -> withdrawn/final, current version highlighted.
// Rendered inside P1's <SidePanel>; plain text only. `onOpenAd` lets a supersession link open another timeline.

const KIND_STYLE: Record<TimelineKind, { dot: string; badge: string }> = {
  proposed: { dot: "bg-blue-600", badge: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" },
  revised: { dot: "bg-purple-600", badge: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200" },
  withdrawn: { dot: "bg-stone-500", badge: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200" },
  final: { dot: "bg-red-600", badge: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

export function RevisionTimeline({ adId, onOpenAd }: { adId: number; onOpenAd?: (adId: number) => void }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getTimeline(adId, ctrl.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Could not load revision timeline");
      });
    return () => ctrl.abort();
  }, [adId]);

  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-stone-500">Loading timeline…</p>;

  const withdrawn = data.headline.toLowerCase().startsWith("withdrawn");

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs text-stone-500">
          Docket {data.docket} · {data.count} notice{data.count === 1 ? "" : "s"}
        </p>
        <p
          role="status"
          className={`mt-1 rounded p-2 font-medium ${
            withdrawn
              ? "bg-stone-200 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          Current status: {data.headline}
        </p>
      </div>

      <ol className="relative ml-2 border-l-2 border-stone-300 dark:border-stone-600">
        {data.events.map((e) => {
          const style = KIND_STYLE[e.kind];
          const link = safeUrl(e.url);
          const id = e.ad_number || e.record_id || data.docket;
          return (
            <li key={e.ad_id} aria-current={e.is_current ? "step" : undefined} className="relative pb-5 pl-5 last:pb-0">
              <span
                aria-hidden="true"
                className={`absolute -left-[0.6rem] top-1 h-4 w-4 rounded-full border-2 border-white dark:border-stone-900 ${style.dot} ${
                  e.is_current ? "ring-2 ring-offset-2 ring-blue-700 dark:ring-offset-stone-900" : ""
                }`}
              />
              <div
                className={`rounded-md border p-2 ${
                  e.is_current ? "border-blue-700 bg-blue-50 dark:bg-blue-950/40" : "border-stone-200 dark:border-stone-700"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.badge}`}>{e.label}</span>
                  {e.is_current && (
                    <span className="rounded bg-blue-700 px-1.5 py-0.5 text-xs font-medium text-white">Current</span>
                  )}
                  <span className="text-xs text-stone-500">{e.publish_date ?? "date unknown"}</span>
                </div>
                <p className="mt-1 text-xs">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      {id}
                    </a>
                  ) : (
                    <span className="font-medium">{id}</span>
                  )}
                  {e.pages && <span className="text-stone-500"> · FR pages {e.pages}</span>}
                </p>
                <p className="text-xs text-stone-500">{e.status_label}</p>
                {e.kind === "withdrawn" && e.is_current && (
                  <p className="mt-1 text-xs font-medium">Withdrawn: no action required.</p>
                )}
                {e.supersedes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {e.supersedes.map((s) => (
                      <li key={s.ad_number}>
                        Supersedes AD {s.ad_number}:{" "}
                        {s.in_corpus && s.ad_id !== undefined ? (
                          onOpenAd ? (
                            <button type="button" onClick={() => onOpenAd(s.ad_id as number)} className="underline">
                              {s.record_id ?? s.docket} (view timeline)
                            </button>
                          ) : (
                            <span>{s.record_id ?? s.docket}</span>
                          )
                        ) : (
                          <span className="text-stone-500">not in corpus</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
