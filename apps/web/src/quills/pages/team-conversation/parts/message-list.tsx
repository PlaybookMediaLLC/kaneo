import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ListConversationMessagesResponse } from "../../../api/team/list-conversation-messages";
import { useGetConversationTyping } from "../../../hooks/team/use-get-conversation-typing";
import { useTeamRuntime } from "../../../team/runtime";
import { teamHref } from "../../../team/team-href";
import { DateSeparator } from "../../../ui/inbox/date-separator";
import { MessageBubble } from "../../../ui/inbox/message-bubble";
import { SystemEvent } from "../../../ui/inbox/system-event";
import { arrivedClass, useArrived } from "../../../ui/inbox/use-arrived";
import { PageContext } from "../../../ui/page-context";
import { cn } from "../../../ui/upstream";
import type { Teammate } from "../../team-conversations/conversation-list";
import { AttachmentLink } from "./attachment-link";
import { eventIcons } from "../event-icons";

type Message = ListConversationMessagesResponse["items"][number];

export interface MessageListProps {
  workspaceId: string;
  conversationId: string;
  closed?: boolean;
  /** Newest first, as the API returns them. */
  messages: readonly Message[];
  customerName: string;
  customerAvatarUrl?: string | null;
  /** The teammates, for the avatars of team replies. */
  people: readonly Teammate[];
}

// Resolve and reopen notices name the teammate who acted: "You resolved this conversation".
const actorKeys: Record<string, { you: string; named: string }> = {
  chat_ended: {
    you: "team-conversations.events.resolvedByYou",
    named: "team-conversations.events.resolvedBy",
  },
  chat_reopened: {
    you: "team-conversations.events.reopenedByYou",
    named: "team-conversations.events.reopenedBy",
  },
};

const day = (iso: string) => new Date(iso).toDateString();

/** The thread (design section 2): day separators, customer messages left, team replies and notes
 * right, events as centered lines and the customer's typing. The newest message scrolls in. */
export function MessageList(props: MessageListProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const typing = useGetConversationTyping(
    {
      param: {
        workspaceId: props.workspaceId,
        conversationId: props.closed ? "" : props.conversationId,
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
  const arrived = useArrived(
    messages.map((message) => message.id),
    props.conversationId,
  );
  const peopleById = new Map(props.people.map((person) => [person.id, person]));
  const avatar = (id: string | null) =>
    id ? peopleById.get(id)?.avatarUrl : undefined;
  const me = props.people.find((person) => person.userId === team.viewer.id);
  // An unknown teammate, automation and older rows keep the stored text.
  const eventText = (message: Message) => {
    const keys = actorKeys[message.systemKind ?? ""];
    const actor = message.systemActorPrincipalId;
    if (!keys || !actor) return message.content;
    if (actor === me?.id) return t(keys.you);
    const name = peopleById.get(actor)?.name;
    return name ? t(keys.named, { name }) : message.content;
  };
  return (
    <section
      aria-labelledby="conversation-thread"
      className="mx-auto grid w-full max-w-200 gap-3"
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
          <li
            key={message.id}
            className={cn("grid gap-3", arrived(message.id) && arrivedClass)}
          >
            {index === 0 ||
            day(messages[index - 1]!.createdAt) !== day(message.createdAt) ? (
              <DateSeparator date={message.createdAt} />
            ) : null}
            {message.senderType === "system" ? (
              <SystemEvent
                icon={eventIcons[message.systemKind ?? ""]}
                time={message.createdAt}
              >
                {eventText(message)}
              </SystemEvent>
            ) : (
              <MessageBubble
                kind={
                  message.isInternal
                    ? "note"
                    : message.senderType === "agent"
                      ? "self"
                      : "other"
                }
                author={
                  message.senderType === "visitor"
                    ? {
                        name: props.customerName,
                        avatarUrl: props.customerAvatarUrl,
                      }
                    : {
                        name:
                          message.authorName ??
                          t("team-conversations.teammate"),
                        avatarUrl: avatar(message.authorPrincipalId),
                      }
                }
                time={message.createdAt}
              >
                {message.content ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : null}
                {/* A request shared from the right panel is an embed with no text. */}
                {message.embeds
                  .filter((embed) => embed.kind === "post")
                  .map((embed) => (
                    <Link
                      key={`${message.id}:${embed.id}`}
                      to={teamHref(props.workspaceId, `/posts/${embed.id}`)}
                      className="block underline underline-offset-4"
                    >
                      {t("team-conversations.sharedRequest")}
                    </Link>
                  ))}
                {message.attachments.map((file, index) => (
                  <AttachmentLink
                    key={file.fileId ?? `${message.id}:${index}`}
                    workspaceId={props.workspaceId}
                    fileId={file.fileId}
                    name={file.name}
                  />
                ))}
                {message.senderType === "visitor" ? (
                  <PageContext
                    context={message.widgetMetadata}
                    className="mt-1 opacity-80"
                  />
                ) : null}
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
