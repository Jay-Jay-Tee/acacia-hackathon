import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Citation } from "../api/types";
import { splitTruncated, statusBadge } from "../lib/format";

const CARD_W = 352; // px, before clamping to the viewport
const GAP = 8;

/**
 * Inline [n] marker after a cited sentence. Hover or keyboard focus previews the exact source text;
 * click opens the source (P4's viewer via features.onCitationClick).
 */
export function CitationChip({ n, citation, onOpen }: { n: number; citation: Citation; onOpen: (c: Citation) => void }) {
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const id = useId();

  const show = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setOpen(true);
  }, []);
  // Small delay so the pointer can travel from the chip into the card.
  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 120);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  return (
    <>
      <button
        ref={chip}
        type="button"
        onClick={() => {
          setOpen(false);
          onOpen(citation);
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-label={`Source ${n}: ${citation.record_id || citation.docket}, ${citation.section}, page ${citation.page}`}
        aria-describedby={open ? id : undefined}
        className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded bg-blue-50 px-1 align-middle text-[11px] font-semibold text-blue-800 tabular-nums ring-blue-300 transition-colors hover:bg-blue-100 focus-visible:ring-2 focus-visible:outline-none dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-700 dark:hover:bg-blue-900"
      >
        {n}
      </button>
      {open && chip.current && (
        <PreviewCard id={id} n={n} citation={citation} anchor={chip.current} onEnter={show} onLeave={hide} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function PreviewCard(props: {
  id: string;
  n: number;
  citation: Citation;
  anchor: HTMLElement;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const { citation: c, anchor, onClose } = props;
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const quote = splitTruncated(c.cited_text);
  const badge = statusBadge(c.status);

  // Fixed-position card kept inside the viewport: above the chip if it fits, otherwise below.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const width = Math.min(CARD_W, window.innerWidth - 2 * GAP);
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - width / 2), window.innerWidth - width - GAP);
    const h = card.current?.offsetHeight ?? 0;
    const top = r.top - h - GAP >= GAP ? r.top - h - GAP : r.bottom + GAP;
    setPos({ top, left, width });
  }, [anchor]);

  // The card doesn't follow the chip, so close it when the page scrolls or resizes.
  useEffect(() => {
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={card}
      id={props.id}
      role="tooltip"
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
      style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { top: 0, left: 0, width: CARD_W, visibility: "hidden" }}
      className="fixed z-50 rounded-xl border border-stone-200 bg-white p-3 text-left text-sm shadow-xl dark:border-stone-700 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-stone-900 dark:text-stone-100">[{props.n}]</span>
        <span className="font-semibold text-stone-900 dark:text-stone-100">{c.record_id || c.docket}</span>
        {c.record_id && <span className="text-stone-500 dark:text-stone-400">{c.docket}</span>}
        <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${badge.tone}`}>{badge.label}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-stone-600 dark:text-stone-400">
        <dt>Section</dt>
        <dd className="text-stone-900 dark:text-stone-200">{c.section || "–"}</dd>
        <dt>Revision</dt>
        <dd className="text-stone-900 dark:text-stone-200">{c.revision_date || "–"}</dd>
        <dt>Citation</dt>
        <dd className="text-stone-900 tabular-nums dark:text-stone-200">
          {c.fr_cite || `FR p.${c.page}`}
          {c.pages && <span className="text-stone-500 dark:text-stone-400"> (notice pp. {c.pages})</span>}
        </dd>
      </dl>
      <blockquote className="mt-2 line-clamp-6 border-l-2 border-blue-300 pl-2.5 text-[13px] leading-snug wrap-break-word whitespace-pre-line text-stone-800 dark:border-blue-700 dark:text-stone-200">
        {quote.text}
      </blockquote>
      <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
        {quote.truncated ? "Quote shortened. " : ""}Click the marker to open the full source.
      </p>
    </div>,
    document.body,
  );
}
