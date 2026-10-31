import { Fragment, useEffect, useRef, useState } from "react";
import type { Citation } from "../api/types";
import { safeUrl } from "../lib/safeUrl";
import { locate } from "./highlight";
import { BOILERPLATE, reflow } from "./reflow";
import { getSourceText, type SourceText } from "./sourceApi";

// Rendered inside P1's <SidePanel>. Shows the full document, scrolls to the cited chunk and highlights
// the quoted span. Plain text only: every field is rendered as a React text node.

export function SourceViewer({ citation }: { citation: Citation }) {
  const [data, setData] = useState<SourceText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const citedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getSourceText(citation.ad_id, ctrl.signal)
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
  const span = cited ? locate(reflow(cited.text).map((x) => x.text).join("\n"), citation.cited_text) : null;

  const jump = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ block: "start" });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-base leading-snug font-semibold">{data.subject}</p>
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

      <div className="space-y-1">
        {groupBySection(data.chunks).map((g) => {
          const holdsCited = g.chunks.some((c) => c.chunk_id === citation.chunk_id);
          const body = g.chunks.map((c, i) => (
            <Fragment key={c.chunk_id}>
              {(i === 0 ? g.firstPageChange : g.chunks[i - 1].page !== c.page) && (
                <p className="my-3 border-t border-dashed border-stone-300 pt-1 text-center text-[11px] tracking-wide text-stone-400 uppercase dark:border-stone-700">
                  Federal Register page {c.page}
                </p>
              )}
              <div id={c.anchor} ref={c.chunk_id === citation.chunk_id ? citedRef : undefined}>
                <Passage text={dropHeading(c.text, g.section)} quote={c.chunk_id === citation.chunk_id ? citation.cited_text : null} />
              </div>
            </Fragment>
          ));
          if (BOILERPLATE.test(g.section) && !holdsCited)
            return (
              <details key={g.key} className="group rounded-md border border-stone-200 px-3 py-1.5 dark:border-stone-800">
                <summary className="cursor-pointer text-xs text-stone-500 select-none dark:text-stone-400">{g.section}</summary>
                <div className="mt-1">{body}</div>
              </details>
            );
          return (
            <section key={g.key} className="pt-2">
              <h3 className="mb-1 text-[13px] font-semibold text-stone-900 dark:text-stone-100">{g.section}</h3>
              {body}
            </section>
          );
        })}
      </div>
    </div>
  );
}

type Chunk = SourceText["chunks"][number];

/** Consecutive chunks of one section, so boilerplate can be collapsed as a unit. */
function groupBySection(chunks: Chunk[]) {
  const groups: { key: string; section: string; chunks: Chunk[]; firstPageChange: boolean }[] = [];
  chunks.forEach((c, i) => {
    const prev = chunks[i - 1];
    if (!prev || prev.section !== c.section)
      groups.push({ key: `${c.chunk_id}`, section: c.section, chunks: [], firstPageChange: !prev || prev.page !== c.page });
    groups[groups.length - 1].chunks.push(c);
  });
  return groups;
}

/** Reflowed paragraphs; the cited quote, if any, is highlighted across them. */
function Passage({ text, quote }: { text: string; quote: string | null }) {
  const segs = reflow(text);
  const joined = segs.map((s) => s.text).join("\n");
  const span = quote ? locate(joined, quote) : null;
  let offset = 0;
  return (
    <div className={`space-y-2 py-1 ${quote && !span ? "rounded bg-yellow-100 px-1 dark:bg-yellow-900/40" : ""}`}>
      {segs.map((s, i) => {
        const from = offset;
        offset += s.text.length + 1;
        const cls = s.mono
          ? "overflow-x-auto font-mono text-[11px] leading-snug whitespace-pre text-stone-700 dark:text-stone-300"
          : "text-[14px] leading-relaxed text-stone-800 dark:text-stone-200";
        if (!span || span[1] <= from || span[0] >= from + s.text.length) return <p key={i} className={cls}>{s.text}</p>;
        const a = Math.max(0, span[0] - from), b = Math.min(s.text.length, span[1] - from);
        return (
          <p key={i} className={cls}>
            {s.text.slice(0, a)}
            <mark className="rounded-sm bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-800/70">{s.text.slice(a, b)}</mark>
            {s.text.slice(b)}
          </p>
        );
      })}
    </div>
  );
}

/** Drop the passage's own heading line ("(c) Applicability", "SUMMARY:") since the section title is shown. */
function dropHeading(text: string, section: string): string {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9()]+/g, " ").trim();
  const [first, ...rest] = text.trimStart().split("\n");
  if (norm(first) === norm(section)) return rest.join("\n");
  if (norm(first).startsWith(norm(section))) return text.trimStart().replace(/^[A-Z][A-Z ,'/-]{3,60}:\s*/, "");
  return text;
}
