import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { useSetTicketStatus } from "../../../hooks/team/use-set-ticket-status";
import { useTeamRuntime } from "../../../team/runtime";
import { Button, cn } from "../../../ui/upstream";
import type { TicketStatus } from "../ticket-scope";

export interface TicketStatusButtonProps {
  ticket: GetTicketResponse;
  /** The workspace ticket statuses, in their order. */
  statuses: readonly TicketStatus[];
}

/**
 * "Resolve" moves an open ticket to the first closed status. A closed ticket shows a green
 * pill with its status, which moves it back to the first open status.
 */
export function TicketStatusButton({
  ticket,
  statuses,
}: TicketStatusButtonProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const setStatus = useSetTicketStatus(team.viewer);
  const closed = ticket.status.category === "closed";
  const target = statuses.find(
    (status) => status.category === (closed ? "open" : "closed"),
  );
  if (!target) return null;
  return (
    <>
      <Button
        variant={closed ? "default" : "outline"}
        size="sm"
        className={cn(
          "rounded-full",
          closed && "border-success bg-success text-white hover:bg-success/90",
        )}
        aria-label={
          closed
            ? t("team-tickets.reopen", { status: ticket.status.name })
            : undefined
        }
        loading={setStatus.isPending}
        disabled={!team.permissions.update}
        onClick={() =>
          setStatus.mutate({
            param: { workspaceId: team.workspaceId, ticketId: ticket.id },
            json: { statusId: target.id },
          })
        }
      >
        <Check aria-hidden="true" />
        {closed ? ticket.status.name : t("team-tickets.resolve")}
      </Button>
      {setStatus.error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {t("team-tickets.failed")}
        </p>
      ) : null}
    </>
  );
}
