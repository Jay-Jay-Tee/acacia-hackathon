import type { AskResponse } from "../api/types";
import { numberCitations } from "./citations";
import { statusBadge } from "./format";
import { profileLabel, type Profile } from "./profile";

const RESULT: Record<AskResponse["status"], string> = {
  answered: "Answer",
  needs_clarification: "Needs clarification",
  refused: "Cannot answer",
};

const VERDICT: Record<string, string> = {
  APPLIES: "Applies",
  DOES_NOT_APPLY: "Does not apply",
  UNKNOWN: "Unknown",
  AMBIGUOUS: "Ambiguous model",
};

/**
 * Plain-text copy of one answer, with the same [n] numbers as the chips on screen.
 * (The full audit document is P4's "Copy as compliance note"; this is the quick paste.)
 */
export function answerAsText(query: string, profile: Profile, r: AskResponse): string {
  const { numberOf, sources } = numberCitations(r);
  const out: string[] = [];
  out.push(`Question: ${query}`);
  out.push(`Aircraft: ${profile.model || profile.serial ? profileLabel(profile) : "none set"}`);
  out.push(`Result: ${RESULT[r.status] ?? r.status}${r.mode ? ` (${r.mode})` : ""}`);
  if (r.status !== "answered" && r.refusal_reason) out.push("", r.refusal_reason);
  if (r.notices?.length) out.push("", "Notices:", ...r.notices.map((n) => `- ${n}`));

  if (r.answer_blocks.length) {
    const cite = (b: AskResponse["answer_blocks"][number]) => b.citations.map((c) => ` [${numberOf(c)}]`).join("");
    out.push("");
    if (r.mode === "extractive") for (const b of r.answer_blocks) out.push(`> ${b.text.replace(/\s+/g, " ").trim()}${cite(b)}`);
    else out.push(r.answer_blocks.map((b) => `${b.text.trim()}${cite(b)}`).join(" ").replace(/ ([,.;:)])/g, "$1"));
  }

  if (sources.length) {
    out.push("", "Sources:");
    sources.forEach((c, i) => {
      const parts = [c.record_id, c.docket, statusBadge(c.status).label, `rev. ${c.revision_date}`, c.section, `FR p.${c.page}${c.pages ? ` (pp. ${c.pages})` : ""}`, c.url];
      out.push(`[${i + 1}] ${parts.filter(Boolean).join(" · ")}`);
    });
  }

  const checked = r.documents.filter((d) => d.applicability);
  if (checked.length) {
    out.push("", "Applicability (deterministic rules):");
    for (const d of checked) out.push(`- ${d.record_id || d.docket}: ${VERDICT[d.applicability!.result] ?? d.applicability!.result}`);
  }

  out.push("", r.disclaimer);
  return out.join("\n");
}

/** Clipboard write with a fallback for browsers or contexts that block the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
