import { useEffect, useState } from "react";
import { getFacets } from "../api/client";
import type { DocStatus, Facets, Filters } from "../api/types";

// #25: corpus filters (status, make, product type, publish year). Sent with every /ask as `filters`;
// the backend applies them as a pre-filter and says so in the answer's notices.

const KEY = "adf.filters";
const STATUS_LABEL: Record<DocStatus, string> = { proposed: "Proposed", final: "Final AD", withdrawn: "Withdrawn", not_ad: "Not an AD" };

export function useFilters(): [Filters, (f: Filters) => void] {
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      if (activeCount(filters)) localStorage.setItem(KEY, JSON.stringify(filters));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: filters just aren't remembered */
    }
  }, [filters]);
  return [filters, setFilters];
}

export function activeCount(f: Filters): number {
  return (f.status?.length ? 1 : 0) + (f.make ? 1 : 0) + (f.product_type ? 1 : 0) + (f.published_from || f.published_to ? 1 : 0);
}

const field = "rounded-md border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900";

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const n = activeCount(filters);

  useEffect(() => {
    if (!open || facets) return;
    const ctl = new AbortController();
    getFacets(ctl.signal).then(setFacets, () => undefined);
    return () => ctl.abort();
  }, [open, facets]);

  const years = facets?.published.min && facets.published.max
    ? Array.from({ length: +facets.published.max.slice(0, 4) - +facets.published.min.slice(0, 4) + 1 }, (_, i) => String(+facets.published.max!.slice(0, 4) - i))
    : [];
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleStatus = (s: DocStatus) => {
    const cur = new Set(filters.status ?? []);
    if (cur.has(s)) cur.delete(s);
    else cur.add(s);
    set({ status: [...cur] });
  };

  return (
    <div className="mb-2 text-xs">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`rounded-full border px-2.5 py-1 font-medium ${n ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200" : "border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"}`}
        >
          Filters{n ? ` · ${n}` : ""} {open ? "▴" : "▾"}
        </button>
        {n > 0 && (
          <button type="button" onClick={() => onChange({})} className="text-stone-500 underline underline-offset-2 hover:text-stone-800 dark:hover:text-stone-200">
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
            {(Object.keys(STATUS_LABEL) as DocStatus[]).map((s) => {
              const on = filters.status?.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStatus(s)}
                  className={`rounded-full border px-2 py-0.5 ${on ? "border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100" : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300"}`}
                >
                  {STATUS_LABEL[s]}
                  {facets && <span className="ml-1 text-stone-400 tabular-nums">{facets.status[s]}</span>}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5">
            <span className="text-stone-500">Make</span>
            <input list="adf-makes" value={filters.make ?? ""} onChange={(e) => set({ make: e.target.value })} placeholder="any" maxLength={60} className={`${field} w-36`} />
            <datalist id="adf-makes">{facets?.makes.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-stone-500">Type</span>
            <select value={filters.product_type ?? ""} onChange={(e) => set({ product_type: e.target.value })} className={field}>
              <option value="">any</option>
              {facets?.product_types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-stone-500">Published</span>
            <select value={filters.published_from?.slice(0, 4) ?? ""} onChange={(e) => set({ published_from: e.target.value ? `${e.target.value}-01-01` : undefined })} className={field} aria-label="Published from year">
              <option value="">from</option>
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <select value={filters.published_to?.slice(0, 4) ?? ""} onChange={(e) => set({ published_to: e.target.value ? `${e.target.value}-12-31` : undefined })} className={field} aria-label="Published to year">
              <option value="">to</option>
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
