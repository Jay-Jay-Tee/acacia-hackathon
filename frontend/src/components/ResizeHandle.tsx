import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  RIGHT_COLUMN_DEFAULT,
  RIGHT_COLUMN_MIN,
  getRightColumnWidth,
  rightColumnMax,
  setRightColumnWidth,
} from "../lib/layout";

const STEP = 16; // px per arrow key

/**
 * Drag handle on the left edge of the right-hand column (documents rail or side panel).
 * The column is flush with the window's right edge, so its width is simply innerWidth - pointer x.
 * Double-click resets; arrow keys / Home / End resize from the keyboard.
 */
export function ResizeHandle({ label = "Resize side panel" }: { label?: string }) {
  const [width, setWidth] = useState(getRightColumnWidth);
  const [dragging, setDragging] = useState(false);
  const restore = useRef<() => void>(() => {});

  // Keep aria-valuenow in step when the other handle (rail vs panel) moves the shared width.
  useEffect(() => {
    const sync = () => setWidth(getRightColumnWidth());
    window.addEventListener("adf:right-col", sync);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("adf:right-col", sync);
      window.removeEventListener("resize", sync);
      restore.current();
    };
  }, []);

  function apply(px: number, persist = false) {
    setWidth(setRightColumnWidth(px, persist));
    window.dispatchEvent(new Event("adf:right-col"));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    // No text selection or I-beam flicker while dragging across the page.
    const { userSelect, cursor } = document.body.style;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    restore.current = () => {
      document.body.style.userSelect = userSelect;
      document.body.style.cursor = cursor;
    };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging) apply(window.innerWidth - e.clientX);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    restore.current();
    apply(window.innerWidth - e.clientX, true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // The handle is on the left edge, so ← widens the column and → narrows it.
    const next =
      e.key === "ArrowLeft" ? width + STEP
      : e.key === "ArrowRight" ? width - STEP
      : e.key === "Home" ? RIGHT_COLUMN_MIN
      : e.key === "End" ? rightColumnMax()
      : null;
    if (next === null) return;
    e.preventDefault();
    apply(next, true);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={RIGHT_COLUMN_MIN}
      aria-valuemax={rightColumnMax()}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => apply(RIGHT_COLUMN_DEFAULT, true)}
      onKeyDown={onKeyDown}
      data-dragging={dragging || undefined}
      className="group/handle absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none sm:block"
    >
      {/* the visible line: hairline at rest, accent while hovered, focused or dragged */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-[background-color,width] duration-150 group-hover/handle:w-0.5 group-hover/handle:bg-blue-400/70 group-focus-visible/handle:w-0.5 group-focus-visible/handle:bg-blue-500 group-data-dragging/handle:w-0.5 group-data-dragging/handle:bg-blue-500"
      />
      {/* grip */}
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 flex h-9 w-2.5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full border border-stone-300 bg-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100 group-data-dragging/handle:opacity-100 dark:border-stone-600 dark:bg-stone-800"
      >
        <span className="size-0.5 rounded-full bg-stone-400" />
        <span className="size-0.5 rounded-full bg-stone-400" />
        <span className="size-0.5 rounded-full bg-stone-400" />
      </span>
    </div>
  );
}
