import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "../upstream";

export interface ConversationDetailProps {
  conversation: {
    subject: string | null;
    status: string;
    isReadOnly: boolean;
  };
  teamTyping: boolean;
}

export function ConversationDetail({
  conversation,
  teamTyping,
}: ConversationDetailProps) {
  const { t } = useTranslation("quills");
  return (
    <Card className="portal-detail-card mb-7 rounded-2xl shadow-none [&_[data-slot=card-title]]:text-2xl [&_[data-slot=card-title]]:leading-snug [&_[data-slot=card-title]]:tracking-tight [&_[data-slot=card-header]>p]:text-sm [&_[data-slot=card-header]>p]:text-muted-foreground">
      <CardHeader>
        <CardTitle>
          {conversation.subject?.trim() || t("conversation.fallbackSubject")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p>{t("conversation.status", { status: conversation.status })}</p>
        {conversation.isReadOnly ? (
          <p role="status">{t("conversation.readOnly")}</p>
        ) : null}
        {teamTyping ? <p role="status">{t("conversation.typing")}</p> : null}
      </CardContent>
    </Card>
  );
}
