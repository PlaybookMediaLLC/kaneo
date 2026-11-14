import { ChevronDown, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { useAssignTicket } from "../../../hooks/team/use-assign-ticket";
import { useTeamRuntime } from "../../../team/runtime";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  Button,
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../../../ui/upstream";
import type { Teammate } from "../ticket-scope";

export interface TicketAssigneeProps {
  ticket: GetTicketResponse;
  people: readonly Teammate[];
}

const NOBODY = "unassigned";

/** The assignee pill of the ticket header: "You", a teammate or "Assign". It opens a teammate picker. */
export function TicketAssignee({ ticket, people }: TicketAssigneeProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const assign = useAssignTicket(team.viewer);
  const { assignee } = ticket;
  const me = people.find((person) => person.userId === team.viewer.id)?.id;
  const name = assignee.principalId
    ? assignee.principalId === me
      ? t("team-tickets.you")
      : (assignee.displayName ?? t("team-tickets.unnamed"))
    : assignee.teamName;
  const options = [
    { value: NOBODY, label: t("team-tickets.unassigned") },
    ...people.map((person) => ({
      value: person.id,
      label: person.name ?? t("team-tickets.unnamed"),
    })),
  ];
  // A former teammate stays visible as the current choice.
  if (
    assignee.principalId &&
    !options.some((option) => option.value === assignee.principalId)
  )
    options.push({
      value: assignee.principalId,
      label: assignee.displayName ?? t("team-tickets.unnamed"),
    });
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              aria-label={t("team-tickets.assigneeIs", {
                name: name ?? t("team-tickets.unassigned"),
              })}
            />
          }
          disabled={!team.permissions.update || assign.isPending}
        >
          {assignee.principalId ? (
            <PersonAvatar
              colored
              name={assignee.displayName}
              className="size-5"
            />
          ) : (
            <UserRound aria-hidden="true" />
          )}
          {name ?? t("team-tickets.assign")}
          <ChevronDown aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuRadioGroup
            value={assignee.principalId ?? NOBODY}
            onValueChange={(value) =>
              assign.mutate({
                param: { workspaceId: team.workspaceId, ticketId: ticket.id },
                json: {
                  assigneePrincipalId: value === NOBODY ? null : String(value),
                },
              })
            }
          >
            {options.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      {assign.error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {t("team-tickets.failed")}
        </p>
      ) : null}
    </>
  );
}
