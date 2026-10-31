import { useCallback, useEffect, useRef, useState } from "react";
import { ask, getCorpus } from "./api/client";
import { mocks } from "./api/mocks";
import type { Citation, CorpusStats } from "./api/types";
import { Composer } from "./components/Composer";
import { EmptyState, type Example } from "./components/EmptyState";
import { SidePanel, SidePanelProvider, useSidePanel } from "./components/SidePanel";
import { Thread, type Turn } from "./components/Thread";
import { features } from "./features";
import { useProfile, type Profile } from "./lib/profile";
import { safeUrl } from "./lib/safeUrl";
import { useTheme, type Theme } from "./lib/theme";

export default function App() {
  return (
    <SidePanelProvider>
      <Chat />
      <SidePanel />
    </SidePanelProvider>
  );
}

function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [profile, setProfile] = useProfile();
  const [corpus, setCorpus] = useState<CorpusStats | null>(null);
  const [theme, cycleTheme] = useTheme();
  const nextId = useRef(1);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useSidePanel();
  const busy = turns.some((t) => t.state === "loading");

  useEffect(() => {
    const ctl = new AbortController();
    getCorpus(ctl.signal).then(setCorpus, () => setCorpus(null)); // the header just omits the stats if this fails
    return () => ctl.abort();
  }, []);

  const run = useCallback(async (id: number, query: string, p: Profile) => {
    const patch = (t: Partial<Turn>) => setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, ...t } : x)));
    try {
      patch({ state: "done", response: await ask({ query, model: p.model, serial: p.serial }) });
    } catch (err) {
      patch({ state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const send = useCallback(
    (query: string, p: Profile = profile) => {
      const id = nextId.current++;
      setTurns((ts) => [...ts, { id, query, profile: p, state: "loading" }]);
      void run(id, query, p);
    },
    [profile, run],
  );

  function retry(t: Turn) {
    setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, state: "loading", error: undefined } : x)));
    void run(t.id, t.query, t.profile);
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
    setTurns([]);
    input.current?.focus();
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <span aria-hidden className="grid size-6 place-items-center rounded-md bg-stone-900 text-[11px] text-white dark:bg-stone-100 dark:text-stone-900">AD</span>
              AD Finder
            </h1>
            {corpus && (
              <p className="truncate text-xs text-stone-500 tabular-nums dark:text-stone-400">
                {corpus.records} FAA notices · {corpus.federal_register_pages.toLocaleString()} pages · cited answers only
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {turns.length > 0 && (
              <button type="button" onClick={newChat} className={iconBtn}>
                New chat
              </button>
            )}
            <button type="button" onClick={cycleTheme} className={iconBtn} aria-label={`Theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
              <ThemeIcon theme={theme} />
            </button>
          </div>
        </div>
        {import.meta.env.DEV && <MockPicker />}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4">
          {turns.length === 0 ? (
            <EmptyState corpus={corpus} onExample={runExample} />
          ) : (
            <Thread turns={turns} onCitationClick={openCitation} onRetry={retry} />
          )}
        </div>
      </main>

      <footer className="bg-linear-to-t from-stone-50 from-60% to-transparent pt-2 dark:from-stone-950">
        <div className="mx-auto max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Composer profile={profile} onProfileChange={setProfile} onSend={(q) => send(q)} busy={busy} inputRef={input} />
        </div>
      </footer>
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
  "rounded-md px-2 py-1.5 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800";
