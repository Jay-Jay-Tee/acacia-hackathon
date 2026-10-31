import { useEffect, useRef, useState } from "react";
import { getFacets } from "../api/client";
import type { DocStatus, Facets, Filters } from "../api/types";

// #25: corpus filters (status, product type, publish date, make). Sent with every /ask as `filters`;
// the backend applies them as a pre-filter and says so in the answer's notices.

const KEY = "adf.filters";

const STATUSES: { value: DocStatus; label: string; dot: string }[] = [
  { value: "proposed", label: "Proposed", dot: "bg-amber-500" },
  { value: "final", label: "Final AD", dot: "bg-emerald-500" },
  { value: "withdrawn", label: "Withdrawn", dot: "bg-stone-400" },
  { value: "not_ad", label: "Not an AD", dot: "bg-stone-400" },
];

const THIS_YEAR = new Date().getFullYear();
const PERIODS: { label: string; from?: string; to?: string }[] = [
  { label: "Any time" },
  { label: String(THIS_YEAR), from: `${THIS_YEAR}-01-01` },
  { label: `${THIS_YEAR - 2}+`, from: `${THIS_YEAR - 2}-01-01` },
  { label: "2020+", from: "2020-01-01" },
  { label: "Before 2020", to: "2019-12-31" },
];

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

function periodLabel(f: Filters): string | null {
  if (!f.published_from && !f.published_to) return null;
  const p = PERIODS.find((x) => x.from === f.published_from && x.to === f.published_to);
  return p ? p.label : `${f.published_from?.slice(0, 4) ?? "…"}–${f.published_to?.slice(0, 4) ?? "…"}`;
}

const pill = (on: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
    on
      ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
      : "border-stone-300 text-stone-700 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-500 dark:hover:bg-stone-800"
  }`;

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const n = activeCount(filters);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  useEffect(() => {
    if (!open || facets) return;
    const ctl = new AbortController();
    getFacets(ctl.signal).then(setFacets, () => undefined);
    return () => ctl.abort();
  }, [open, facets]);

  // close on Esc or a click outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const toggleStatus = (s: DocStatus) => {
    const cur = new Set(filters.status ?? []);
    if (cur.has(s)) cur.delete(s);
    else cur.add(s);
    set({ status: [...cur] });
  };

  // removable summary chips shown next to the button while the panel is closed
  const chips: { label: string; clear: () => void }[] = [
    ...(filters.status ?? []).map((s) => ({
      label: STATUSES.find((x) => x.value === s)?.label ?? s,
      clear: () => set({ status: filters.status?.filter((x) => x !== s) }),
    })),
    ...(filters.product_type ? [{ label: filters.product_type, clear: () => set({ product_type: undefined }) }] : []),
    ...(periodLabel(filters) ? [{ label: periodLabel(filters)!, clear: () => set({ published_from: undefined, published_to: undefined }) }] : []),
    ...(filters.make ? [{ label: `Make: ${filters.make}`, clear: () => set({ make: undefined }) }] : []),
  ];

  return (
    <div ref={root} className="relative mb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-[13px] font-medium text-stone-700 shadow-xs hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters
          {n > 0 && (
            <span className="grid size-4.5 place-items-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">{n}</span>
          )}
        </button>
        {!open &&
          chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-stone-200/70 py-1 pr-1 pl-2.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200">
              {c.label}
              <button type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`} className="rounded-full p-0.5 hover:bg-stone-300 dark:hover:bg-stone-700">
                <svg aria-hidden viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Filter the notices searched"
          className="absolute bottom-full left-0 z-20 mb-2 w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl dark:border-stone-700 dark:bg-stone-900"
        >
          <Section title="Status">
            {STATUSES.map((s) => {
              const on = !!filters.status?.includes(s.value);
              return (
                <button key={s.value} type="button" aria-pressed={on} onClick={() => toggleStatus(s.value)} className={pill(on)}>
                  <span aria-hidden className={`size-2 rounded-full ${s.dot}`} />
                  {s.label}
                  {facets && <span className={`tabular-nums ${on ? "opacity-70" : "text-stone-400"}`}>{facets.status[s.value]}</span>}
                </button>
              );
            })}
          </Section>

          <Section title="Product type">
            {["", ...(facets?.product_types ?? [])].map((t) => (
              <button key={t || "any"} type="button" aria-pressed={(filters.product_type ?? "") === t} onClick={() => set({ product_type: t || undefined })} className={pill((filters.product_type ?? "") === t)}>
                {t || "Any"}
              </button>
            ))}
          </Section>

          <Section title="Published">
            {PERIODS.map((p) => {
              const on = (filters.published_from ?? undefined) === p.from && (filters.published_to ?? undefined) === p.to;
              return (
                <button key={p.label} type="button" aria-pressed={on} onClick={() => set({ published_from: p.from, published_to: p.to })} className={pill(on)}>
                  {p.label}
                </button>
              );
            })}
          </Section>

          <Section title="Manufacturer">
            <input
              list="adf-makes"
              value={filters.make ?? ""}
              onChange={(e) => set({ make: e.target.value || undefined })}
              placeholder="Any manufacturer, e.g. Boeing"
              maxLength={60}
              className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-[13px] placeholder:text-stone-400 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:focus:border-stone-400"
            />
            <datalist id="adf-makes">{facets?.makes.map((m) => <option key={m} value={m} />)}</datalist>
          </Section>

          <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-3 dark:border-stone-800">
            <button type="button" onClick={() => onChange({})} disabled={n === 0} className="text-[13px] text-stone-500 hover:text-stone-800 disabled:opacity-40 dark:hover:text-stone-200">
              Clear all
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-stone-900 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-3.5 last-of-type:mb-0">
      <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}
