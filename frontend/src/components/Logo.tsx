import { useId } from "react";

/** Applicable's mark: a directive page with its corner folded and a check cut into it,
 * i.e. "this applies, and here is the source". Same art as the favicon in index.html. */
export function Logo({ className = "size-8" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path d="M10.5 6.5h7.25L23.5 12.25V24a1.75 1.75 0 0 1-1.75 1.75h-11.25A1.75 1.75 0 0 1 8.75 24V8.25A1.75 1.75 0 0 1 10.5 6.5z" fill="#fff" />
      <path d="M17.75 6.5v4.25a1.5 1.5 0 0 0 1.5 1.5h4.25z" fill="#bfdbfe" />
      <path d="M12.25 18.75l2.75 2.75 5-5.5" fill="none" stroke="#1d4ed8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
