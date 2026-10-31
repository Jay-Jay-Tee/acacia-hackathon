// Federal Register text is hard-wrapped at ~72 columns, which turns ragged in a narrower panel.
// reflow() rejoins wrapped lines into paragraphs and keeps table-like blocks verbatim (fixed width).

export interface Segment {
  text: string;
  mono: boolean; // a table or rule line: render fixed-width, unwrapped
}

const TABLE_LINE = /\S {3,}\S|\.{4,}|^[-=_]{8,}\s*$/;

/** A new paragraph starts at a blank line, an indented line (FR paragraph indent), or a list marker. */
const STARTS_PARAGRAPH = /^(\s{2,}|\s*(\(\w{1,4}\)|\d+\.|[A-Z][A-Z ,'/-]{3,}:)\s)/;

export function reflow(raw: string): Segment[] {
  const out: Segment[] = [];
  let para: string[] = [];
  let table: string[] = [];
  const flushPara = () => {
    if (para.length) out.push({ text: para.join(" ").replace(/\s+/g, " ").trim(), mono: false });
    para = [];
  };
  const flushTable = () => {
    if (table.length) out.push({ text: table.join("\n"), mono: true });
    table = [];
  };
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      flushPara();
      flushTable();
    } else if (TABLE_LINE.test(line)) {
      flushPara();
      table.push(line.replace(/\s+$/, ""));
    } else {
      flushTable();
      if (STARTS_PARAGRAPH.test(line)) flushPara();
      para.push(line.trim());
    }
  }
  flushPara();
  flushTable();
  return out.filter((s) => s.text);
}

/** Sections a reader rarely needs; shown collapsed unless they hold the cited passage. */
export const BOILERPLATE = /^(preamble|agency|action|addresses|dates|for further information contact)$/i;
