import { useTranslation } from "react-i18next";
import {
  useRecallScheduledMessage,
  useSendScheduledMessageNow,
} from "../../../hooks/team/use-scheduled-send";
import { useTeamRuntime } from "../../../team/runtime";
import { DateSeparator } from "../../../ui/inbox/date-separator";
import type { InboxPerson } from "../../../ui/inbox/inbox-types";
import { MessageBubble } from "../../../ui/inbox/message-bubble";
import { ScheduledSendFooter } from "../../../ui/inbox/scheduled-send-footer";
import { SystemEvent } from "../../../ui/inbox/system-event";
import type { Teammate } from "../ticket-scope";
import { activityText, type TimelineEntry } from "../timeline";

export interface TicketTimelineProps {
  entries: readonly TimelineEntry[];
  /** The requester, for the customer messages. */
  requester: InboxPerson;
  people?: readonly Teammate[];
  onRestoreDraft?: (content: string) => void;
}

const day = (at: string) => new Date(at).toDateString();

/**
 * The thread of a ticket, oldest first, with a separator for each day: customer messages on
 * the left, team replies and notes on the right, and changes as centered lines.
 */
export function TicketTimeline({
  entries,
  requester,
  people = [],
  onRestoreDraft,
}: TicketTimelineProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const recall = useRecallScheduledMessage(team.viewer);
  const sendNow = useSendScheduledMessageNow(team.viewer);
  const me = people.find((person) => person.userId === team.viewer.id);
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
                      ? "other"
                      : "self"
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
                footer={
                  message.sendStatus === "scheduled" &&
                  message.scheduledSendAt ? (
                    <ScheduledSendFooter
                      scheduledSendAt={message.scheduledSendAt}
                      recalling={
                        recall.isPending &&
                        recall.variables?.param.messageId === message.id
                      }
                      sendingNow={
                        sendNow.isPending &&
                        sendNow.variables?.param.messageId === message.id
                      }
                      canManage={
                        team.permissions.update &&
                        (message.author?.principalId === me?.id ||
                          team.permissions.manageSettings)
                      }
                      error={
                        (recall.error &&
                          recall.variables?.param.messageId === message.id) ||
                        (sendNow.error &&
                          sendNow.variables?.param.messageId === message.id)
                          ? t("core.problem.failed")
                          : null
                      }
                      onUndo={() => {
                        recall.reset();
                        sendNow.reset();
                        recall.mutate(
                          {
                            param: {
                              workspaceId: team.workspaceId,
                              messageId: message.id,
                            },
                          },
                          {
                            onSuccess: (res) => onRestoreDraft?.(res.content),
                          },
                        );
                      }}
                      onSendNow={() => {
                        recall.reset();
                        sendNow.reset();
                        sendNow.mutate({
                          param: {
                            workspaceId: team.workspaceId,
                            messageId: message.id,
                          },
                        });
                      }}
                    />
                  ) : null
                }
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
