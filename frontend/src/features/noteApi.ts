// POST /note (features.py). The server rebuilds document details, applicability and source checks from the
// citation ids, so only the question, aircraft and answer text are taken from what the user saw.
import type { AskResponse, AskStatus } from "../api/types";

export interface NoteRequest {
  query: string;
  model: string | null;
  serial: string | null;
  status: AskStatus;
  mode: string | null;
  refusal_reason: string;
  answer_blocks: { text: string; citations: { ad_id: number; chunk_id: number; cited_text: string }[] }[];
}

export interface NoteResult {
  markdown: string;
  filename: string;
  generated_at: string;
}

export function buildNoteRequest(
  query: string,
  model: string | null | undefined,
  serial: string | null | undefined,
  res: AskResponse,
): NoteRequest {
  return {
    query,
    model: model || null,
    serial: serial || null,
    status: res.status,
    mode: res.mode,
    refusal_reason: res.refusal_reason,
    answer_blocks: res.answer_blocks.map((b) => ({
      text: b.text,
      citations: b.citations.map((c) => ({ ad_id: c.ad_id, chunk_id: c.chunk_id, cited_text: c.cited_text })),
    })),
  };
}

export async function fetchNote(req: NoteRequest, signal?: AbortSignal): Promise<NoteResult> {
  const res = await fetch("/note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw new Error(`Could not build the compliance note (${res.status})`);
  return res.json() as Promise<NoteResult>;
}
