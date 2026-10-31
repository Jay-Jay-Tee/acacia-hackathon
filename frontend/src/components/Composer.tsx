import { useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { MOD_KEY } from "../lib/platform";
import type { Profile } from "../lib/profile";
import { ProfileChip } from "./ProfileChip";

export const QUERY_MAX = 500; // docs/API.md limit

// Questions that lean on an earlier turn. The backend has no chat memory, so these get answered blind.
const FOLLOW_UP =
  /^(and|also|so|then|what about|how about|same (for|with)|it|its|it's|that|this|those|these|they|them|which one|why)\b|\b(previous|above|earlier|last) (answer|question|one|ad)\b|\byou (said|mentioned)\b/i;

interface Props {
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  onSend: (query: string) => void;
  busy: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** The chat already has turns (enables the follow-up warning). */
  hasHistory?: boolean;
}

/** Input bar pinned to the bottom: aircraft profile chip + question box + send. */
export function Composer({ profile, onProfileChange, onSend, busy, inputRef, hasHistory }: Props) {
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
  const followUp = hasHistory && FOLLOW_UP.test(text.trim());
  // A div, not a <form>: the profile popover inside is its own form, and forms can't nest.
  return (
    <>
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
      {followUp ? (
        <p role="status" className="mt-1.5 px-2 text-[11px] text-amber-700 dark:text-amber-400">
          This reads like a follow-up, but earlier questions aren't remembered. Name the AD or aircraft in the question.
        </p>
      ) : (
        <p className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-2 text-[11px] text-stone-400 dark:text-stone-500">
          <span>Each question is answered on its own, from the documents only.</span>
          <span className="hidden sm:inline">
            <Kbd>Enter</Kbd> send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line · <Kbd>{MOD_KEY}</Kbd>+<Kbd>K</Kbd> focus
          </span>
        </p>
      )}
    </>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-stone-300 px-1 font-sans text-[10px] dark:border-stone-700">{children}</kbd>;
}
