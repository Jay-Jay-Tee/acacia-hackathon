// The right-hand column: the documents rail and the side panel (source viewer, fleet check, timeline)
// share one width and surface, so the panel sits exactly over the rail instead of overrunning it.
//
// The width is user-resizable (drag the left edge, see ResizeHandle). It lives in one CSS variable,
// --right-col, on <html>, so both elements follow the same drag; the clamp() keeps it sane if the window
// shrinks later. Tailwind only generates classes it sees written out, so the sm: variant is spelled out
// too; keep both in step.
export const RIGHT_COLUMN_WIDTH = "w-[clamp(18rem,var(--right-col,22rem),60vw)]";
export const RIGHT_COLUMN_WIDTH_SM = "sm:w-[clamp(18rem,var(--right-col,22rem),60vw)]";
export const RIGHT_COLUMN_SURFACE = "bg-stone-100/40 dark:bg-stone-900/30";

const KEY = "adf.rightColumnWidth";
const REM = 16;
export const RIGHT_COLUMN_DEFAULT = 22 * REM;
export const RIGHT_COLUMN_MIN = 18 * REM;
/** Same bounds as the CSS clamp(): never wider than 60% of the window (and never below the minimum). */
export const rightColumnMax = () => Math.max(RIGHT_COLUMN_MIN, Math.floor(window.innerWidth * 0.6));
export const clampRightColumn = (px: number) => Math.round(Math.min(Math.max(px, RIGHT_COLUMN_MIN), rightColumnMax()));

export function setRightColumnWidth(px: number, persist = false) {
  const w = clampRightColumn(px);
  document.documentElement.style.setProperty("--right-col", `${w}px`);
  if (persist) {
    try {
      if (w === RIGHT_COLUMN_DEFAULT) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(w));
    } catch {
      /* private mode: the width just isn't remembered */
    }
  }
  return w;
}

export function getRightColumnWidth(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--right-col"));
  return Number.isFinite(v) ? clampRightColumn(v) : RIGHT_COLUMN_DEFAULT;
}

/** Restore the saved width before first render (called once from main.tsx). */
export function restoreRightColumnWidth() {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved > 0) setRightColumnWidth(saved);
  } catch {
    /* ignore */
  }
}
