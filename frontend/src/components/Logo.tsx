/** AirFrame's AF monogram: the A's right stem doubles as the F's upright;
 * the crossbar runs through both letters. Keep in sync with public/airframe.svg. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={`shrink-0 text-cyan-600 dark:text-cyan-300 ${className}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 26 14 6h15M20 6v20M8.5 17h18"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
