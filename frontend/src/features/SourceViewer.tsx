import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { statusBadge } from "../lib/format";
import { safeUrl } from "../lib/safeUrl";
import { formatChunk, type Block, type FormattedChunk } from "./sourceFormat";
import { getSourceText, type SourceText } from "./sourceApi";

// Rendered inside P1's <SidePanel>. Shows the full document, scrolls to the cited chunk and highlights
// the quoted span. Plain text only: every field is rendered as a React text node.

/** The fields the viewer needs; both corpus citations and uploaded-document citations satisfy it. */
export interface ViewerCitation {
  ad_id: number;
  chunk_id: number;
  cited_text: string;
  url: string;
}

/** `load` fetches the text for another collection (uploads). Default: the corpus document for `citation.ad_id`. */
export function SourceViewer({
  citation,
  load,
}: {
  citation: ViewerCitation;
  load?: (signal: AbortSignal) => Promise<SourceText>;
}) {
  const [data, setData] = useState<SourceText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const citedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (load ? load(ctrl.signal) : getSourceText(citation.ad_id, ctrl.signal))
      .then(setData)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Could not load source text");
      });
    return () => ctrl.abort();
  }, [citation.ad_id]);

  useEffect(() => {
    if (data) citedRef.current?.scrollIntoView({ block: "center" });
  }, [data]);

  // Reflow every chunk once; the cited one also gets its quote located.
  const formatted = useMemo(
    () =>
      new Map<number, FormattedChunk>(
        (data?.chunks ?? []).map((c) => [c.chunk_id, formatChunk(c.text, c.section, c.chunk_id === citation.chunk_id ? citation.cited_text : undefined)]),
      ),
    [data, citation.chunk_id, citation.cited_text],
  );

  const link = safeUrl(data?.url ?? citation.url);
  if (error)
    return (
      <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">
        {error}
      </p>
    );
  if (!data) return <LoadingSource />;

  const cited = data.chunks.find((c) => c.chunk_id === citation.chunk_id);
  const span = cited ? formatted.get(cited.chunk_id)?.span ?? null : null;
  const badge = statusBadge(data.status);
  const subject = data.subject.replace(/^Airworthiness Directives;\s*/i, "");
  const jump = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="text-sm">
      {/* Document header */}
      <section className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-stone-900 dark:text-stone-100">{data.record_id ?? data.docket}</span>
          {data.record_id && <span className="text-stone-500 dark:text-stone-400">{data.docket}</span>}
        </p>
        <h3 className="mt-0.5 leading-snug font-semibold wrap-break-word text-stone-900 dark:text-stone-100" title={data.subject}>
          {subject}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full border px-2 py-px text-[11px] font-medium ${badge.tone}`}>{data.status_label || badge.label}</span>
          {data.pages && <span className="text-[11px] text-stone-500 tabular-nums dark:text-stone-400">FR pp. {data.pages}</span>}
        </div>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            Open on federalregister.gov
            <svg aria-hidden viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        )}
      </section>

      {/* Sticky navigation: section jump + back to the citation */}
      <div className="sticky -top-4 z-10 -mx-4 mt-3 flex items-center gap-2 border-b border-stone-200/80 bg-stone-50/90 px-4 py-2 backdrop-blur dark:border-stone-800/80 dark:bg-stone-950/90">
        {data.anchors.length > 1 && (
          <div className="relative min-w-0 flex-1">
            <select
              aria-label="Jump to section"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) jump(e.target.value);
                e.target.value = "";
              }}
              className="w-full cursor-pointer appearance-none truncate rounded-md border border-stone-300 bg-white py-1 pr-7 pl-2.5 text-xs text-stone-700 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              <option value="" disabled>
                Jump to section…
              </option>
              {data.anchors.map((a) => (
                <option key={a.anchor} value={a.anchor}>
                  {a.section} · p. {a.page}
                </option>
              ))}
            </select>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2 grid place-items-center text-[10px] text-stone-400">
              ▾
            </span>
          </div>
        )}
        {cited && (
          <button
            type="button"
            onClick={() => citedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100 dark:hover:bg-amber-950"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
            Cited passage
          </button>
        )}
      </div>

      {!cited && <Notice>The cited passage was not found in this document's text. Verify on federalregister.gov.</Notice>}
      {cited && !span && <Notice>The exact quote could not be located inside this passage, so the whole passage is highlighted.</Notice>}

      {/* Document body */}
      <article className="mt-2">
        {data.chunks.map((c, i) => {
          const isCited = c.chunk_id === citation.chunk_id;
          const prev = data.chunks[i - 1];
          const f = formatted.get(c.chunk_id);
          if (!f || f.blocks.every((b) => b.kind === "hidden")) return null;
          return (
            <Fragment key={c.chunk_id}>
              {(!prev || prev.page !== c.page) && <PageMarker page={c.page} />}
              {/* Original case on purpose: "(d)" is a paragraph reference, not decoration. */}
              {(!prev || prev.section !== c.section) && !f.leadsWithSection && (
                <h4 className="mt-5 mb-1.5 text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400">{c.section}</h4>
              )}
              <div
                id={c.anchor}
                ref={isCited ? citedRef : undefined}
                className={
                  isCited
                    ? `relative -mx-2 my-2 scroll-mt-16 rounded-lg border-l-2 border-amber-400 px-3 py-2 ${span ? "bg-amber-50/40 dark:bg-amber-500/5" : "bg-amber-100/60 dark:bg-amber-500/10"}`
                    : "scroll-mt-16"
                }
              >
                {isCited && (
                  <p className="mb-1 text-[10px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-400">
                    Cited passage · p. {c.page}
                  </p>
                )}
                <Body blocks={f.blocks} span={isCited ? span : null} />
              </div>
            </Fragment>
          );
        })}
      </article>
    </div>
  );
}

/** Paragraphs and sub-headings, with the cited span marked where it falls (it can cross paragraphs). */
function Body({ blocks, span }: { blocks: Block[]; span: [number, number] | null }) {
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        if (b.kind === "hidden") return null;
        const content = marked(b, span);
        return b.kind === "h" ? (
          <p key={i} className="pt-1.5 text-[13px] font-semibold text-stone-900 dark:text-stone-100">
            {content}
          </p>
        ) : (
          <p key={i} className="font-serif text-[14px] leading-[1.7] lining-nums wrap-break-word text-stone-700 dark:text-stone-300">
            {content}
          </p>
        );
      })}
    </div>
  );
}

function marked(b: Block, span: [number, number] | null): ReactNode {
  if (!span || span[1] <= b.start || span[0] >= b.end) return b.text;
  const from = Math.max(span[0], b.start) - b.start;
  const to = Math.min(span[1], b.end) - b.start;
  return (
    <>
      {b.text.slice(0, from)}
      <mark className="rounded-[2px] bg-amber-200/60 box-decoration-clone text-stone-900 dark:bg-amber-300/15 dark:text-stone-100">{b.text.slice(from, to)}</mark>
      {b.text.slice(to)}
    </>
  );
}

function PageMarker({ page }: { page: number }) {
  return (
    <div className="my-4 flex items-center gap-2 text-[10px] font-medium tracking-wider text-stone-400 tabular-nums uppercase dark:text-stone-500">
      <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
      Federal Register p. {page}
      <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
      {children}
    </p>
  );
}

function LoadingSource() {
  return (
    <div role="status" aria-label="Loading source" className="space-y-3 motion-safe:animate-pulse">
      <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
        <div className="h-3 w-1/3 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="h-4 w-3/4 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="h-3 w-1/2 rounded bg-stone-200 dark:bg-stone-800" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-3 rounded bg-stone-200 dark:bg-stone-800" style={{ width: `${92 - i * 9}%` }} />
      ))}
      <span className="sr-only">Loading source…</span>
    </div>
  );
}
