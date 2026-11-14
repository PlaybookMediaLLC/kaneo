import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clockTime } from "../../core/short-date";

export interface SystemEventProps {
  icon?: LucideIcon;
  /** The event text, such as "You resolved this conversation". */
  children: ReactNode;
  /** An ISO time, shown after the text. */
  time?: string;
}

/** A centered gray line in a thread for an event, such as a status change or a bounce. */
export function SystemEvent({
  icon: Icon = Info,
  children,
  time,
}: SystemEventProps) {
  const { i18n } = useTranslation("quills");
  return (
    <p className="flex items-center justify-center gap-1.5 py-1 text-center text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{children}</span>
      {time ? (
        <>
          <span
            aria-hidden="true"
            className="size-0.5 rounded-full bg-current"
          />
          <time dateTime={time}>{clockTime(time, i18n.language)}</time>
        </>
      ) : null}
    </p>
  );
}
