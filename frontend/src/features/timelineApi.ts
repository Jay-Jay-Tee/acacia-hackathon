// GET /ad/{ad_id}/timeline (features.py): every notice in a docket, oldest first.

export type TimelineKind = "proposed" | "revised" | "withdrawn" | "final";

/** A superseded AD number, mapped to a corpus document when one carries that number. */
export interface Supersession {
  ad_number: string;
  in_corpus: boolean;
  ad_id?: number;
  record_id?: string | null;
  docket?: string;
}

export interface TimelineEvent {
  ad_id: number;
  record_id: string | null;
  kind: TimelineKind;
  label: string;
  status: string;
  status_label: string;
  publish_date: string | null;
  issue_date: string | null;
  pages: string;
  citation: string;
  url: string;
  ad_number: string; // "" for NPRMs
  is_current: boolean; // latest publish date in the docket
  supersedes: Supersession[];
}

export interface Timeline {
  docket: string;
  requested_ad_id: number;
  current_id: number;
  count: number;
  headline: string; // e.g. "Withdrawn: no action required."
  events: TimelineEvent[];
}

export async function getTimeline(adId: number, signal?: AbortSignal): Promise<Timeline> {
  const res = await fetch(`/ad/${encodeURIComponent(adId)}/timeline`, { signal });
  if (!res.ok) throw new Error(`Could not load revision timeline (${res.status})`);
  return res.json() as Promise<Timeline>;
}
