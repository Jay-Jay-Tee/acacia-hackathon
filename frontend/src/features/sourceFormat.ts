// Display formatting for Federal Register chunk text. The text comes as GPO plain text: hard-wrapped at
// ~70 columns, paragraphs marked by blank lines or a 4-space indent, rule lines (=== / ---), NULs and the
// odd mis-encoded byte. This reflows it into paragraphs and sub-headings for reading. It never changes,
// adds or reorders words; it only joins lines and drops layout-only characters.

import { locate } from "./highlight";

export type BlockKind = "p" | "h" | "hidden";

export interface Block {
  kind: BlockKind;
  text: string;
  start: number; // offsets into FormattedChunk.text
  end: number;
}

export interface FormattedChunk {
  /** Reflowed text: blocks joined by blank lines. Highlight offsets refer to this. */
  text: string;
  blocks: Block[];
  /** Cited span inside `text`, or null if the quote can't be found. */
  span: [number, number] | null;
  /** The first visible paragraph already opens with the section name ("AGENCY: …"), so no label is needed. */
  leadsWithSection: boolean;
}

const RULE = /^\s*[=_\-*]{5,}\s*$/;

function clean(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\u00c2\uFFFD?/g, "")
    .replace(/[\u00a0\uFFFD]/g, " ");
}

function paragraphs(raw: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join(" ").replace(/\s+/g, " ").trim());
    cur = [];
  };
  for (const line of clean(raw).split("\n")) {
    if (!line.trim() || RULE.test(line)) {
      flush();
      continue;
    }
    // A 2+ space indent starts a new paragraph in GPO text; bracketed header lines stand alone.
    if ((/^\s{2,}\S/.test(line) || /^\s*\[/.test(line)) && cur.length) flush();
    cur.push(line.trim());
    if (/^\s*\[.*\]\s*$/.test(line)) flush();
  }
  flush();
  return out.filter(Boolean);
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9()]+/g, " ").trim();

/** Short standalone lines without closing punctuation read as sub-headings ("Background", "(c) Applicability"). */
function isHeading(p: string): boolean {
  return p.length <= 90 && p.split(" ").length <= 12 && /^[A-Z(]/.test(p) && !/[.,;:]$/.test(p) && !/^\[/.test(p);
}

export function formatChunk(raw: string, section: string, citedText?: string): FormattedChunk {
  const paras = paragraphs(raw);
  const blocks: Block[] = [];
  let text = "";
  paras.forEach((p, i) => {
    // The section label is already shown above the chunk, so a first line that only repeats it is hidden
    // (kept in `text` so a quote that starts with the heading still matches).
    const kind: BlockKind = i === 0 && norm(p) === norm(section) ? "hidden" : isHeading(p) ? "h" : "p";
    if (text) text += "\n\n";
    blocks.push({ kind, text: p, start: text.length, end: text.length + p.length });
    text += p;
  });
  const first = blocks.find((b) => b.kind !== "hidden");
  const leadsWithSection = Boolean(first && norm(first.text).startsWith(norm(section)));
  return { text, blocks, span: citedText ? locate(text, citedText) : null, leadsWithSection };
}
