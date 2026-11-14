import { useTranslation } from "react-i18next";
import { DateSeparator } from "../../../ui/inbox/date-separator";
import type { InboxPerson } from "../../../ui/inbox/inbox-types";
import { MessageBubble } from "../../../ui/inbox/message-bubble";
import { SystemEvent } from "../../../ui/inbox/system-event";
import { activityText, type TimelineEntry } from "../timeline";

export interface TicketTimelineProps {
  entries: readonly TimelineEntry[];
  /** The requester, for the customer messages. */
  requester: InboxPerson;
}

const day = (at: string) => new Date(at).toDateString();

/**
 * The thread of a ticket, oldest first, with a separator for each day: customer messages on
 * the left, team replies and notes on the right, and changes as centered lines.
 */
export function TicketTimeline({ entries, requester }: TicketTimelineProps) {
  const { t } = useTranslation("quills");
  if (!entries.length)
    return <SystemEvent>{t("team-tickets.noMessages")}</SystemEvent>;
  return (
    <ol aria-label={t("team-tickets.thread")} className="flex flex-col gap-4">
      {entries.map((entry, index) => {
        const previous = entries[index - 1];
        const message = entry.kind === "message" ? entry.message : null;
        return (
          <li key={entry.id} className="flex flex-col gap-4">
            {previous && day(previous.at) === day(entry.at) ? null : (
              <DateSeparator date={entry.at} />
            )}
            {entry.kind === "activity" ? (
              <SystemEvent time={entry.at}>
                {activityText(entry.activity, (key, values) => t(key, values))}
              </SystemEvent>
            ) : !message || message.senderType === "system" ? (
              <SystemEvent time={entry.at}>{message?.content}</SystemEvent>
            ) : (
              <MessageBubble
                kind={
                  message.isInternal
                    ? "note"
                    : message.senderType === "visitor"
                      ? "customer"
                      : "team"
                }
                author={
                  message.senderType === "visitor"
                    ? {
                        name: message.author?.displayName ?? requester.name,
                        avatarUrl: requester.avatarUrl,
                      }
                    : {
                        name:
                          message.author?.displayName ??
                          t("team-tickets.teammate"),
                      }
                }
                time={entry.at}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </MessageBubble>
            )}
          </li>
        );
      })}
    </ol>
  );
}
