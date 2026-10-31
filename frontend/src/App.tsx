import { useCallback, useEffect, useRef, useState } from "react";
import { ask, getCorpus } from "./api/client";
import { mocks } from "./api/mocks";
import type { Citation, CorpusStats, Filters } from "./api/types";
import { ChatHistory } from "./components/ChatHistory";
import { Composer } from "./components/Composer";
import { DocumentsRail } from "./components/DocumentsRail";
import { EmptyState, type Example } from "./components/EmptyState";
import { Logo } from "./components/Logo";
import { SidePanel, SidePanelProvider, useSidePanel } from "./components/SidePanel";
import { Thread, type Turn } from "./components/Thread";
import { features } from "./features";
import { FilterBar, activeCount, useFilters } from "./features/FilterBar";
import { maxTurnId, useChatHistory } from "./lib/history";
import { useProfile, type Profile } from "./lib/profile";
import { RIGHT_COLUMN_SURFACE, RIGHT_COLUMN_WIDTH } from "./lib/layout";
import { safeUrl } from "./lib/safeUrl";
import { useTheme, type Theme } from "./lib/theme";
import { useMediaQuery } from "./lib/useMediaQuery";

export default function App() {
  return (
    <SidePanelProvider>
      <Chat />
      <SidePanel />
    </SidePanelProvider>
  );
}

