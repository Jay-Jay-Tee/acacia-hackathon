import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RIGHT_COLUMN_SURFACE, RIGHT_COLUMN_WIDTH_SM } from "../lib/layout";

// A single right-hand slot that feature components (P4: source viewer, fleet check,
// revision timeline) render into, so they never need to edit P1's layout files.
//
//   const panel = useSidePanel();
//   panel.open({ title: "Source", body: <SourceViewer citation={c} /> });

export interface PanelContent {
  title: string;
  body: ReactNode;
}

export interface SidePanelApi {
  open: (content: PanelContent) => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<(SidePanelApi & { content: PanelContent | null }) | null>(null);

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<PanelContent | null>(null);
  const close = useCallback(() => setContent(null), []);
  const value = useMemo(() => ({ open: setContent, close, isOpen: content !== null, content }), [content, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSidePanel(): SidePanelApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSidePanel must be used inside <SidePanelProvider>");
  return ctx;
}

/** The slot itself. Renders nothing until something calls `open()`. */
export function SidePanel() {
  const ctx = useContext(Ctx);
  const content = ctx?.content;
  const close = ctx?.close;

  useEffect(() => {
    if (!content || !close) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content, close]);

  if (!content || !close) return null;
  return (
    <aside
      role="complementary"
      aria-label={content.title}
      className={`fixed inset-0 z-40 flex flex-col bg-stone-50 shadow-[-12px_0_32px_-16px_rgb(0_0_0/0.25)] sm:inset-y-0 sm:right-0 sm:left-auto ${RIGHT_COLUMN_WIDTH_SM} sm:border-l sm:border-stone-200 dark:bg-stone-950 dark:sm:border-stone-800`}
    >
      {/* Same surface and header rhythm as the documents rail it covers. */}
      <div className={`flex min-h-0 flex-1 flex-col ${RIGHT_COLUMN_SURFACE}`}>
        <header className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <h2 className="truncate text-sm font-semibold">{content.title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close panel"
            title="Close (Esc)"
            className="grid size-7 shrink-0 place-items-center rounded-md text-stone-500 hover:bg-stone-200/70 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{content.body}</div>
      </div>
    </aside>
  );
}
