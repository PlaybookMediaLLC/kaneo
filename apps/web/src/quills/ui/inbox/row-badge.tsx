import { Badge } from "../upstream";
import type { InboxBadge } from "./inbox-types";

export interface RowBadgeProps {
  badge: InboxBadge;
}

const variants = {
  neutral: "outline",
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
} as const;

/** One small caps status badge of an inbox row. */
export function RowBadge({ badge }: RowBadgeProps) {
  return (
    <Badge
      variant={variants[badge.tone ?? "neutral"]}
      size="sm"
      className="font-semibold uppercase tracking-wide"
    >
      {badge.label}
    </Badge>
  );
}
