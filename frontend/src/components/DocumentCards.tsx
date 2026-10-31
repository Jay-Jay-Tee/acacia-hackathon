import { useState } from "react";
import type { ApplicabilityResult, DocStatus, DocumentCard } from "../api/types";
import { features } from "../features";
import { safeUrl } from "../lib/safeUrl";
import { useSidePanel } from "./SidePanel";

const STATUS_STYLE: Record<DocStatus, string> = {
  proposed: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  final: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  withdrawn: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  not_ad: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
};

const VERDICT: Record<ApplicabilityResult, { label: string; style: string }> = {
  APPLIES: { label: "Applies", style: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" },
  DOES_NOT_APPLY: { label: "Does not apply", style: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
  UNKNOWN: { label: "Unknown: check the source", style: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  AMBIGUOUS: { label: "Which variant?", style: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
};

const pill = "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium";
const SHOWN = 3;

/** Matching documents under an answer: status, revision, data warnings and the applicability verdict
 * with the rule trace, so a qualified person can check the reasoning before acting. */
export function DocumentCards({ documents }: { documents: DocumentCard[] }) {
  const [all, setAll] = useState(false);
  if (documents.length === 0) return null;
  const shown = all ? documents : documents.slice(0, SHOWN);
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">
        Matching documents ({documents.length})
      </h3>
      <ul className="space-y-2">
        {shown.map((d) => (
          <Card key={d.ad_id} d={d} />
        ))}
      </ul>
      {documents.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs font-medium text-stone-600 underline underline-offset-2 dark:text-stone-300">
          {all ? "Show fewer" : `Show all ${documents.length}`}
        </button>
      )}
    </section>
  );
}

function Card({ d }: { d: DocumentCard }) {
  const panel = useSidePanel();
  const link = safeUrl(d.url);
  // P4's revision timeline, opened from the revision badge (no-op badge while the hook is absent).
  const openTimeline = features.openRevisionTimeline && (() => features.openRevisionTimeline?.(d.ad_id, panel));
  const a = d.applicability;
  const models = d.models.slice(0, 6).join(", ") + (d.models.length > 6 ? ` +${d.models.length - 6}` : "");
  return (
    <li className="space-y-1.5 rounded-xl border border-stone-200 px-3 py-2.5 text-sm dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${pill} ${STATUS_STYLE[d.status]}`}>{d.status_label}</span>
        {d.revision.count > 1 && (
          <RevisionBadge
            onOpen={openTimeline}
            className={`${pill} ${d.revision.is_latest ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300" : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"}`}
          >
            {d.revision.is_latest ? `Latest of ${d.revision.count} versions` : "Outdated: a newer version exists"}
          </RevisionBadge>
        )}
        {!d.fulltext && <span className={`${pill} bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300`}>Summary only</span>}
      </div>

      <p className="font-medium wrap-break-word text-stone-900 dark:text-stone-100">{d.subject}</p>
      <p className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
        {d.record_id} · {d.docket} · published {d.publish_date}
        {d.ad_number && ` · AD ${d.ad_number}`}
      </p>

      {d.data_warning && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">{d.data_warning}</p>
      )}

      {models && (
        <p className="text-xs text-stone-600 dark:text-stone-300">
          {d.make} · {models}
          {d.models_source && d.models_source !== "sheet" && (
            <span className="text-stone-400"> (models read from the {d.models_source === "applicability" ? "applicability text" : "summary"})</span>
          )}
        </p>
      )}

      {a && (
        // Open by default where the trace is the explanation: a "no" or an ambiguous model.
        <details className="group" open={a.result === "DOES_NOT_APPLY" || a.result === "AMBIGUOUS"}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
            <span className={`${pill} ${VERDICT[a.result].style}`}>{VERDICT[a.result].label}</span>
            <span className="text-stone-500 group-open:hidden dark:text-stone-400">Show how this was decided</span>
            <span className="hidden text-stone-500 group-open:inline dark:text-stone-400">Hide</span>
          </summary>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs text-stone-600 dark:text-stone-300">
            {a.trace.map((t, i) => (
              <li key={i} className="wrap-break-word">
                {t}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="flex flex-wrap gap-x-3 text-xs">
        {d.supersedes.length > 0 && <span className="text-stone-500 dark:text-stone-400">Supersedes AD {d.supersedes.join(", ")}</span>}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:underline dark:text-blue-300">
            Federal Register ↗
          </a>
        )}
      </div>
    </li>
  );
}

function RevisionBadge({ onOpen, className, children }: { onOpen?: () => void; className: string; children: string }) {
  if (!onOpen) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open the revision timeline for this docket"
      className={`${className} cursor-pointer gap-1 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none`}
    >
      {children}
      <span aria-hidden>↗</span>
    </button>
  );
}
