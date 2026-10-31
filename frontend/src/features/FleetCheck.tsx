import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ApplicabilityResult } from "../api/types";
import { safeUrl } from "../lib/safeUrl";
import { checkFleet, type FleetResponse } from "./fleetApi";
import { parseFleetCsv } from "./fleetCsv";

// CAMO-planner workflow: paste or upload `model,serial` rows, get every matching AD/NPRM per aircraft with
// the verdict and trace, filterable by verdict. Rendered inside P1's <SidePanel>; plain text only.

const VERDICTS: { key: ApplicabilityResult; label: string; badge: string }[] = [
  { key: "APPLIES", label: "Applies", badge: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
  { key: "AMBIGUOUS", label: "Ambiguous", badge: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200" },
  { key: "UNKNOWN", label: "Unknown", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  { key: "DOES_NOT_APPLY", label: "Does not apply", badge: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200" },
];
const LABEL = Object.fromEntries(VERDICTS.map((v) => [v.key, v])) as Record<ApplicabilityResult, (typeof VERDICTS)[number]>;
const MAX_FILE_BYTES = 1_000_000;
const SAMPLE = "model,serial\nP.68,100\nP.68,200\nAS350B3,1\nA320,1";

export function FleetCheck() {
  const [text, setText] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<FleetResponse | null>(null);
  const [filter, setFilter] = useState<ApplicabilityResult | "ALL">("ALL");
  const [latestOnly, setLatestOnly] = useState(true);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  async function run() {
    const { rows, errors } = parseFleetCsv(text);
    setParseErrors(errors);
    setError(null);
    if (rows.length === 0) {
      setRes(null);
      setError("Add at least one `model,serial` row.");
      return;
    }
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setLoading(true);
    try {
      setRes(await checkFleet(rows, ctrl.current.signal));
      setFilter("ALL");
    } catch (e) {
      if (!ctrl.current.signal.aborted) setError(e instanceof Error ? e.message : "Fleet check failed");
    } finally {
      setLoading(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("File is larger than 1 MB.");
      return;
    }
    setText(await file.text());
    setError(null);
  }

  // counts follow the "latest revisions only" toggle, so chips always match the table
  const counts = useMemo(() => {
    const c: Record<ApplicabilityResult, number> = { APPLIES: 0, AMBIGUOUS: 0, UNKNOWN: 0, DOES_NOT_APPLY: 0 };
    let hidden = 0;
    for (const a of res?.aircraft ?? []) {
      for (const r of a.results) {
        if (latestOnly && !r.is_latest) hidden++;
        else c[r.applicability.result]++;
      }
    }
    return { c, hidden };
  }, [res, latestOnly]);

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <label htmlFor="fleet-input" className="block text-xs font-medium">
          Aircraft (one per line: model,serial)
        </label>
        <textarea
          id="fleet-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={SAMPLE}
          className="w-full rounded border border-stone-300 bg-transparent p-2 font-mono text-xs dark:border-stone-600"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="rounded-md bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50"
          >
            {loading ? "Checking…" : "Check fleet"}
          </button>
          <label className="cursor-pointer rounded-md border border-stone-300 px-3 py-1.5 dark:border-stone-600">
            Upload CSV
            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} className="sr-only" />
          </label>
          <button type="button" onClick={() => setText(SAMPLE)} className="text-xs underline">
            Use sample
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
      {parseErrors.length > 0 && (
        <ul role="status" className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {parseErrors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {res && (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by verdict">
            <button type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")} className={chip(filter === "ALL")}>
              All
            </button>
            {VERDICTS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={filter === v.key}
                onClick={() => setFilter(v.key)}
                className={chip(filter === v.key)}
              >
                {v.label} {counts.c[v.key]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
            Latest revision of each docket only
            {latestOnly && counts.hidden > 0 && <span className="text-stone-500">({counts.hidden} superseded hidden)</span>}
          </label>

          <div className="space-y-4">
            {res.aircraft.map((a, ai) => {
              const rows = a.results.filter(
                (r) => (!latestOnly || r.is_latest) && (filter === "ALL" || r.applicability.result === filter),
              );
              if (filter !== "ALL" && a.status === "ok" && rows.length === 0) return null;
              return (
                <section key={ai} aria-label={`${a.model} ${a.serial ?? ""}`}>
                  <h3 className="text-xs font-semibold">
                    {a.model || "(no model)"} · S/N {a.serial ?? "not given"}
                  </h3>
                  {a.status !== "ok" && <p className="py-1 text-xs text-amber-800 dark:text-amber-300">{a.note}</p>}
                  {a.status === "ok" && rows.length === 0 && (
                    <p className="py-1 text-xs text-stone-500">No documents to show with the current filters.</p>
                  )}
                  {rows.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[26rem] border-collapse text-left text-xs">
                        <thead className="text-stone-500">
                          <tr>
                            <th className="py-1 pr-2 font-medium">Document</th>
                            <th className="py-1 pr-2 font-medium">Verdict</th>
                            <th className="py-1 font-medium">Why</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const link = safeUrl(r.url);
                            const id = r.ad_number || r.record_id || r.docket;
                            const v = LABEL[r.applicability.result];
                            return (
                              <tr key={r.ad_id} className="border-t border-stone-200 align-top dark:border-stone-700">
                                <td className="py-1.5 pr-2">
                                  <div className="font-medium">
                                    {link ? (
                                      <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
                                        {id}
                                      </a>
                                    ) : (
                                      id
                                    )}
                                  </div>
                                  <div className="text-stone-500">{r.status_label}</div>
                                  {!r.is_latest && <div className="text-amber-800 dark:text-amber-300">Superseded revision</div>}
                                  <div className="mt-0.5 line-clamp-2 text-stone-600 dark:text-stone-400">{r.subject}</div>
                                </td>
                                <td className="py-1.5 pr-2">
                                  <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${v.badge}`}>{v.label}</span>
                                </td>
                                <td className="py-1.5">
                                  <details>
                                    <summary className="cursor-pointer underline">Trace</summary>
                                    <ol className="mt-1 list-decimal space-y-1 pl-4">
                                      {r.applicability.trace.map((t, i) => (
                                        <li key={i}>{t}</li>
                                      ))}
                                    </ol>
                                    {r.applicability.candidates && r.applicability.candidates.length > 0 && (
                                      <p className="mt-1">Specify one of: {r.applicability.candidates.join(", ")}</p>
                                    )}
                                  </details>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <p className="text-xs text-stone-500">{res.disclaimer}</p>
        </>
      )}
    </div>
  );
}

function chip(active: boolean): string {
  return `rounded-full border px-2.5 py-1 text-xs ${
    active ? "border-blue-700 bg-blue-700 text-white" : "border-stone-300 dark:border-stone-600"
  }`;
}
