// POST /upload and friends (uploads.py): PDFs indexed into a separate "uploaded" collection.
// Answers are extractive quotes from the uploaded text; applicability is always UNKNOWN.
import type { Applicability } from "../api/types";
import type { SourceText } from "./sourceApi";

export interface UploadSummary {
  doc_id: number;
  record_id: string; // UPLOAD-001
  filename: string;
  pages: number;
  chunks: number;
  sections: string[];
  collection: "uploaded";
  uploaded_at: string;
  applicability: Applicability; // result is always "UNKNOWN"
  warnings: string[];
  duplicate?: boolean; // only on POST /upload
}

/** Own type, not `Citation`: `status` is "uploaded", and there is no Federal Register URL. */
export interface UploadCitation {
  source: "upload";
  doc_id: number;
  record_id: string;
  docket: "";
  ad_number: "";
  status: "uploaded";
  revision_date: "";
  section: string;
  fr_citation: string; // the file name
  pages: string;
  page: number; // PDF page number (1-based)
  url: "";
  cited_text: string;
  ad_id: number; // always -1: not a corpus document
  chunk_id: number;
}

export interface UploadAnswer {
  status: "answered" | "refused";
  mode: "extractive" | null;
  refusal_reason: string;
  note: string;
  retrieval_ms: number;
  total_ms: number;
  disclaimer: string;
  candidates: string[];
  notices: string[];
  answer_blocks: { text: string; citations: UploadCitation[] }[];
  documents: UploadSummary[];
}

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === "string" ? `: ${body.detail}` : "";
  throw new Error(`${what} failed (${res.status})${detail}`);
}

export async function uploadPdf(file: File, signal?: AbortSignal): Promise<UploadSummary> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/upload", { method: "POST", body: form, signal });
  if (!res.ok) return fail(res, "Upload");
  return res.json() as Promise<UploadSummary>;
}

export async function listUploads(signal?: AbortSignal): Promise<UploadSummary[]> {
  const res = await fetch("/uploads", { signal });
  if (!res.ok) return fail(res, "Listing uploads");
  return ((await res.json()) as { docs: UploadSummary[] }).docs;
}

export async function deleteUpload(docId: number): Promise<void> {
  const res = await fetch(`/upload/${encodeURIComponent(docId)}`, { method: "DELETE" });
  if (!res.ok) return fail(res, "Delete");
}

export async function askUpload(docId: number, query: string, signal?: AbortSignal): Promise<UploadAnswer> {
  const res = await fetch(`/upload/${encodeURIComponent(docId)}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok) return fail(res, "Question");
  return res.json() as Promise<UploadAnswer>;
}

export async function getUploadText(docId: number, signal?: AbortSignal): Promise<SourceText> {
  const res = await fetch(`/upload/${encodeURIComponent(docId)}/text`, { signal });
  if (!res.ok) return fail(res, "Loading the document");
  return res.json() as Promise<SourceText>;
}
