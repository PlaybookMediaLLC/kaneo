import { useTranslation } from "react-i18next";
import { relativeTime } from "../../../core/relative-time";
import { cn } from "../../../ui/upstream";
import {
  activityText,
  type TicketMessage,
  type TimelineEntry,
} from "../timeline";

export interface TicketTimelineProps {
  entries: readonly TimelineEntry[];
}

const senderKeys = {
  visitor: "team-tickets.requester",
  agent: "team-tickets.teammate",
  system: "team-tickets.system",
} as const;

/** The thread of a ticket: messages, internal notes and changes, oldest first. */
export function TicketTimeline({ entries }: TicketTimelineProps) {
  const { t, i18n } = useTranslation("quills");
  const sender = (message: TicketMessage) =>
    (message.senderType !== "system" && message.author?.displayName) ||
    t(senderKeys[message.senderType]);
  const time = (at: string) => (
    <time dateTime={at} className="text-xs text-muted-foreground">
      {relativeTime(at, i18n.language)}
    </time>
  );
  if (!entries.length)
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {t("team-tickets.noMessages")}
      </p>
    );
  return (
    <ol
      aria-label={t("team-tickets.thread")}
      className="flex flex-col gap-3 px-4 py-4"
    >
      {entries.map((entry) =>
        entry.kind === "activity" ? (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-x-2 px-1 text-xs text-muted-foreground"
          >
            <span>
              {activityText(entry.activity, (key, values) => t(key, values))}
            </span>
            {time(entry.at)}
          </li>
        ) : (
          <li
            key={entry.id}
            className={cn(
              "rounded-lg border border-border px-4 py-3",
              entry.message.isInternal && "border-warning/30 bg-warning/10",
            )}
          >
            <p className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold">{sender(entry.message)}</span>
              {entry.message.isInternal ? (
                <span className="rounded-md border border-border px-1.5 text-muted-foreground">
                  {t("team-tickets.note")}
                </span>
              ) : null}
              {time(entry.at)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {entry.message.content}
            </p>
          </li>
        ),
      )}
    </ol>
  );
}
