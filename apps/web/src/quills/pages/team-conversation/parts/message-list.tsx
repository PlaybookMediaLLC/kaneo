import { useTranslation } from "react-i18next";
import type { ListConversationMessagesResponse } from "../../../api/team/list-conversation-messages";
import { useGetConversationTyping } from "../../../hooks/team/use-get-conversation-typing";
import { useTeamRuntime } from "../../../team/runtime";
import { cn } from "../../../ui/upstream";

type Message = ListConversationMessagesResponse["items"][number];

export interface MessageListProps {
  workspaceId: string;
  conversationId: string;
  /** Newest first, as the API returns them. */
  messages: readonly Message[];
  customerName: string;
}

/** The thread: customer messages, team replies, internal notes and notices, and the customer's typing. */
export function MessageList(props: MessageListProps) {
  const { t, i18n } = useTranslation("quills");
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
  const time = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section aria-labelledby="conversation-thread" className="grid gap-4">
      <h2 id="conversation-thread" className="sr-only">
        {t("team-conversations.thread")}
      </h2>
      {props.messages.length ? null : (
        <p className="text-sm text-muted-foreground">
          {t("team-conversations.noMessages")}
        </p>
      )}
      <ol className="grid gap-4">
        {[...props.messages].reverse().map((message) =>
          message.senderType === "system" ? (
            <li
              key={message.id}
              className="text-center text-xs text-muted-foreground"
            >
              {message.content}
            </li>
          ) : (
            <li
              key={message.id}
              className={cn(
                "max-w-[85%] rounded-xl border px-4 py-3",
                message.isInternal
                  ? "justify-self-stretch border-dashed border-warning/40 bg-warning/8"
                  : message.senderType === "agent"
                    ? "justify-self-end border-border bg-primary/5"
                    : "justify-self-start border-border bg-muted",
              )}
            >
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {message.senderType === "visitor"
                    ? props.customerName
                    : (message.authorName ?? t("team-conversations.teammate"))}
                </span>
                {message.isInternal ? (
                  <span>{t("team-conversations.note")}</span>
                ) : null}
                <time dateTime={message.createdAt}>
                  {time.format(new Date(message.createdAt))}
                </time>
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.content}
              </p>
              {message.attachments.map((file) => (
                <p
                  key={`${message.id}:${file.name}`}
                  className="mt-1 text-xs text-muted-foreground"
                >
                  {t("team-conversations.attachment", { name: file.name })}
                </p>
              ))}
            </li>
          ),
        )}
      </ol>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">
        {typing.data?.visitorTyping
          ? t("team-conversations.typing", { name: props.customerName })
          : null}
      </p>
    </section>
  );
}
