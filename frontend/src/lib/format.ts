import type { ApplicabilityResult, DocStatus } from "../api/types";

/** "6.1 ms" below a second, "4.35 s" above. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  return ms < 1000 ? `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Short badge text and colour for a notice's regulatory status. Shared by the answer and the documents rail. */
export const STATUS_BADGE: Record<DocStatus, { label: string; tone: string }> = {
  proposed: { label: "Proposed (NPRM)", tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  final: { label: "Final AD", tone: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  withdrawn: { label: "Withdrawn", tone: "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300" },
  not_ad: { label: "Not an AD", tone: "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300" },
};

export function statusBadge(status: string) {
  return STATUS_BADGE[status as DocStatus] ?? { label: status || "Unknown status", tone: STATUS_BADGE.withdrawn.tone };
}

/** The backend cuts long extractive quotes and appends "..."; report that instead of hiding it. */
export function splitTruncated(text: string): { text: string; truncated: boolean } {
  const t = text.trimEnd();
  return /(\.\.\.|…)$/.test(t) ? { text: t.replace(/\s*(\.\.\.|…)$/, ""), truncated: true } : { text: t, truncated: false };
}

/**
 * Applicability verdict styles. Deliberately no green: "does not apply" is the all-clear, but a green
 * APPLIES would read as "safe". APPLIES is a strong blue (this one is yours), UNKNOWN / AMBIGUOUS amber (check by hand).
 */
export const VERDICT: Record<ApplicabilityResult, { label: string; tone: string; dot: string }> = {
  APPLIES: { label: "Applies", tone: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100", dot: "bg-blue-600 dark:bg-blue-400" },
  DOES_NOT_APPLY: { label: "Does not apply", tone: "border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100", dot: "bg-stone-500 dark:bg-stone-400" },
  UNKNOWN: { label: "Unknown", tone: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100", dot: "bg-amber-500" },
  AMBIGUOUS: { label: "Ambiguous model", tone: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100", dot: "bg-amber-500" },
};

export function verdictStyle(result: string) {
  return VERDICT[result as ApplicabilityResult] ?? VERDICT.UNKNOWN;
}
