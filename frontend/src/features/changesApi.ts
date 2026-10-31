// GET /diff and POST /watchlist/status (changes.py).

export interface NoticeRef {
  ad_id: number;
  record_id: string | null;
  docket: string;
  status: string;
  status_label: string;
  publish_date: string | null;
  url: string;
}

export type DiffOp = "equal" | "replace" | "delete" | "insert";

export interface WordOp {
  op: DiffOp;
  old: string;
  new: string;
}

export interface SentenceOp {
  op: DiffOp;
  old: string;
  new: string;
  inline?: WordOp[]; // word-level diff, only on "replace"
}

export interface DiffSection {
  key: "applicability" | "required_actions";
  name: string;
  available_old: boolean;
  available_new: boolean;
  /** null = cannot be compared (a notice has no text for this section in the dataset); never "removed". */
  changed: boolean | null;
  ops: SentenceOp[];
  note: string;
}

export interface DiffResult {
  comparable: true;
  same_docket: boolean;
  old: NoticeRef;
  new: NoticeRef;
  models: { added: string[]; removed: string[]; unchanged: string[] };
  sections: DiffSection[];
  summary: string;
}

export interface NotComparable {
  comparable: false;
  new: NoticeRef;
  reason: string;
}

export type DiffResponse = DiffResult | NotComparable;

export type WatchStatus =
  | { docket: string; found: false; note: string }
  | {
      docket: string;
      found: true;
      subject: string;
      make: string;
      models: string[];
      count: number;
      current: NoticeRef;
      headline: string; // "Withdrawn: no action required." when the latest notice is a withdrawal
      new_notices: number; // notices newer than the one last reviewed
      seen_known: boolean; // false when the last-reviewed notice is no longer in the corpus
      seen_ad_id: number | null;
      changed: boolean;
    };

export interface WatchQuery {
  docket: string;
  seen_record_id: string | null;
}

export async function getDiff(newId: number, oldId?: number, signal?: AbortSignal): Promise<DiffResponse> {
  const params = new URLSearchParams({ new_id: String(newId) });
  if (oldId !== undefined) params.set("old_id", String(oldId));
  const res = await fetch(`/diff?${params}`, { signal });
  if (!res.ok) throw new Error(`Could not load the comparison (${res.status})`);
  return res.json() as Promise<DiffResponse>;
}

export async function getWatchStatus(items: WatchQuery[], signal?: AbortSignal): Promise<WatchStatus[]> {
  const res = await fetch("/watchlist/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
    signal,
  });
  if (!res.ok) throw new Error(`Could not load the watchlist (${res.status})`);
  return ((await res.json()) as { items: WatchStatus[] }).items;
}
