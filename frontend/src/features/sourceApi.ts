// GET /ad/{ad_id}/text (features.py). Kept here, not in ../api/client.ts, so P1's files stay untouched.

export interface SourceChunk {
  chunk_id: number;
  section: string;
  page: number; // Federal Register page where this chunk starts
  anchor: string;
  text: string;
}

export interface SourceAnchor {
  section: string;
  page: number;
  chunk_id: number;
  anchor: string;
}

export interface SourceText {
  ad_id: number;
  record_id: string | null;
  docket: string;
  subject: string;
  status: string;
  status_label: string;
  pages: string;
  citation: string;
  url: string;
  chunks: SourceChunk[];
  anchors: SourceAnchor[];
}

export async function getSourceText(adId: number, signal?: AbortSignal): Promise<SourceText> {
  const res = await fetch(`/ad/${encodeURIComponent(adId)}/text`, { signal });
  if (!res.ok) throw new Error(`Could not load source text (${res.status})`);
  return res.json() as Promise<SourceText>;
}
