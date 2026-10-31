import type { CorpusStats } from "../api/types";
import type { Profile } from "../lib/profile";

export interface Example {
  title: string;
  hint: string;
  query: string;
  profile: Profile;
}

// The three demo paths from docs/TEAM_PLAN.md: a cited answer, a clarification and a refusal.
export const EXAMPLES: Example[] = [
  {
    title: "Fuel starvation on a P.68",
    hint: "Applicability checked for S/N 100",
    query: "fuel starvation uncommanded in-flight engine shutdown",
    profile: { model: "P.68", serial: "100" },
  },
  {
    title: "Engine fire switch on an A320",
    hint: "Ambiguous model: asks which variant",
    query: "engine fire switch self-releasing",
    profile: { model: "A320", serial: "" },
  },
  {
    title: "Something off-topic",
    hint: "Outside the corpus: refuses",
    query: "What is the best restaurant near Changi Airport?",
    profile: { model: "", serial: "" },
  },
];

export function EmptyState({ corpus, onExample }: { corpus: CorpusStats | null; onExample: (e: Example) => void }) {
  return (
    <div className="reveal mx-auto flex max-w-2xl flex-col items-center py-10 text-center [--reveal-delay:80ms] [--reveal-step:80ms] sm:py-16">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Which directives apply to your aircraft?</h2>
      <p className="mt-3 max-w-lg text-sm text-stone-500 dark:text-stone-400">
        Answers come only from FAA airworthiness-directive notices. Every sentence is cited, applicability is
        checked by rules, and it refuses when the documents don't support an answer.
      </p>
      {corpus && (
        <p className="mt-2 text-xs text-stone-400 tabular-nums">
          {corpus.records} notices · {corpus.federal_register_pages.toLocaleString()} Federal Register pages ·{" "}
          {corpus.passages.toLocaleString()} passages
        </p>
      )}
      <div className="reveal mt-8 grid w-full gap-3 [--reveal-delay:320ms] [--reveal-step:90ms] sm:grid-cols-3">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.title}
            type="button"
            onClick={() => onExample(ex)}
            className="group rounded-xl border border-stone-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
          >
            <p className="text-sm font-medium">{ex.title}</p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{ex.hint}</p>
            <p className="mt-3 line-clamp-2 text-xs text-stone-400 italic group-hover:text-stone-500">“{ex.query}”</p>
          </button>
        ))}
      </div>
    </div>
  );
}
