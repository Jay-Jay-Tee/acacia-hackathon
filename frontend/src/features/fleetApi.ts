// POST /fleet (features.py). Verdicts come from engine.check_applicability: code, never the LLM.
import type { Applicability, ApplicabilityResult } from "../api/types";

export interface FleetRow {
  model: string;
  serial: string;
}

export interface FleetResult {
  ad_id: number;
  record_id: string | null;
  docket: string;
  ad_number: string; // "" for NPRMs
  subject: string;
  status: string;
  status_label: string;
  publish_date: string | null;
  url: string;
  is_latest: boolean; // false for superseded revisions of the same docket
  revision_count: number;
  applicability: Applicability;
}

export type FleetAircraftStatus = "ok" | "invalid" | "model_not_in_corpus";

export interface FleetAircraft {
  model: string;
  serial: string | null;
  status: FleetAircraftStatus;
  note: string;
  candidates: string[];
  results: FleetResult[]; // sorted APPLIES, AMBIGUOUS, UNKNOWN, DOES_NOT_APPLY
  counts: Partial<Record<ApplicabilityResult, number>>;
}

export interface FleetResponse {
  aircraft: FleetAircraft[];
  totals_latest: Partial<Record<ApplicabilityResult, number>>;
  disclaimer: string;
}

export async function checkFleet(rows: FleetRow[], signal?: AbortSignal): Promise<FleetResponse> {
  const res = await fetch("/fleet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows.map((r) => ({ model: r.model, serial: r.serial || null }))),
    signal,
  });
  if (!res.ok) throw new Error(`Fleet check failed (${res.status})`);
  return res.json() as Promise<FleetResponse>;
}
