import type { AskResponse, Citation } from "../api/types";

/** Numbers citations in reading order; the same passage keeps the same number everywhere. */
export function numberCitations(r: AskResponse) {
  const numbers = new Map<string, number>();
  const sources: Citation[] = [];
  for (const b of r.answer_blocks)
    for (const c of b.citations) {
      const key = `${c.ad_id}:${c.chunk_id}`;
      if (!numbers.has(key)) {
        numbers.set(key, sources.length + 1);
        sources.push(c);
      }
    }
  return { numberOf: (c: Citation) => numbers.get(`${c.ad_id}:${c.chunk_id}`)!, sources };
}
