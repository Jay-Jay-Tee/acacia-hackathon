import { useState } from "react";
import type { AskResponse } from "../api/types";
import { buildNoteRequest, fetchNote } from "./noteApi";

// "Save compliance note": Markdown with the question, answer, every citation, the applicability trace,
// a timestamp and the certifying-staff line. P1 renders it under an answer via `features.CopyNote`.

export interface CopyNoteProps {
  query: string; // the question as asked
  model?: string | null; // the aircraft profile used for the question
  serial?: string | null;
  response: AskResponse;
}

const btn =
  "rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:hover:bg-stone-800";

export function CopyNoteButton({ query, model, serial, response }: CopyNoteProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // One action: the note is a record to file, so it is saved, not copied (Copy answer covers quick pastes).
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const note = await fetchNote(buildNoteRequest(query, model, serial, response));
      const url = URL.createObjectURL(new Blob([note.markdown], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = note.filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Saved ${note.filename}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not build the compliance note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${btn} inline-flex items-center gap-1.5`}
        disabled={busy}
        onClick={save}
        title="Timestamped record for the maintenance file: every quote re-checked against the source, the applicability trace, and a certifying-staff line. Saved as a .md file."
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 14l2 2 4-4" />
        </svg>
        {busy ? "Building note…" : "Save compliance note"}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-stone-500">
        {message}
      </span>
    </>
  );
}
