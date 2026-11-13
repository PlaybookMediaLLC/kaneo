import { useTranslation } from "react-i18next";
import type { ListMyConversationsResponse } from "../../../api/support/list-my-conversations";
import { portalHref } from "../../../core/portal-href";
import { Card, CardContent, CardHeader, CardTitle } from "../../../ui/upstream";

type Conversation = ListMyConversationsResponse["items"][number];
export interface ConversationListProps {
  workspaceId: string;
  conversations: Conversation[];
}
export function ConversationList({
  workspaceId,
  conversations,
}: ConversationListProps) {
  const { t } = useTranslation("quills");
  return (
    <div>
      {conversations.map((conversation) => {
        const subject =
          conversation.subject?.trim() || t("support.subjectMissing");
        return (
          <Card key={conversation.id}>
            <CardHeader>
              <CardTitle>
                <a
                  href={portalHref(
                    workspaceId,
                    `conversations/${conversation.id}`,
                  )}
                  aria-label={t("support.openConversation", { subject })}
                >
                  {subject}
                </a>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                {conversation.preview?.trim() || t("support.previewMissing")}
              </p>
              {conversation.unreadCount ? (
                <p>
                  {t("support.unread", { count: conversation.unreadCount })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
