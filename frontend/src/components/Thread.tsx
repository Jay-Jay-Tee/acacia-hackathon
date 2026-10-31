import { useEffect, useRef, useState } from "react";
import type { AskResponse, Citation } from "../api/types";
import { profileLabel, type Profile } from "../lib/profile";
import { AnswerBubble } from "./AnswerBubble";

export interface Turn {
  id: number;
  query: string;
  profile: Profile; // the profile as it was when this question was sent
  state: "loading" | "done" | "error";
  response?: AskResponse;
  error?: string;
}

interface Props {
  turns: Turn[];
  onCitationClick: (c: Citation) => void;
  onRetry: (turn: Turn) => void;
  /** Clarification answered: re-ask this turn's question with the exact model. */
  onPickModel: (turn: Turn, model: string) => void;
  /** Indexed passage count from /corpus, for the loading message. */
  passages?: number;
}

/** Scroll only the thread's own container (scrollIntoView would also scroll the page itself). */
function scrollWithin(el: HTMLElement | null | undefined, align: "start" | "end") {
  const box = el?.closest("main");
  if (!el || !box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const delta = align === "start" ? r.top - b.top - 16 : r.bottom - b.bottom;
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  box.scrollBy({ top: delta, behavior });
}

export function Thread({ turns, onCitationClick, onRetry, onPickModel, passages }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<number, HTMLLIElement>());
  const last = turns[turns.length - 1];

  // New question: scroll to the bottom so the waiting state is visible.
  useEffect(() => {
    scrollWithin(end.current, "end");
  }, [turns.length]);

  // Answer arrived: bring the question to the top so the answer reads from its start, not its disclaimer.
  useEffect(() => {
    if (last && last.state !== "loading") scrollWithin(items.current.get(last.id), "start");
  }, [last?.id, last?.state]);

  return (
    <>
      <ol className="space-y-8 py-6" aria-live="polite">
        {turns.map((t) => (
          <li
            key={t.id}
            ref={(el) => {
              if (el) items.current.set(t.id, el);
              else items.current.delete(t.id);
            }}
            className="space-y-3"
          >
            <UserBubble query={t.query} profile={t.profile} />
            {t.state === "loading" && <Pending passages={passages} />}
            {t.state === "error" && <ErrorBubble message={t.error ?? "Request failed."} onRetry={() => onRetry(t)} />}
            {t.state === "done" && t.response && (
              <AnswerBubble query={t.query} profile={t.profile} response={t.response} onCitationClick={onCitationClick} onPickModel={(m) => onPickModel(t, m)} />
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />
    </>
  );
}

function UserBubble({ query, profile }: { query: string; profile: Profile }) {
  const set = Boolean(profile.model || profile.serial);
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-[15px] wrap-break-word whitespace-pre-wrap text-white dark:bg-stone-100 dark:text-stone-900">
        {query}
      </p>
      <p className="text-xs text-stone-400">{set ? `for ${profileLabel(profile)}` : "no aircraft profile"}</p>
    </div>
  );
}

// Gate refusals come back in well under a second, so anything still waiting after that is the
// retrieval-to-answer step. The second message only claims what is happening by then.
const STAGE_2_MS = 1200;

/** Answer-shaped skeleton with an honest progress line and an elapsed timer. */
function Pending({ passages }: { passages?: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - t0), 200);
    return () => window.clearInterval(id);
  }, []);
  const stage =
    elapsed < STAGE_2_MS
      ? `Searching ${passages ? passages.toLocaleString() : "the indexed"} passages…`
      : "Checking applicability and writing a cited answer…";

  return (
    <div role="status" aria-live="polite" className="rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3.5 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <span aria-hidden className="size-2 rounded-full bg-blue-500 motion-safe:animate-pulse" />
        <span>{stage}</span>
        {elapsed >= 2000 && <span className="ml-auto tabular-nums">{(elapsed / 1000).toFixed(0)} s</span>}
      </div>
      <div aria-hidden className="mt-3 space-y-2 motion-safe:animate-pulse">
        <div className="h-3 w-11/12 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="h-3 w-full rounded bg-stone-200 dark:bg-stone-800" />
        <div className="h-3 w-4/5 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="mt-4 h-14 rounded-xl border border-stone-200 dark:border-stone-800" />
      </div>
    </div>
  );
}

function ErrorBubble({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      <p className="font-medium">Couldn't reach AD Finder.</p>
      <p className="mt-1 wrap-break-word opacity-80">{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium underline underline-offset-2">
        Try again
      </button>
    </div>
  );
}
