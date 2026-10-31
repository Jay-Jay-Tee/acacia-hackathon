import { Fragment, useEffect, useRef, useState } from "react";
import { safeUrl } from "../lib/safeUrl";
import { locate } from "./highlight";
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

  const link = safeUrl(data?.url ?? citation.url);
  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-stone-500">Loading source…</p>;

  const cited = data.chunks.find((c) => c.chunk_id === citation.chunk_id);
  const span = cited ? locate(cited.text, citation.cited_text) : null;

  const jump = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ block: "start" });

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{data.subject}</p>
        <p className="text-xs text-stone-500">
          {data.record_id ?? data.docket} · {data.status_label} · FR pages {data.pages}
        </p>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs underline">
            Open on federalregister.gov
          </a>
        )}
      </div>

      {data.anchors.length > 1 && (
        <select
          aria-label="Jump to section"
          defaultValue=""
          onChange={(e) => e.target.value && jump(e.target.value)}
          className="w-full rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-600"
        >
          <option value="" disabled>
            Jump to section…
          </option>
          {data.anchors.map((a) => (
            <option key={a.anchor} value={a.anchor}>
              {a.section} (p. {a.page})
            </option>
          ))}
        </select>
      )}

      {!cited && (
        <p role="status" className="rounded bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The cited passage was not found in this document's text. Verify on federalregister.gov.
        </p>
      )}
      {cited && !span && (
        <p role="status" className="rounded bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The exact quote could not be located inside this passage, so the whole passage is highlighted.
        </p>
      )}

      <div>
        {data.chunks.map((c, i) => {
          const isCited = c.chunk_id === citation.chunk_id;
          const prev = data.chunks[i - 1];
          return (
            <Fragment key={c.chunk_id}>
              {(!prev || prev.page !== c.page) && (
                <div className="my-2 border-t border-dashed border-stone-300 pt-1 text-center text-[11px] uppercase tracking-wide text-stone-400 dark:border-stone-600">
                  Federal Register page {c.page}
                </div>
              )}
              {(!prev || prev.section !== c.section) && !startsWithHeading(c.text, c.section) && (
                <h3 className="mt-2 text-xs font-semibold">{c.section}</h3>
              )}
              <div
                id={c.anchor}
                ref={isCited ? citedRef : undefined}
                className={`font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap py-1 ${isCited && !span ? "bg-yellow-200 dark:bg-yellow-900/60" : ""}`}
              >
                {isCited && span ? (
                  <>
                    {c.text.slice(0, span[0])}
                    <mark className="bg-yellow-200 text-inherit dark:bg-yellow-900/60">{c.text.slice(span[0], span[1])}</mark>
                    {c.text.slice(span[1])}
                  </>
                ) : (
                  c.text
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** The passage already opens with its own heading line ("(c) Applicability", "SUMMARY:"), so don't repeat it. */
function startsWithHeading(text: string, section: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9()]+/g, " ").trim();
  return norm(text.trimStart().slice(0, section.length + 2)).startsWith(norm(section));
}
