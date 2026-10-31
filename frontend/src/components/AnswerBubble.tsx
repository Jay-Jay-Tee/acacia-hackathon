import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AnswerMode, AskResponse, AskStatus, Citation } from "../api/types";
import { features } from "../features";
import { numberCitations } from "../lib/citations";
import { answerAsText, copyText } from "../lib/copyAnswer";
import { formatMs, statusBadge } from "../lib/format";
import type { Profile } from "../lib/profile";
import { safeUrl } from "../lib/safeUrl";
import { CitationChip } from "./CitationChip";
import { DocumentCards } from "./DocumentCards";

interface Props {
  /** The question and aircraft profile this answer is for (used by the copy actions). */
  query: string;
  profile: Profile;
  response: AskResponse;
  onCitationClick: (c: Citation) => void;
  /** needs_clarification: the user picked an exact model; set it on the profile and re-ask. */
  onPickModel: (model: string) => void;
}

const STATUS: Record<AskStatus, { label: string; card: string; accent: string; icon: ReactNode }> = {
  answered: {
    label: "Answer",
    card: "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900",
    accent: "text-emerald-700 dark:text-emerald-400",
    icon: <path d="M20 6 9 17l-5-5" />,
  },
  needs_clarification: {
    label: "Needs clarification",
    card: "border-amber-200 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/30",
    accent: "text-amber-700 dark:text-amber-400",
    icon: <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />,
  },
  refused: {
    label: "Cannot answer",
    card: "border-rose-200 bg-rose-50/60 dark:border-rose-900/70 dark:bg-rose-950/30",
    accent: "text-rose-700 dark:text-rose-400",
    icon: <path d="M18 6 6 18M6 6l12 12" />,
  },
};

const MODE: Record<Exclude<AnswerMode, null>, { label: string; title: string }> = {
  generated: { label: "Generated", title: "Claude wrote these sentences from the retrieved passages only; every sentence kept is cited and number-checked." },
  extractive: { label: "Extractive", title: "Verbatim source passages, with no generated text." },
  no_answer: { label: "No answer", title: "The retrieved documents don't answer this question." },
};

/** Exact models to choose from: the top-level list (v1.1), else whatever the per-document checks raised. */
function clarifyCandidates(r: AskResponse): string[] {
  if (r.candidates?.length) return r.candidates;
  return [...new Set(r.documents.flatMap((d) => d.applicability?.candidates ?? []))].sort();
}

