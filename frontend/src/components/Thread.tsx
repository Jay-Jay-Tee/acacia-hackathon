import { useEffect, useRef } from "react";
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
  onClarify?: (turn: Turn, model: string) => void;
}

export function Thread({ turns, onCitationClick, onRetry, onClarify }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];

  // Keep the newest turn in view when one is added and when its answer arrives.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, last?.state]);

  return (
    <>
      <ol className="space-y-8 py-6" aria-live="polite">
        {turns.map((t) => (
          <li key={t.id} className="space-y-3">
            <UserBubble query={t.query} profile={t.profile} />
            {t.state === "loading" && <Pending />}
            {t.state === "error" && <ErrorBubble message={t.error ?? "Request failed."} onRetry={() => onRetry(t)} />}
            {t.state === "done" && t.response && (
              <AnswerBubble response={t.response} onCitationClick={onCitationClick} onClarify={onClarify && ((m) => onClarify(t, m))} />
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

function Pending() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-500" role="status">
      <span className="size-2 animate-pulse rounded-full bg-stone-400" />
      Searching the directives…
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
