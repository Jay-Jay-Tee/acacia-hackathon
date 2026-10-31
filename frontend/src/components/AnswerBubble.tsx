import type { AskResponse, Citation } from "../api/types";
import { DocumentCards } from "./DocumentCards";

const HEAD: Record<AskResponse["status"], { label: string; frame: string }> = {
  answered: { label: "Answer", frame: "border-stone-200 dark:border-stone-800" },
  needs_clarification: { label: "Which aircraft exactly?", frame: "border-amber-300 dark:border-amber-800" },
  refused: { label: "Cannot answer", frame: "border-rose-300 dark:border-rose-900" },
};

interface Props {
  response: AskResponse;
  onCitationClick: (c: Citation) => void;
  /** needs_clarification: the user picked one of the exact models; re-ask with it. */
  onClarify?: (model: string) => void;
}

export function AnswerBubble({ response: r, onCitationClick, onClarify }: Props) {
  let n = 0;
  const head = HEAD[r.status];
  return (
    <div className={`space-y-3 rounded-2xl rounded-bl-md border bg-white px-4 py-3 text-[15px] dark:bg-stone-900 ${head.frame}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{head.label}</p>
        {r.mode === "extractive" && (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            source passages only
          </span>
        )}
      </div>

      {r.status === "needs_clarification" && r.candidates.length > 0 ? (
        <p>That model matches several variants. Pick the exact one to check applicability:</p>
      ) : (
        r.refusal_reason && <p className="wrap-break-word">{r.refusal_reason}</p>
      )}

      {r.status === "needs_clarification" && r.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.candidates.map((m) => (
            <button
              key={m}
              type="button"
              disabled={!onClarify}
              onClick={() => onClarify?.(m)}
              className="rounded-full border border-stone-300 px-2.5 py-1 text-xs font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {r.notices.map((t) => (
        <p key={t} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t}
        </p>
      ))}

      {r.answer_blocks.length > 0 && (
        // Citations can split a sentence into several blocks, so blocks flow as one text with each
        // source number right after the words it supports.
        <p className="wrap-break-word">
          {r.answer_blocks.map((b, i) => (
            <span key={i}>
              {i > 0 && !/^[,.;:)]/.test(b.text) && " "}
              {i === 0 ? b.text.charAt(0).toUpperCase() + b.text.slice(1) : b.text}
              {b.citations.map((c) => {
                n += 1;
                const quote = c.cited_text.length > 220 ? `${c.cited_text.slice(0, 219)}…` : c.cited_text;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onCitationClick(c)}
                    title={`${c.record_id} · ${c.docket} · ${c.section} · FR p.${c.page}\n“${quote}”`}
                    aria-label={`Source ${n}: ${c.record_id}, ${c.section}, page ${c.page}`}
                    className="ml-1 rounded bg-blue-50 px-1 align-super text-[10px] font-medium text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
                  >
                    {n}
                  </button>
                );
              })}
            </span>
          ))}
        </p>
      )}

      <DocumentCards documents={r.documents} />

      {r.note && <p className="text-xs text-stone-500 dark:text-stone-400">{r.note}</p>}
      <p className="border-t border-stone-100 pt-2 text-xs text-stone-400 dark:border-stone-800">
        {r.disclaimer} · {r.retrieval_ms} ms retrieval · {(r.total_ms / 1000).toFixed(1)} s total
      </p>
    </div>
  );
}
