import { useTranslation } from "react-i18next";
import { dayOf } from "../../core/short-date";

export interface DateSeparatorProps {
  /** An ISO time on the day that starts here. */
  date: string;
}

/** The day line of a thread: "Today", "Yesterday" or a date such as "Sat, Oct 31". */
export function DateSeparator({ date }: DateSeparatorProps) {
  const { t, i18n } = useTranslation("quills");
  const day = dayOf(date, i18n.language);
  const label =
    day.daysAgo === 0
      ? t("inbox.today")
      : day.daysAgo === 1
        ? t("inbox.yesterday")
        : day.label;
  return (
    <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <time dateTime={date} className="shrink-0 font-medium">
        {label}
      </time>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
