import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { relativeTime } from "../../../core/relative-time";
import { useSetTicketPriority } from "../../../hooks/team/use-set-ticket-priority";
import { useSetTicketStatus } from "../../../hooks/team/use-set-ticket-status";
import { useTeamRuntime } from "../../../team/runtime";
import { PropertyRow } from "../../../ui/inbox/property-row";
import { PersonAvatar } from "../../../ui/person-avatar";
import { PRIORITIES, PRIORITY_KEYS, type TicketStatus } from "../ticket-scope";
import { TicketAi } from "./ticket-ai";
import { TicketLinks } from "./ticket-links";
import { TicketSelect } from "./ticket-select";
import { TicketWatchers } from "./ticket-watchers";

export interface TicketPropertiesProps {
  ticket: GetTicketResponse;
  /** The workspace ticket statuses, for the status picker. */
  statuses: readonly TicketStatus[];
}

/** The right panel of a ticket: the requester, the properties, the watchers, the links and AI. */
export function TicketProperties({ ticket, statuses }: TicketPropertiesProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const setStatus = useSetTicketStatus(team.viewer);
  const setPriority = useSetTicketPriority(team.viewer);
  const param = { workspaceId: team.workspaceId, ticketId: ticket.id };
  const locked = !team.permissions.update;
  const requester =
    ticket.requester?.displayName ?? t("team-tickets.noRequester");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <PersonAvatar
          colored
          name={requester}
          avatarUrl={ticket.requester?.avatarUrl}
          className="size-14 text-lg"
        />
        <p className="font-semibold">{requester}</p>
        {ticket.company ? (
          <p className="text-sm text-muted-foreground">{ticket.company.name}</p>
        ) : null}
      </div>
      <div>
        <PropertyRow label={t("team-tickets.status")}>
          <TicketSelect
            label={t("team-tickets.status")}
            value={ticket.status.id}
            options={
              statuses.length
                ? statuses.map((status) => ({
                    value: status.id,
                    label: status.name,
                  }))
                : [{ value: ticket.status.id, label: ticket.status.name }]
            }
            disabled={locked || setStatus.isPending}
            onChange={(statusId) =>
              setStatus.mutate({ param, json: { statusId } })
            }
          />
        </PropertyRow>
        <PropertyRow label={t("team-tickets.priorityLabel")}>
          <TicketSelect
            label={t("team-tickets.priorityLabel")}
            value={ticket.priority}
            options={PRIORITIES.map((value) => ({
              value,
              label: t(PRIORITY_KEYS[value]),
            }))}
            disabled={locked || setPriority.isPending}
            onChange={(priority) =>
              setPriority.mutate({
                param,
                json: { priority: priority as GetTicketResponse["priority"] },
              })
            }
          />
        </PropertyRow>
        <PropertyRow label={t("team-tickets.type")}>
          {ticket.ticketType?.name ?? t("team-tickets.noType")}
        </PropertyRow>
        <PropertyRow label={t("team-tickets.created")}>
          <time dateTime={ticket.createdAt}>
            {relativeTime(ticket.createdAt, i18n.language)}
          </time>
        </PropertyRow>
        {setStatus.error || setPriority.error ? (
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
