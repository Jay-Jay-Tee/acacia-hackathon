import { useState, type FormEvent } from "react";
import { ask } from "./api/client";
import { mocks } from "./api/mocks";
import type { AskResponse, Citation } from "./api/types";
import { SidePanel, SidePanelProvider, useSidePanel } from "./components/SidePanel";
import { features } from "./features";
import { safeUrl } from "./lib/safeUrl";

// Scaffold shell (#2): proves the client, types, mocks and side-panel slot work end to end.
// The chat layout (#3), answer bubble (#4) and documents rail (#5) replace the body below.

export default function App() {
  return (
    <SidePanelProvider>
      <Shell />
      <SidePanel />
    </SidePanelProvider>
  );
}

function Shell() {
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [res, setRes] = useState<AskResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const panel = useSidePanel();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      setRes(await ask({ query, model, serial }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function openCitation(c: Citation) {
    if (features.onCitationClick) return features.onCitationClick(c, panel);
    const url = safeUrl(c.url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  let n = 0;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-stone-900 dark:text-stone-100">
      <h1 className="text-xl font-semibold">AD Finder</h1>
      <p className="text-sm text-stone-500">Frontend scaffold. Chat layout lands in #3.</p>

      {import.meta.env.DEV && <MockPicker />}

      <form onSubmit={submit} className="my-4 grid gap-2 sm:grid-cols-[1fr_9rem_7rem_auto]">
        <input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask about an AD" maxLength={500} required />
        <input className={input} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" maxLength={40} />
        <input className={input} value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial" maxLength={40} />
        <button className="rounded-md bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={loading}>
          {loading ? "…" : "Ask"}
        </button>
      </form>

      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}

      {res && (
        <section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700">
          <p className="text-sm">
            <b>{res.status}</b> · mode {res.mode ?? "none"} · {res.retrieval_ms} ms / {res.total_ms} ms
          </p>
          {res.refusal_reason && <p>{res.refusal_reason}</p>}
          {res.note && <p className="text-sm text-stone-500">{res.note}</p>}
          {res.answer_blocks.map((b, i) => (
            <p key={i}>
              {b.text}
              {b.citations.map((c) => {
                n += 1;
                return (
                  <button key={n} type="button" onClick={() => openCitation(c)} title={c.cited_text} className="ml-1 text-xs text-blue-700 dark:text-blue-300">
                    [{n}]
                  </button>
                );
              })}
            </p>
          ))}
          <ul className="text-sm text-stone-500">
            {res.documents.map((d) => (
              <li key={d.ad_id}>
                {d.docket} · {d.status} · {d.applicability?.result ?? "no applicability check"}
              </li>
            ))}
          </ul>
          <p className="text-xs text-stone-500">{res.disclaimer}</p>
        </section>
      )}
    </main>
  );
}

function MockPicker() {
  const current = new URLSearchParams(window.location.search).get("mock");
  return (
    <p className="mt-2 flex flex-wrap gap-2 text-xs">
      <span className="text-stone-500">Dev mocks:</span>
      <a href="?" className={current ? "underline" : "font-semibold"}>live backend</a>
      {Object.keys(mocks).map((name) => (
        <a key={name} href={`?mock=${name}`} className={current === name ? "font-semibold" : "underline"}>
          {name}
        </a>
      ))}
    </p>
  );
}

const input = "rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
