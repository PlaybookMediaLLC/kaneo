import { useTranslation } from "react-i18next";

export interface ConversationMessagesProps {
  messages: Array<{
    id: string;
    fromVisitor: boolean;
    senderType: string;
    author: { name: string | null } | null;
    content: string;
    attachments: Array<{ name: string }>;
    createdAt: string;
  }>;
}

export function ConversationMessages({ messages }: ConversationMessagesProps) {
  const { t } = useTranslation("quills");
  return (
    <section
      className="portal-messages mt-8 [&>h2]:mb-5 [&>h2]:text-base [&>h2]:font-medium [&_ol]:grid [&_ol]:gap-5 [&_li]:max-w-[95%] md:[&_li]:max-w-[85%] [&_li]:rounded-2xl [&_li]:rounded-bl-sm [&_li]:border [&_li]:border-border [&_li]:bg-muted [&_li]:px-5 [&_li]:py-4 [&_li[data-sender=customer]]:justify-self-end [&_li[data-sender=customer]]:rounded-bl-2xl [&_li[data-sender=customer]]:rounded-br-sm [&_li[data-sender=customer]]:bg-primary/5 [&_li>p:first-child]:mb-2 [&_li>p:first-child]:text-xs [&_li>p:first-child]:font-semibold [&_li>p]:whitespace-pre-wrap [&_li>p]:break-words [&_time]:mt-3 [&_time]:block"
      aria-labelledby="conversation-messages-heading"
    >
      <h2 id="conversation-messages-heading">{t("conversation.messages")}</h2>
      {messages.length ? (
        <ol>
          {messages.map((message) => {
            const sender = message.fromVisitor
              ? t("conversation.you")
              : message.senderType === "system"
                ? t("conversation.system")
                : message.author?.name?.trim() || t("conversation.support");
            return (
              <li
                key={message.id}
                data-sender={message.fromVisitor ? "customer" : "team"}
              >
                <p>{sender}</p>
                <p>{message.content}</p>
                {message.attachments.map((attachment) => (
                  <p key={`${message.id}:${attachment.name}`}>
                    {t("conversation.attachment", { name: attachment.name })}
                  </p>
                ))}
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString()}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>{t("conversation.noMessages")}</p>
      )}
    </section>
  );
}
