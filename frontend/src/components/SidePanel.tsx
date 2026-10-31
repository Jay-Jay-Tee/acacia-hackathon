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
    <aside
      role="complementary"
      aria-label={content.title}
      className="fixed inset-0 z-40 flex flex-col bg-white shadow-xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[28rem] sm:border-l sm:border-stone-200 dark:bg-stone-900 dark:sm:border-stone-700"
    >
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-700">
        <h2 className="truncate text-sm font-semibold">{content.title}</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close panel"
          className="rounded px-2 py-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{content.body}</div>
    </aside>
  );
}
