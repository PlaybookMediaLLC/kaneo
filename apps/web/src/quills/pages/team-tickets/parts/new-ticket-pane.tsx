import { useTranslation } from "react-i18next";
import { useCreateTicket } from "../../../hooks/team/use-create-ticket";
import { useTeamRuntime } from "../../../team/runtime";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { NewTicketForm } from "./new-ticket-form";

export interface NewTicketPaneProps {
  onBack: () => void;
  /** Opens the new ticket. */
  onCreated: (ticketId: string) => void;
}

/** The main pane while a teammate writes a new ticket: "‹ New ticket" and the form card. */
export function NewTicketPane({ onBack, onCreated }: NewTicketPaneProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const create = useCreateTicket(team.viewer);
  return (
    <>
      <DetailHeader onBack={onBack}>
        <h1 tabIndex={-1} className="truncate font-semibold outline-none">
          {t("team-tickets.new.title")}
        </h1>
      </DetailHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-205 rounded-2xl border border-border px-4 py-2">
          <NewTicketForm
            onCancel={onBack}
            onSubmit={async ({ title, description }) => {
              const ticket = await create.mutateAsync({
                param: { workspaceId: team.workspaceId },
                json: { title, ...(description ? { description } : {}) },
              });
              onCreated(ticket.id);
            }}
          />
        </div>
      </div>
    </>
  );
}