export function AnswerBubble({ query, profile, response: r, onCitationClick, onPickModel }: Props) {
  const s = STATUS[r.status] ?? STATUS.refused;
  const { numberOf, sources } = numberCitations(r);
  const extractive = r.mode === "extractive";

  return (
    <article className={`rounded-2xl rounded-bl-md border px-4 py-3.5 text-[15px] ${s.card}`} aria-label={s.label}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase ${s.accent}`}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {s.icon}
          </svg>
          {s.label}
        </span>
        {r.mode && (
          <span title={MODE[r.mode]?.title} className="cursor-help rounded-full border border-stone-300 px-2 py-px text-[11px] text-stone-600 dark:border-stone-600 dark:text-stone-300">
            {MODE[r.mode]?.label ?? r.mode}
          </span>
        )}
        <span className="ml-auto text-[11px] text-stone-400 tabular-nums" title="Retrieval time · total time for this answer">
          {formatMs(r.retrieval_ms)} retrieval · {formatMs(r.total_ms)} total
        </span>
      </header>

      {r.status !== "answered" && r.refusal_reason && (
        <p className="mt-2 wrap-break-word text-stone-900 dark:text-stone-100">{r.refusal_reason}</p>
      )}

      {r.status === "needs_clarification" && <Clarify candidates={clarifyCandidates(r)} onPick={onPickModel} />}

      {r.notices?.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {r.notices.map((t) => (
            <li key={t} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              <span aria-hidden className="font-bold">!</span>
              <span className="wrap-break-word">{t}</span>
            </li>
          ))}
        </ul>
      )}

      {r.answer_blocks.length > 0 && (
        <div className="mt-3 space-y-2.5 wrap-break-word">
          {extractive && <p className="text-xs text-stone-500 dark:text-stone-400">Matching source passages, quoted verbatim:</p>}
          {extractive ? (
            r.answer_blocks.map((b, i) => (
              <blockquote key={i} className="border-l-2 border-stone-300 pl-3 leading-relaxed whitespace-pre-line text-stone-800 dark:border-stone-600 dark:text-stone-200">
                {b.text}
                {b.citations.map((c, j) => <CitationChip key={j} n={numberOf(c)} citation={c} onOpen={onCitationClick} />)}
              </blockquote>
            ))
          ) : (
            // Citations can split one sentence into several blocks, so generated blocks flow as one text
            // with each chip right after the words it supports.
            <p className="leading-relaxed">
              {r.answer_blocks.map((b, i) => (
                <span key={i}>
                  {i > 0 && !/^[,.;:)]/.test(b.text) && " "}
                  {i === 0 ? b.text.charAt(0).toUpperCase() + b.text.slice(1) : b.text}
                  {b.citations.map((c, j) => <CitationChip key={j} n={numberOf(c)} citation={c} onOpen={onCitationClick} />)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {sources.length > 0 && <Sources sources={sources} onOpen={onCitationClick} />}

      {r.documents.length > 0 && (
        <div className="mt-3">
          <DocumentCards documents={r.documents} />
        </div>
      )}

      {r.note && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{r.note}</p>}

      <Actions query={query} profile={profile} response={r} />

      <footer className="mt-3 border-t border-stone-200/70 pt-2.5 text-[11px] leading-snug text-stone-500 dark:border-stone-700/70 dark:text-stone-400">
        {r.disclaimer}
      </footer>
    </article>
  );
}

/** Copy the answer as plain text, plus P4's compliance-note export when it's plugged in. */
function Actions({ query, profile, response }: { query: string; profile: Profile; response: AskResponse }) {
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const CopyNote = features.CopyNote;

  async function copy() {
    const ok = await copyText(answerAsText(query, profile, response));
    setCopied(ok ? "ok" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(""), 2000);
  }

  return (
    // relative: keeps the sr-only status inside the scroll container (an absolute element without a
    // positioned ancestor would stretch the whole page).
    <div className="relative mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy answer with its sources"
        className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {copied === "ok" ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
        </svg>
        {copied === "ok" ? "Copied" : "Copy answer"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied === "ok" ? "Answer copied to the clipboard." : ""}
      </span>
      {copied === "failed" && <span className="text-xs text-rose-700 dark:text-rose-400">Clipboard blocked by the browser.</span>}
      {CopyNote && <CopyNote query={query} model={profile.model || null} serial={profile.serial || null} response={response} />}
    </div>
  );
}

const CLARIFY_SHOWN = 12;

function Clarify({ candidates, onPick }: { candidates: string[]; onPick: (m: string) => void }) {
  const [all, setAll] = useState(false);
  if (candidates.length === 0) return null;
  const shown = all ? candidates : candidates.slice(0, CLARIFY_SHOWN);
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-stone-600 dark:text-stone-300">Pick the exact model to re-ask with it:</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {shown.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onPick(m)}
            className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-mono text-xs text-stone-900 transition-colors hover:border-amber-500 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none dark:border-amber-800 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-amber-950"
          >
            {m}
          </button>
        ))}
        {candidates.length > CLARIFY_SHOWN && (
          <button type="button" onClick={() => setAll((a) => !a)} className="px-1.5 text-xs text-stone-500 underline-offset-2 hover:underline">
            {all ? "Show fewer" : `+${candidates.length - CLARIFY_SHOWN} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/** Reference list under the answer: every cited passage with its full source metadata. */
function Sources({ sources, onOpen }: { sources: Citation[]; onOpen: (c: Citation) => void }) {
  return (
    <details className="group mt-3 text-xs">
      <summary className="cursor-pointer text-stone-500 select-none hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200">
        {sources.length} source passage{sources.length === 1 ? "" : "s"}
      </summary>
      <ol className="mt-2 space-y-1.5">
        {sources.map((c, i) => {
          const url = safeUrl(c.url);
          const badge = statusBadge(c.status);
          return (
            <li key={`${c.ad_id}:${c.chunk_id}`} className="flex gap-2 text-stone-600 dark:text-stone-400">
              <button type="button" onClick={() => onOpen(c)} className="shrink-0 font-semibold text-blue-800 tabular-nums hover:underline dark:text-blue-300">
                [{i + 1}]
              </button>
              <span className="min-w-0 wrap-break-word">
                <span className="font-medium text-stone-800 dark:text-stone-200">{c.record_id || c.docket}</span>
                {c.record_id && ` · ${c.docket}`} · {badge.label} · rev. {c.revision_date} · {c.section} · FR p.{c.page}
                {url && (
                  <>
                    {" · "}
                    <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100">
                      {c.fr_citation || "Federal Register"}
                    </a>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
