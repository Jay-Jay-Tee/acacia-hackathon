import type { AskResponse, Citation } from "../api/types";

// Minimal answer rendering so the chat layout (#3) is usable end to end.
// #4 replaces this with the full bubble (hover previews, status designs, clarify-to-reask, mode pill)
// and #5 moves the documents into the side rail.

const HEADLINE: Record<AskResponse["status"], string> = {
  answered: "Answer",
  needs_clarification: "Needs clarification",
  refused: "Cannot answer",
};

export function AnswerBubble({ response: r, onCitationClick }: { response: AskResponse; onCitationClick: (c: Citation) => void }) {
  let n = 0;
  return (
    <div className="space-y-3 rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-[15px] dark:border-stone-800 dark:bg-stone-900">
      <p className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{HEADLINE[r.status]}</p>
      {r.refusal_reason && <p className="wrap-break-word">{r.refusal_reason}</p>}
      {r.notices.map((t) => (
        <p key={t} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t}
        </p>
      ))}
      {r.answer_blocks.length > 0 && (
        <div className="space-y-2 wrap-break-word">
          {r.answer_blocks.map((b, i) => (
            <p key={i}>
              {b.text}
              {b.citations.map((c) => {
                n += 1;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onCitationClick(c)}
                    title={`${c.record_id} · ${c.docket} · ${c.section} · FR p.${c.page}`}
                    className="ml-1 rounded bg-blue-50 px-1 align-super text-[10px] font-medium text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
                  >
                    {n}
                  </button>
                );
              })}
            </p>
          ))}
        </div>
      )}
      {r.documents.length > 0 && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {r.documents.length} matching document{r.documents.length === 1 ? "" : "s"}:{" "}
          {r.documents.map((d) => d.docket).join(", ")}
        </p>
      )}
      {r.note && <p className="text-xs text-stone-500 dark:text-stone-400">{r.note}</p>}
      <p className="border-t border-stone-100 pt-2 text-xs text-stone-400 dark:border-stone-800">
        {r.disclaimer} · {r.retrieval_ms} ms retrieval · {r.total_ms} ms total
      </p>
    </div>
  );
}
