import {
  AlarmClock,
  CircleCheck,
  Flag,
  type LucideIcon,
  RotateCcw,
  Star,
  Ticket,
  UserRound,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ListConversationMessagesResponse } from "../../../api/team/list-conversation-messages";
import { useGetConversationTyping } from "../../../hooks/team/use-get-conversation-typing";
import { useTeamRuntime } from "../../../team/runtime";
import { DateSeparator } from "../../../ui/inbox/date-separator";
import { MessageBubble } from "../../../ui/inbox/message-bubble";
import { SystemEvent } from "../../../ui/inbox/system-event";
import type { Teammate } from "../../team-conversations/conversation-list";

type Message = ListConversationMessagesResponse["items"][number];

export interface MessageListProps {
  workspaceId: string;
  conversationId: string;
  /** Newest first, as the API returns them. */
  messages: readonly Message[];
  customerName: string;
  /** The teammates, for the avatars of team replies. */
  people: readonly Teammate[];
}

const eventIcons: Record<string, LucideIcon> = {
  chat_ended: CircleCheck,
  chat_reopened: RotateCcw,
  assigned: UserRound,
  snoozed: AlarmClock,
  priority_changed: Flag,
  ticket_created: Ticket,
  ticket_linked: Ticket,
  ticket_status_changed: Ticket,
  csat_submitted: Star,
};

const day = (iso: string) => new Date(iso).toDateString();

/**
 * The thread (design section 2): day separators, customer messages on the left, team replies
 * and notes on the right, events as centered lines, and the customer's typing. The newest
 * message scrolls into view.
 */
export function MessageList(props: MessageListProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const typing = useGetConversationTyping(
    {
      param: {
        workspaceId: props.workspaceId,
        conversationId: props.conversationId,
      },
    },
    team.viewer,
  );
  const end = useRef<HTMLParagraphElement>(null);
  const newest = props.messages[0]?.id;
  useEffect(() => {
    if (newest) end.current?.scrollIntoView?.({ block: "end" });
  }, [newest]);
  const messages = [...props.messages].reverse();
  const avatar = (id: string | null) =>
    props.people.find((person) => person.id === id)?.avatarUrl;
  return (
    <section
      aria-labelledby="conversation-thread"
      className="mx-auto grid w-full max-w-205 gap-3"
    >
      <h2 id="conversation-thread" className="sr-only">
        {t("team-conversations.thread")}
      </h2>
      {messages.length ? null : (
        <p className="text-sm text-muted-foreground">
          {t("team-conversations.noMessages")}
        </p>
      )}
      <ol className="grid gap-3">
        {messages.map((message, index) => (
          <li key={message.id} className="grid gap-3">
            {index === 0 ||
            day(messages[index - 1]!.createdAt) !== day(message.createdAt) ? (
              <DateSeparator date={message.createdAt} />
            ) : null}
            {message.senderType === "system" ? (
              <SystemEvent
                icon={eventIcons[message.systemKind ?? ""]}
                time={message.createdAt}
              >
                {message.content}
              </SystemEvent>
            ) : (
              <MessageBubble
                kind={
                  message.isInternal
                    ? "note"
                    : message.senderType === "agent"
                      ? "team"
                      : "customer"
                }
                author={
                  message.senderType === "visitor"
                    ? { name: props.customerName }
                    : {
                        name:
                          message.authorName ??
                          t("team-conversations.teammate"),
                        avatarUrl: avatar(message.authorPrincipalId),
                      }
                }
                time={message.createdAt}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.attachments.map((file) => (
                  <p
                    key={`${message.id}:${file.name}`}
                    className="mt-1 text-xs opacity-80"
                  >
                    {t("team-conversations.attachment", { name: file.name })}
                  </p>
                ))}
              </MessageBubble>
            )}
          </li>
        ))}
      </ol>
      <p
        ref={end}
        role="status"
        className="min-h-5 text-xs text-muted-foreground"
      >
        {typing.data?.visitorTyping
          ? t("team-conversations.typing", { name: props.customerName })
          : null}
      </p>
    </section>
  );
}
