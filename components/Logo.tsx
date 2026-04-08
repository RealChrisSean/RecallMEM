/**
 * RecallMEM logo. Three connected nodes forming a graph.
 * Inherits color from `currentColor` so it picks up the surrounding text color.
 */

export function Logo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="RecallMEM"
    >
      {/* Connecting lines */}
      <line x1="32" y1="14" x2="14" y2="44" />
      <line x1="32" y1="14" x2="50" y2="44" />
      <line x1="14" y1="44" x2="50" y2="44" />
      {/* Three nodes */}
      <circle cx="32" cy="14" r="6" fill="currentColor" />
      <circle cx="14" cy="44" r="6" fill="currentColor" />
      <circle cx="50" cy="44" r="6" fill="currentColor" />
    </svg>
  );
}
