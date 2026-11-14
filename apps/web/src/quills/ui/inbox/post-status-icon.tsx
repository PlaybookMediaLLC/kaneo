import { cn } from "../upstream";

export interface PostStatusIconProps {
  /** The workspace status color. The icon uses the current text color without one. */
  color?: string | null;
  /** How far the status is along the workflow, from 0 to 1 (`statusProgress` in quills/core). */
  progress: number;
  className?: string;
}

/** A rounded square that fills with the status color as a post status advances. Full has a check. */
export function PostStatusIcon({
  color,
  progress,
  className,
}: PostStatusIconProps) {
  const full = progress >= 1;
  const height = Math.max(0, Math.min(1, progress)) * 6;
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      aria-hidden="true"
      color={color ?? undefined}
      className={cn("shrink-0", className)}
    >
      <rect
        x="1.75"
        y="1.75"
        width="10.5"
        height="10.5"
        rx="3"
        fill={full ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {!full && height > 0 ? (
        <rect
          x="4"
          y={10 - height}
          width="6"
          height={height}
          rx="1"
          fill="currentColor"
        />
      ) : null}
      {full ? (
        <path
          d="m4.5 7.2 1.7 1.7 3.3-3.6"
          fill="none"
          className="stroke-background"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
