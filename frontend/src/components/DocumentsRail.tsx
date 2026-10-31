import type { ApplicabilityResult, DocumentCard as Doc } from "../api/types";
import { VERDICT } from "../lib/format";
import type { Profile } from "../lib/profile";
import { DocumentCard } from "./DocumentCard";
import type { Turn } from "./Thread";

const ORDER: ApplicabilityResult[] = ["APPLIES", "AMBIGUOUS", "UNKNOWN", "DOES_NOT_APPLY"];

/** "1 applies · 2 unknown": a one-line verdict summary across the documents. */
export function verdictTally(docs: Doc[]): { result: ApplicabilityResult; count: number }[] {
  const counts = new Map<ApplicabilityResult, number>();
  for (const d of docs) if (d.applicability) counts.set(d.applicability.result, (counts.get(d.applicability.result) ?? 0) + 1);
  return ORDER.filter((r) => counts.has(r)).map((result) => ({ result, count: counts.get(result)! }));
}

export function Tally({ docs }: { docs: Doc[] }) {
  const tally = verdictTally(docs);
  if (tally.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2.5 gap-y-0.5">
      {tally.map(({ result, count }) => (
        <span key={result} className="inline-flex items-center gap-1">
          <span aria-hidden className={`size-1.5 rounded-full ${VERDICT[result].dot}`} />
          {count} {VERDICT[result].label.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

interface ListProps {
  docs: Doc[];
  profile: Profile;
  onOpenTimeline?: (adId: number) => void;
}

/** The cards themselves. Traces start open where they explain a "no" or an ambiguity. */
export function DocumentList({ docs, profile, onOpenTimeline }: ListProps) {
  return (
    <ol className="space-y-3">
      {docs.map((d) => (
        <li key={d.ad_id}>
          <DocumentCard
            doc={d}
            profile={profile}
            onOpenTimeline={onOpenTimeline}
            traceOpen={docs.length === 1 || d.applicability?.result === "DOES_NOT_APPLY" || d.applicability?.result === "AMBIGUOUS"}
          />
        </li>
      ))}
    </ol>
  );
}

/** Desktop side rail: the documents behind one answer (the latest, or the one picked in the thread). */
export function DocumentsRail({ turn, onOpenTimeline }: { turn: Turn | undefined; onOpenTimeline?: (adId: number) => void }) {
  const docs = turn?.response?.documents ?? [];
  return (
    <aside aria-label="Matching documents" className="flex h-full flex-col">
      <header className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="text-sm font-semibold">Documents</h2>
        {turn ? (
          <>
            <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400" title={turn.query}>
              for “{turn.query}”
            </p>
            <p className="mt-1.5 text-[11px] text-stone-600 tabular-nums dark:text-stone-300">
              {docs.length} document{docs.length === 1 ? "" : "s"}
              {docs.length > 0 && verdictTally(docs).length > 0 && <span className="text-stone-400"> · </span>}
              <Tally docs={docs} />
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">Ask a question to see the matching notices here.</p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {turn && docs.length === 0 && (
          <p className="px-1 text-xs text-stone-500 dark:text-stone-400">No documents were retrieved for this question.</p>
        )}
        {docs.length > 0 && <DocumentList docs={docs} profile={turn!.profile} onOpenTimeline={onOpenTimeline} />}
      </div>
    </aside>
  );
}
