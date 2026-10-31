import { useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { Profile } from "../lib/profile";
import { ProfileChip } from "./ProfileChip";

export const QUERY_MAX = 500; // docs/API.md limit

interface Props {
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  onSend: (query: string) => void;
  busy: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
}

/** Input bar pinned to the bottom: aircraft profile chip + question box + send. */
export function Composer({ profile, onProfileChange, onSend, busy, inputRef }: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement | null>(null);
  const canSend = text.trim().length > 0 && !busy;

  // Grow with the content up to ~6 lines, then scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const left = QUERY_MAX - text.length;
  return (
    // A div, not a <form>: the profile popover inside is its own form, and forms can't nest.
    <div
      className="rounded-2xl border border-stone-200 bg-white p-2 shadow-sm focus-within:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:focus-within:border-stone-500"
    >
      <textarea
        ref={(el) => {
          area.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef) inputRef.current = el;
        }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        maxLength={QUERY_MAX}
        placeholder="Ask about an airworthiness directive…"
        aria-label="Question"
        className="block max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-stone-400"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <ProfileChip profile={profile} onChange={onProfileChange} />
        <div className="flex shrink-0 items-center gap-2">
          {left <= 50 && (
            <span className={`text-xs tabular-nums ${left <= 10 ? "text-red-600 dark:text-red-400" : "text-stone-400"}`}>{left}</span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className="grid size-8 place-items-center rounded-full bg-stone-900 text-white transition-opacity hover:bg-stone-700 disabled:opacity-30 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
