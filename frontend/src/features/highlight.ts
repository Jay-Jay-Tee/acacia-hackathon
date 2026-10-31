// Find the cited span inside its chunk. Extractive answers cut `cited_text` at 600 chars and append "...",
// and the chunk keeps the source's line breaks, so match on words with flexible whitespace and
// ignore a trailing ellipsis. Returns null when the quote can't be located (caller highlights the whole chunk).

const TRAILING_ELLIPSIS = /(\.{3}|…)\s*$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function locate(text: string, citedText: string): [number, number] | null {
  const words = citedText.replace(TRAILING_ELLIPSIS, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const m = new RegExp(words.map(escapeRegExp).join("\\s+")).exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}
