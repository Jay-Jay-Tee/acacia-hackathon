import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { SourceViewer } from "./SourceViewer";
import {
  askUpload,
  deleteUpload,
  getUploadText,
  listUploads,
  uploadPdf,
  type UploadAnswer,
  type UploadCitation,
  type UploadSummary,
} from "./uploadApi";

// Upload a PDF (maintenance manual, accident report, ...) into the separate "uploaded" collection and ask a
// cited question about it. Answers are quotes from the uploaded text with page numbers; applicability is
// always UNKNOWN. Rendered inside P1's <SidePanel>; plain text only.

const MAX_BYTES = 20 * 1024 * 1024;
const btn =
  "rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:hover:bg-stone-800";

export function UploadPanel() {
  const [docs, setDocs] = useState<UploadSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<UploadAnswer | null>(null);
  const [viewing, setViewing] = useState<UploadCitation | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    listUploads(c.signal)
      .then((d) => {
        setDocs(d);
        setSelected((cur) => cur ?? d[0]?.doc_id ?? null);
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : "Could not load uploads");
      });
    return () => {
      c.abort();
      ctrl.current?.abort();
    };
  }, []);

  const doc = docs.find((d) => d.doc_id === selected) ?? null;

  function select(id: number) {
    setSelected(id);
    setAnswer(null);
    setViewing(null);
    setError(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return setError("Choose a PDF file.");
    if (file.size > MAX_BYTES) return setError("File is larger than 20 MB.");
    setBusy(true);
    setError(null);
    try {
      const d = await uploadPdf(file);
      setDocs(await listUploads());
      select(d.doc_id);
      setInfo([
        d.duplicate ? `${d.filename} was already uploaded.` : `Indexed ${d.filename}: ${d.pages} pages, ${d.chunks} passages.`,
        ...d.warnings,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    if (selected === null || !query.trim()) return;
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setBusy(true);
    setError(null);
    setViewing(null);
    try {
      setAnswer(await askUpload(selected, query.trim(), ctrl.current.signal));
    } catch (err) {
      if (!ctrl.current.signal.aborted) setError(err instanceof Error ? err.message : "Question failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(d: UploadSummary) {
    if (!window.confirm(`Remove ${d.filename}? Its indexed text is deleted.`)) return;
    setError(null);
    try {
      await deleteUpload(d.doc_id);
      const rest = await listUploads();
      setDocs(rest);
      setSelected(rest[0]?.doc_id ?? null);
      setAnswer(null);
      setViewing(null);
      setInfo([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  let n = 0;
  return (
    <div className="space-y-4 text-sm">
      <p className="rounded bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Uploaded documents are not official FAA or Federal Register sources, and the AD applicability rules are not run on
        them. Answers quote the document with page numbers; verify them against the controlled original.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btn} cursor-pointer`}>
          {busy ? "Working…" : "Upload PDF"}
          <input type="file" accept=".pdf,application/pdf" onChange={onFile} disabled={busy} className="sr-only" />
        </label>
        <span className="text-xs text-stone-500">Up to 20 MB, text PDFs only (scans are not read).</span>
      </div>

      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
      {info.length > 0 && (
        <ul role="status" className="list-disc space-y-0.5 pl-5 text-xs text-stone-600 dark:text-stone-300">
          {info.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {docs.length > 0 && (
        <ul className="space-y-1" aria-label="Uploaded documents">
          {docs.map((d) => (
            <li key={d.doc_id} className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={d.doc_id === selected}
                onClick={() => select(d.doc_id)}
                className={`min-w-0 flex-1 truncate rounded border px-2 py-1 text-left text-xs ${
                  d.doc_id === selected ? "border-blue-700 bg-blue-50 dark:bg-blue-950/40" : "border-stone-300 dark:border-stone-600"
                }`}
              >
                {d.filename} · {d.pages} pages
              </button>
              <button type="button" className={btn} onClick={() => onRemove(d)} aria-label={`Remove ${d.filename}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {docs.length === 0 && !busy && <p className="text-xs text-stone-500">No documents uploaded yet.</p>}

      {doc && (
        <>
          <details className="text-xs">
            <summary className="cursor-pointer">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Applicability: {doc.applicability.result}
              </span>{" "}
              · {doc.chunks} passages · {doc.sections.length} sections
            </summary>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {doc.applicability.trace.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
            <p className="mt-2 font-medium">Sections found</p>
            <ul className="list-disc pl-5">
              {doc.sections.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>

          <form onSubmit={onAsk} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={500}
              placeholder="Ask a question about this document"
              aria-label="Question about the uploaded document"
              className="min-w-0 flex-1 rounded border border-stone-300 bg-transparent px-2 py-1.5 dark:border-stone-600"
            />
            <button className="rounded-md bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy || !query.trim()}>
              Ask
            </button>
          </form>
        </>
      )}

      {answer && (
        <section className="space-y-3" aria-label="Answer">
          {answer.status === "refused" && <p role="status" className="font-medium">{answer.refusal_reason}</p>}
          {answer.notices.map((m) => (
            <p key={m} className="rounded bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {m}
            </p>
          ))}
          {answer.answer_blocks.map((b, i) => (
            <div key={i} className="space-y-1">
              <blockquote className="whitespace-pre-wrap border-l-2 border-stone-300 pl-3 dark:border-stone-600">{b.text}</blockquote>
              <div className="flex flex-wrap gap-1">
                {b.citations.map((c) => {
                  n += 1;
                  return (
                    <button
                      key={c.chunk_id}
                      type="button"
                      onClick={() => setViewing(c)}
                      className="rounded-full border border-blue-700 px-2 py-0.5 text-xs text-blue-800 dark:text-blue-300"
                    >
                      [{n}] p. {c.page} · {c.section}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {answer.status === "answered" && <p className="text-xs text-stone-500">{answer.disclaimer}</p>}
        </section>
      )}

      {viewing && (
        <section className="rounded border border-stone-300 p-2 dark:border-stone-600" aria-label="Source passage">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium">
              Source · {viewing.fr_citation} · page {viewing.page}
            </span>
            <button type="button" className={btn} onClick={() => setViewing(null)}>
              Close source
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <SourceViewer
              key={`${viewing.doc_id}-${viewing.chunk_id}`}
              citation={viewing}
              load={(signal) => getUploadText(viewing.doc_id, signal)}
            />
          </div>
        </section>
      )}
    </div>
  );
}
