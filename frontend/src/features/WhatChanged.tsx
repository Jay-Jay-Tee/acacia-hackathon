import { Fragment, useEffect, useState } from "react";
import { safeUrl } from "../lib/safeUrl";
import { getDiff, type DiffResponse, type DiffSection, type NoticeRef, type SentenceOp } from "./changesApi";

// "What changed": two notices' Applicability and Required actions text, diffed sentence by sentence with the
// changed words marked. Changes are marked with +/- and underline/strike-through, not by colour alone.
// A section with no text in the dataset reads "cannot be compared", never "removed". Plain text only.

const DEL = "bg-red-100 text-red-900 line-through dark:bg-red-950 dark:text-red-200";
const INS = "bg-green-100 text-green-900 underline dark:bg-green-950 dark:text-green-200";

export function WhatChanged({ newId, oldId }: { newId: number; oldId?: number }) {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getDiff(newId, oldId, ctrl.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Could not load the comparison");
      });
    return () => ctrl.abort();
  }, [newId, oldId]);

  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-stone-500">Comparing…</p>;
  if (!data.comparable) {
    return (
      <div className="space-y-2 text-sm">
        <NoticeLine label="Notice" n={data.new} />
        <p role="status">{data.reason}</p>
      </div>
    );
  }

  const { models } = data;
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <NoticeLine label="Older" n={data.old} />
        <NoticeLine label="Newer" n={data.new} />
        {!data.same_docket && (
          <p className="text-xs text-amber-800 dark:text-amber-300">These notices belong to different dockets.</p>
        )}
      </div>
      <p role="status" className="rounded bg-stone-200 p-2 font-medium dark:bg-stone-800">{data.summary}</p>

      {(models.added.length > 0 || models.removed.length > 0) && (
        <div className="space-y-1 text-xs">
          {models.added.length > 0 && <p><span className={INS}>+ Models added:</span> {models.added.join(", ")}</p>}
          {models.removed.length > 0 && <p><span className={DEL}>− Models removed:</span> {models.removed.join(", ")}</p>}
        </div>
      )}

      {data.sections.map((s) => (
        <Section key={s.key} s={s} />
      ))}
    </div>
  );
}

function NoticeLine({ label, n }: { label: string; n: NoticeRef }) {
  const link = safeUrl(n.url);
  const id = n.record_id ?? n.docket;
  return (
    <p className="text-xs">
      <span className="text-stone-500">{label}:</span>{" "}
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium underline">{id}</a>
      ) : (
        <span className="font-medium">{id}</span>
      )}{" "}
      · published {n.publish_date ?? "date unknown"} · {n.status_label}
    </p>
  );
}

function Section({ s }: { s: DiffSection }) {
  const label = s.changed === null ? "Cannot be compared" : s.changed ? "Changed" : "Unchanged";
  return (
    <section aria-label={s.name} className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        {s.name}
        <span className="rounded bg-stone-200 px-1.5 py-0.5 font-medium dark:bg-stone-800">{label}</span>
      </h3>
      {s.note && <p className="text-xs text-stone-500">{s.note}</p>}
      {s.changed === false && <p className="text-xs text-stone-500">The text is identical in both notices.</p>}
      {s.changed && (
        <div className="space-y-2">
          {s.ops.map((op, i) => (
            <Op key={i} op={op} />
          ))}
        </div>
      )}
    </section>
  );
}

function Op({ op }: { op: SentenceOp }) {
  if (op.op === "equal") return <p className="text-xs text-stone-500">{op.old}</p>;
  if (op.op === "delete") return <p className={`rounded p-1 text-xs ${DEL}`}><span aria-label="removed">− </span>{op.old}</p>;
  if (op.op === "insert") return <p className={`rounded p-1 text-xs ${INS}`}><span aria-label="added">+ </span>{op.new}</p>;
  const words = op.inline ?? [];
  return (
    <div className="space-y-1 rounded border border-stone-300 p-1.5 text-xs dark:border-stone-600">
      <p>
        <span aria-label="older wording" className="font-medium">− </span>
        {words.map((w, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            {w.op === "equal" ? w.old : w.old && <span className={DEL}>{w.old}</span>}
          </Fragment>
        ))}
      </p>
      <p>
        <span aria-label="newer wording" className="font-medium">+ </span>
        {words.map((w, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            {w.op === "equal" ? w.new : w.new && <span className={INS}>{w.new}</span>}
          </Fragment>
        ))}
      </p>
    </div>
  );
}
