import { useState } from "react";
import type { AskResponse } from "../api/types";
import { buildNoteRequest, fetchNote } from "./noteApi";

// "Copy as compliance note": Markdown with the question, answer, every citation, the applicability trace,
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

  async function run(action: "copy" | "download") {
    setBusy(true);
    setMessage("");
    try {
      const note = await fetchNote(buildNoteRequest(query, model, serial, response));
      if (action === "download") {
        const url = URL.createObjectURL(new Blob([note.markdown], { type: "text/markdown" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = note.filename;
        a.click();
        URL.revokeObjectURL(url);
        setMessage(`Downloaded ${note.filename}`);
      } else {
        try {
          await navigator.clipboard.writeText(note.markdown);
          setMessage("Copied the compliance note to the clipboard.");
        } catch {
          setMessage("Could not copy automatically (clipboard blocked). Use Download .md instead.");
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not build the compliance note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} disabled={busy} onClick={() => run("copy")}>
        Copy as compliance note
      </button>
      <button type="button" className={btn} disabled={busy} onClick={() => run("download")}>
        Download .md
      </button>
      <span role="status" aria-live="polite" className="text-xs text-stone-500">
        {busy ? "Building note…" : message}
      </span>
    </div>
  );
}
