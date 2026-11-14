import { cn } from "../upstream";

export interface StatusIconProps {
  /** The public stage; null is a closed status. */
  stage: string | null;
  /** The workspace status color. The icon uses the current text color without one. */
  color?: string | null;
  className?: string;
}

// The fill grows with the stage: open is empty, shipped and closed are full.
const fills: Record<string, string> = {
  planned: "M3 7a4 4 0 0 0 8 0Z",
  in_progress: "M7 3a4 4 0 1 1-4 4h4Z",
};

export function StatusIcon({ stage, color, className }: StatusIconProps) {
  const full = stage === "shipped" || stage === null;
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      aria-hidden="true"
      color={color ?? undefined}
      className={cn("shrink-0", className)}
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill={full ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {stage && fills[stage] ? (
        <path d={fills[stage]} fill="currentColor" />
      ) : null}
      {stage === "shipped" ? (
        <path
          d="m4.5 7.2 1.7 1.7 3.3-3.6"
          fill="none"
          className="stroke-background"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {stage === null ? (
        <path
          d="M4.5 7h5"
          className="stroke-background"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
