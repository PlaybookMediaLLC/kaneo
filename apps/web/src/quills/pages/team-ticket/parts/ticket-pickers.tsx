import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { useAssignTicket } from "../../../hooks/team/use-assign-ticket";
import { useListPrincipals } from "../../../hooks/team/use-list-principals";
import { useListTicketStatuses } from "../../../hooks/team/use-list-ticket-statuses";
import { useSetTicketStatus } from "../../../hooks/team/use-set-ticket-status";
import { useTeamRuntime } from "../../../team/runtime";
import { TicketSelect } from "./ticket-select";

export interface TicketPickersProps {
  ticket: GetTicketResponse;
}

const unassigned = "unassigned";

/** The status and assignee pickers of the ticket header. */
export function TicketPickers({ ticket }: TicketPickersProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const { workspaceId, viewer } = team;
  const param = { workspaceId, ticketId: ticket.id };
  const statuses = useListTicketStatuses({ param: { workspaceId } }, viewer);
  // ponytail: the first 100 teammates (the API page size); add search when a workspace has more.
  const people = useListPrincipals(
    { param: { workspaceId }, query: {} },
    viewer,
  );
  const setStatus = useSetTicketStatus(viewer);
  const assign = useAssignTicket(viewer);
  const current = ticket.assignee.principalId;
  const assignees = [
    { value: unassigned, label: t("team-tickets.unassigned") },
    ...(people.data?.items ?? []).map((person) => ({
      value: person.id,
      label: person.name ?? t("team-tickets.unnamed"),
    })),
  ];
  if (current && !assignees.some((option) => option.value === current))
    assignees.push({
      value: current,
      label: ticket.assignee.displayName ?? t("team-tickets.unnamed"),
    });
  const locked = !team.permissions.update;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <TicketSelect
        label={t("team-tickets.status")}
        value={ticket.status.id}
        options={
          statuses.data?.items.map((status) => ({
            value: status.id,
            label: status.name,
          })) ?? [{ value: ticket.status.id, label: ticket.status.name }]
        }
        disabled={locked || setStatus.isPending}
        onChange={(statusId) => setStatus.mutate({ param, json: { statusId } })}
      />
      <TicketSelect
        label={t("team-tickets.assignee")}
        value={current ?? unassigned}
        options={assignees}
        disabled={locked || assign.isPending}
        onChange={(id) =>
          assign.mutate({
            param,
            json: { assigneePrincipalId: id === unassigned ? null : id },
          })
        }
      />
      {setStatus.error || assign.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {t("team-tickets.failed")}
        </p>
      ) : null}
    </div>
  );
}
