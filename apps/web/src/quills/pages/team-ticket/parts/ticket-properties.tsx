import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { relativeTime } from "../../../core/relative-time";
import { useSetTicketPriority } from "../../../hooks/team/use-set-ticket-priority";
import { useTeamRuntime } from "../../../team/runtime";
import { PropertyRow } from "../../../ui/inbox/property-row";
import { PRIORITIES, PRIORITY_KEYS } from "../../team-tickets/ticket-scope";
import { TicketAi } from "./ticket-ai";
import { TicketLinks } from "./ticket-links";
import { TicketSelect } from "./ticket-select";
import { TicketWatchers } from "./ticket-watchers";

export interface TicketPropertiesProps {
  ticket: GetTicketResponse;
}

/** The properties panel of a ticket. The header holds the status and assignee pickers. */
export function TicketProperties({ ticket }: TicketPropertiesProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const setPriority = useSetTicketPriority(team.viewer);
  const { assignee } = ticket;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <PropertyRow label={t("team-tickets.status")}>
          {ticket.status.name}
        </PropertyRow>
        <PropertyRow label={t("team-tickets.priorityLabel")}>
          <TicketSelect
            label={t("team-tickets.priorityLabel")}
            value={ticket.priority}
            options={PRIORITIES.map((value) => ({
              value,
              label: t(PRIORITY_KEYS[value]),
            }))}
            disabled={!team.permissions.update || setPriority.isPending}
            onChange={(priority) =>
              setPriority.mutate({
                param: { workspaceId: team.workspaceId, ticketId: ticket.id },
                json: { priority: priority as GetTicketResponse["priority"] },
              })
            }
          />
        </PropertyRow>
        <PropertyRow label={t("team-tickets.assignee")}>
          {assignee.displayName ??
            assignee.teamName ??
            t("team-tickets.unassigned")}
        </PropertyRow>
        <PropertyRow label={t("team-tickets.type")}>
          {ticket.ticketType?.name ?? t("team-tickets.noType")}
        </PropertyRow>
        <PropertyRow label={t("team-tickets.requester")}>
          {ticket.requester?.displayName ?? t("team-tickets.noRequester")}
        </PropertyRow>
        {ticket.company ? (
          <PropertyRow label={t("team-tickets.company")}>
            {ticket.company.name}
          </PropertyRow>
        ) : null}
        <PropertyRow label={t("team-tickets.created")}>
          <time dateTime={ticket.createdAt}>
            {relativeTime(ticket.createdAt, i18n.language)}
          </time>
        </PropertyRow>
        {setPriority.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {t("team-tickets.failed")}
          </p>
        ) : null}
      </div>
      <TicketWatchers ticketId={ticket.id} />
      <TicketLinks ticketId={ticket.id} />
      <TicketAi ticket={ticket} />
    </div>
  );
}
