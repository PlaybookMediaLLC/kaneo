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
    <section aria-labelledby="conversation-messages-heading">
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
              <li key={message.id}>
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