function Chat() {
  const history = useChatHistory();
  const turns = history.active?.turns ?? [];
  const [profile, setProfile] = useProfile();
  const [filters, setFilters] = useFilters();
  const [corpus, setCorpus] = useState<CorpusStats | null>(null);
  const [theme, cycleTheme] = useTheme();
  const [drawer, setDrawer] = useState(false);
  const nextId = useRef(maxTurnId(history.chats) + 1);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useSidePanel();
  const busy = turns.some((t) => t.state === "loading");
  // Documents rail: on wide screens it shows the answer picked in the thread, else the latest one with a response.
  const railShown = useMediaQuery("(min-width: 1280px)");
  const [railTurnId, setRailTurnId] = useState<number | null>(null);
  const answered = turns.filter((t) => t.response);
  const railTurn = answered.find((t) => t.id === railTurnId) ?? answered[answered.length - 1];
  const openTimeline = features.openRevisionTimeline && ((adId: number) => features.openRevisionTimeline?.(adId, panel));
  const { updateTurns, startChat } = history;

  useEffect(() => {
    const ctl = new AbortController();
    getCorpus(ctl.signal).then(setCorpus, () => setCorpus(null)); // the header just omits the stats if this fails
    return () => ctl.abort();
  }, []);

  // Cmd+K (Mac) / Ctrl+K anywhere focuses the question box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback(
    async (chatId: string, id: number, query: string, p: Profile, f?: Filters) => {
      const patch = (t: Partial<Turn>) => updateTurns(chatId, (ts) => ts.map((x) => (x.id === id ? { ...x, ...t } : x)));
      try {
        patch({ state: "done", response: await ask({ query, model: p.model, serial: p.serial, filters: f }) });
      } catch (err) {
        patch({ state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },
    [updateTurns],
  );

  const send = useCallback(
    (query: string, p: Profile = profile) => {
      const chatId = history.activeId ?? startChat(query);
      const id = nextId.current++;
      setRailTurnId(null); // a new question takes over the rail
      const f = activeCount(filters) ? filters : undefined;
      updateTurns(chatId, (ts) => [...ts, { id, query, profile: p, filters: f, state: "loading" }]);
      void run(chatId, id, query, p, f);
    },
    [profile, filters, run, history.activeId, startChat, updateTurns],
  );

  function retry(t: Turn) {
    const chatId = history.activeId;
    if (!chatId) return;
    updateTurns(chatId, (ts) => ts.map((x) => (x.id === t.id ? { ...x, state: "loading", error: undefined } : x)));
    void run(chatId, t.id, t.query, t.profile, t.filters);
  }

  function pickModel(t: Turn, model: string) {
    const p = { ...t.profile, model };
    setProfile(p);
    send(t.query, p);
  }

  function runExample(ex: Example) {
    setProfile(ex.profile);
    send(ex.query, ex.profile);
  }

  function openCitation(c: Citation) {
    if (features.onCitationClick) return features.onCitationClick(c, panel);
    const url = safeUrl(c.url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function newChat() {
    history.newChat();
    setDrawer(false);
    input.current?.focus();
  }

  function openChat(id: string) {
    history.open(id);
    setDrawer(false);
  }

  const historyList = (
    <ChatHistory chats={history.chats} activeId={history.activeId} onOpen={openChat} onNew={newChat} onDelete={history.remove} />
  );

  return (
    <div className="flex h-dvh">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-stone-200 bg-stone-100/60 lg:block dark:border-stone-800 dark:bg-stone-900/40">
        {historyList}
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Saved chats">
          <button type="button" aria-label="Close history" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-stone-50 shadow-xl dark:bg-stone-950">{historyList}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => setDrawer(true)} className={`${iconBtn} lg:hidden`} aria-label="Open chat history">
                <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <Logo />
              <div className="min-w-0">
                <h1 className="text-[16px] leading-tight font-semibold tracking-tight">Applicable</h1>
                <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                  Does this directive apply to your aircraft? Cited, rule-checked answers.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {features.openFleetCheck && (
                <button type="button" onClick={() => features.openFleetCheck?.(panel)} className={`${iconBtn} font-medium`}>
                  Fleet check
                </button>
              )}
              {turns.length > 0 && (
                <button type="button" onClick={newChat} className={`${iconBtn} hidden sm:inline-flex`}>
                  New chat
                </button>
              )}
              <button type="button" onClick={cycleTheme} className={iconBtn} aria-label={`Theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
                <ThemeIcon theme={theme} />
              </button>
            </div>
          </div>
          {corpus && (
            <div className="mx-auto max-w-3xl px-4 pb-2.5">
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500 tabular-nums dark:text-stone-300/70">
                <span>
                  <b className="font-semibold text-stone-700 dark:text-stone-200">{corpus.records}</b> FAA notices
                </span>
                <span>
                  <b className="font-semibold text-stone-700 dark:text-stone-200">{corpus.federal_register_pages.toLocaleString()}</b> pages
                </span>
              </p>
            </div>
          )}
          {import.meta.env.DEV && <MockPicker />}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4">
            {turns.length === 0 ? (
              <EmptyState corpus={corpus} onExample={runExample} />
            ) : (
              <Thread
                turns={turns}
                onCitationClick={openCitation}
                onRetry={retry}
                onPickModel={pickModel}
                passages={corpus?.passages}
                railShown={railShown}
                railTurnId={railTurn?.id}
                onShowDocuments={(t) => setRailTurnId(t.id)}
                onOpenTimeline={openTimeline}
              />
            )}
          </div>
        </main>

        <footer className="bg-linear-to-t from-stone-50 from-60% to-transparent pt-2 dark:from-stone-950">
          <div className="mx-auto max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FilterBar filters={filters} onChange={setFilters} />
            <Composer profile={profile} onProfileChange={setProfile} onSend={(q) => send(q)} busy={busy} inputRef={input} hasHistory={turns.length > 0} />
          </div>
        </footer>
      </div>

      {/* desktop documents rail */}
      {railShown && turns.length > 0 && (
        <div className={`${RIGHT_COLUMN_WIDTH} ${RIGHT_COLUMN_SURFACE} shrink-0 border-l border-stone-200 dark:border-stone-800`}>
          <DocumentsRail turn={railTurn} onOpenTimeline={openTimeline} />
        </div>
      )}
    </div>
  );
}

function MockPicker() {
  const current = new URLSearchParams(window.location.search).get("mock");
  return (
    <p className="mx-auto flex max-w-3xl flex-wrap gap-x-3 gap-y-1 px-4 pb-2 text-[11px] text-stone-400">
      <span>dev mocks:</span>
      <a href="?" className={current ? "hover:underline" : "font-semibold text-stone-600 dark:text-stone-300"}>live</a>
      {Object.keys(mocks).map((name) => (
        <a key={name} href={`?mock=${name}`} className={current === name ? "font-semibold text-stone-600 dark:text-stone-300" : "hover:underline"}>
          {name}
        </a>
      ))}
    </p>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = { "aria-hidden": true, viewBox: "0 0 24 24", className: "size-4", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (theme === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

const iconBtn =
  "inline-flex items-center rounded-md px-2 py-1.5 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800";
