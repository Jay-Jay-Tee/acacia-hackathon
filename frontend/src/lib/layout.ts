// The right-hand column: the documents rail and the side panel (source viewer, fleet check, timeline)
// share one width and surface, so the panel sits exactly over the rail instead of overrunning it.
// Tailwind only generates classes it sees written out, so the sm: variant is spelled out too; keep both in step.
export const RIGHT_COLUMN_WIDTH = "w-[22rem]";
export const RIGHT_COLUMN_WIDTH_SM = "sm:w-[22rem]";
export const RIGHT_COLUMN_SURFACE = "bg-stone-100/40 dark:bg-stone-900/30";
