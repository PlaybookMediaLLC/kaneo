import { cn } from "./upstream";

export interface ArrowUpIconProps {
  className?: string;
}

// ponytail: drawn here because the free Nucleo UI Essential set has no arrow-up; swap for
// IconArrowUpOutline18 if the full Nucleo UI package is licensed.
export function ArrowUpIcon({ className }: ArrowUpIconProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.67"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-3", className)}
    >
      <path d="M6 10.5V1.5M2 5.5 6 1.5l4 4" />
    </svg>
  );
}
