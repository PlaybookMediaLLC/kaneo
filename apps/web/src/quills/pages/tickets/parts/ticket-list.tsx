import { useTranslation } from "react-i18next";
import type { GetMyTicketsResponse } from "../../../api/support/get-my-tickets";
import { portalHref } from "../../../core/portal-href";
import { Card, CardContent, CardHeader, CardTitle } from "../../../ui/upstream";

type Ticket = GetMyTicketsResponse["items"][number];
export interface TicketListProps {
  workspaceId: string;
  tickets: Ticket[];
}
export function TicketList({ workspaceId, tickets }: TicketListProps) {
  const { t } = useTranslation("quills");
  return (
    <div>
      {tickets.map((ticket) => (
        <Card key={ticket.id}>
          <CardHeader>
            <CardTitle>{ticket.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{t("tickets.reference", { reference: ticket.reference })}</p>
            <p>{ticket.stageLabel?.trim() || t("tickets.stageMissing")}</p>
            {ticket.conversationId ? (
              <a
                href={portalHref(
                  workspaceId,
                  `conversations/${ticket.conversationId}`,
                )}
                aria-label={t("tickets.openConversation", {
                  title: ticket.title,
                })}
              >
                {t("tickets.openConversation", { title: ticket.title })}
              </a>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
