import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
    <>
      {/* dims the page so the panel reads as a layer over it; click to close */}
      <button type="button" aria-label="Close panel" tabIndex={-1} onClick={close} className="fixed inset-0 z-30 hidden cursor-default bg-stone-950/30 sm:block dark:bg-black/50" />
      <aside
        role="complementary"
        aria-label={content.title}
        className="fixed inset-0 z-40 flex flex-col bg-stone-50 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[min(42rem,92vw)] sm:border-l sm:border-stone-200 dark:bg-stone-950 dark:sm:border-stone-800"
      >
        <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-3.5 dark:border-stone-800 dark:bg-stone-900">
          <h2 className="truncate text-[15px] font-semibold tracking-tight">{content.title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close panel"
            title="Close (Esc)"
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{content.body}</div>
      </aside>
    </>
  );
}
