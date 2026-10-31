import type { ReactNode } from "react";
import type { DocumentCard as Doc } from "../api/types";
import { statusBadge, verdictStyle } from "../lib/format";
import { profileLabel, type Profile } from "../lib/profile";
import { safeUrl } from "../lib/safeUrl";

interface Props {
  doc: Doc;
  /** The aircraft profile the question was asked with (applicability is relative to it). */
  profile: Profile;
  /** P4's revision timeline; the revision badge becomes a button when provided. */
  onOpenTimeline?: (adId: number) => void;
  /** Expand the evaluation trace initially. */
  traceOpen?: boolean;
}

const MODELS_SHOWN = 8;

const MODELS_SOURCE: Record<string, string> = {
  applicability: "models parsed from the applicability paragraph",
  summary: "models parsed from the summary",
};

export function DocumentCard({ doc: d, profile, onOpenTimeline, traceOpen }: Props) {
  const status = statusBadge(d.status);
  const url = safeUrl(d.url);
  const subject = d.subject.replace(/^Airworthiness Directives;\s*/i, "");

  return (
    <article
      aria-label={`${d.record_id || d.docket}: ${subject}`}
      className="rounded-xl border border-stone-200 bg-white p-3.5 text-sm shadow-xs dark:border-stone-800 dark:bg-stone-900"
    >
      <header className="space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-stone-900 dark:text-stone-100">{d.record_id || d.docket}</span>
          {d.record_id && <span className="text-stone-500 dark:text-stone-400">{d.docket}</span>}
          {d.ad_number && <span className="text-stone-500 dark:text-stone-400">AD {d.ad_number}</span>}
        </p>
        <h3 className="line-clamp-2 leading-snug font-medium wrap-break-word" title={d.subject}>
          {subject}
        </h3>
      </header>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone={status.tone} title={d.status_label}>
          {d.status_label || status.label}
        </Badge>
        <RevisionBadge doc={d} onOpenTimeline={onOpenTimeline} />
        {!d.fulltext && (
          <Badge tone={NEUTRAL} title="The Federal Register full text wasn't available; only the index summary is searchable.">
            Summary only
          </Badge>
        )}
      </div>

      {d.data_warning && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs wrap-break-word text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
          <span className="font-semibold">Data warning: </span>
          {d.data_warning}
        </p>
      )}

      <Verdict doc={d} profile={profile} open={traceOpen} />

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
        {d.make && (
          <>
            <dt>Make</dt>
            <dd className="text-stone-800 dark:text-stone-200">{d.make}</dd>
          </>
        )}
        <dt>Models</dt>
        <dd className="wrap-break-word text-stone-800 dark:text-stone-200">
          <Models models={d.models} />
          {d.models_source && MODELS_SOURCE[d.models_source] && (
            <span className="block text-[11px] text-stone-500 dark:text-stone-400">{MODELS_SOURCE[d.models_source]}</span>
          )}
        </dd>
        <dt>Published</dt>
        <dd className="text-stone-800 tabular-nums dark:text-stone-200">
          {d.publish_date || d.issue_date}
          {d.pages && <span className="text-stone-500 dark:text-stone-400"> · FR pp. {d.pages}</span>}
        </dd>
        {d.supersedes.length > 0 && (
          <>
            <dt>Supersedes</dt>
            <dd className="text-stone-800 dark:text-stone-200">AD {d.supersedes.join(", ")}</dd>
          </>
        )}
      </dl>

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-800 hover:underline dark:text-blue-300"
        >
          Federal Register source
          <svg aria-hidden viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </a>
      )}
    </article>
  );
}

function Verdict({ doc: d, profile, open }: { doc: Doc; profile: Profile; open?: boolean }) {
  const a = d.applicability;
  if (!a) {
    const set = Boolean(profile.model || profile.serial);
    return (
      <p className="mt-3 rounded-lg border border-dashed border-stone-300 px-2.5 py-1.5 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
        {set ? "Applicability was not checked for this document." : "Set an aircraft profile to check applicability."}
      </p>
    );
  }
  const v = verdictStyle(a.result);
  const forWhom = profile.model || profile.serial ? `for ${profileLabel(profile)}` : "no aircraft profile set";
  return (
    <details open={open} className={`group mt-3 rounded-lg border ${v.tone}`}>
      <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 select-none">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${v.dot}`} />
        <span className="text-xs font-semibold tracking-wide uppercase">{v.label}</span>
        <span className="min-w-0 truncate text-xs opacity-75">{forWhom}</span>
        <span aria-hidden className="ml-auto text-[10px] opacity-60 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-current/15 px-2.5 py-2">
        <p className="text-[11px] font-medium opacity-75">Evaluation trace (rules, not the LLM)</p>
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs leading-snug wrap-break-word">
          {a.trace.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
        {a.candidates && a.candidates.length > 0 && (
          <p className="mt-1.5 text-xs wrap-break-word">
            <span className="opacity-75">Candidates: </span>
            <span className="font-mono">{a.candidates.join(", ")}</span>
          </p>
        )}
      </div>
    </details>
  );
}

function RevisionBadge({ doc: d, onOpenTimeline }: { doc: Doc; onOpenTimeline?: (adId: number) => void }) {
  const r = d.revision;
  if (!r || r.count <= 1) return null;
  const outdated = !r.is_latest;
  const label = outdated ? "Outdated: newer version exists" : `Latest of ${r.count}`;
  const tone = outdated ? OUTDATED : NEUTRAL;
  const title = outdated
    ? `This is not the current notice in its docket (${r.count} versions).${onOpenTimeline ? " Open the revision timeline." : ""}`
    : `Current version of ${r.count} in this docket.${onOpenTimeline ? " Open the revision timeline." : ""}`;
  if (!onOpenTimeline) return <Badge tone={tone} title={title}>{label}</Badge>;
  return (
    <button
      type="button"
      onClick={() => onOpenTimeline(d.ad_id)}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none ${tone}`}
    >
      {label}
      <svg aria-hidden viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2" />
      </svg>
    </button>
  );
}

function Models({ models }: { models: string[] }) {
  if (models.length === 0) return <span className="text-stone-500 dark:text-stone-400">not listed</span>;
  const shown = models.slice(0, MODELS_SHOWN).join(", ");
  const more = models.length - MODELS_SHOWN;
  return (
    <span title={models.join(", ")}>
      {shown}
      {more > 0 && <span className="text-stone-500 dark:text-stone-400"> +{more} more</span>}
    </span>
  );
}

function Badge({ tone, title, children }: { tone: string; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`rounded-full border px-2 py-px text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

const NEUTRAL = "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300";
const OUTDATED = "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200";
