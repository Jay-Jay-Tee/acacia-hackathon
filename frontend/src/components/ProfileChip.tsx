import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from "react";
import { cleanProfile, EMPTY_PROFILE, PROFILE_MAX, profileLabel, type Profile } from "../lib/profile";

/** Aircraft profile (model + serial) that applies to every question until changed. */
export function ProfileChip({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(profile);
  const root = useRef<HTMLDivElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const set = Boolean(profile.model || profile.serial);

  useEffect(() => {
    if (!open) return;
    setDraft(profile);
    modelInput.current?.focus();
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, profile]);

  function save(e: FormEvent) {
    e.preventDefault();
    onChange(cleanProfile(draft));
    setOpen(false);
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        className={`flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
          set
            ? "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100 dark:hover:bg-blue-900"
            : "border-dashed border-stone-300 text-stone-500 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-900"
        }`}
      >
        <PlaneIcon />
        <span className="truncate">{profileLabel(profile)}</span>
        <span aria-hidden className="text-[10px] opacity-60">▾</span>
      </button>

      {open && (
        <form
          id={id}
          role="dialog"
          aria-label="Aircraft profile"
          onSubmit={save}
          className="absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          <div>
            <p className="text-sm font-medium">Aircraft profile</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Used to check applicability on every question until you change it.
            </p>
          </div>
          <Field label="Model" placeholder="e.g. P.68 or A320-214" value={draft.model} inputRef={modelInput}
                 onChange={(model) => setDraft((d) => ({ ...d, model }))} />
          <Field label="Serial number" placeholder="e.g. 100" value={draft.serial}
                 onChange={(serial) => setDraft((d) => ({ ...d, serial }))} />
          <div className="flex justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onChange(EMPTY_PROFILE);
                setOpen(false);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              Clear
            </button>
            <button type="submit" className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <label className="block text-xs text-stone-600 dark:text-stone-400">
      {props.label}
      <input
        ref={props.inputRef}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        maxLength={PROFILE_MAX}
        autoComplete="off"
        spellCheck={false}
        className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
      />
    </label>
  );
}

function PlaneIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="currentColor">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
    </svg>
  );
}
