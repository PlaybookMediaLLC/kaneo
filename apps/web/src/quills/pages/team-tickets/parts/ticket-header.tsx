import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import type { ThreadViewer } from "../../../hooks/team/use-thread-presence";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { ThreadViewersAvatars } from "../../../ui/inbox/thread-viewers-avatars";
import { PersonAvatar } from "../../../ui/person-avatar";
import type { Teammate, TicketStatus } from "../ticket-scope";
import { TicketAssignee } from "./ticket-assignee";
import { TicketMenu } from "./ticket-menu";
import { TicketStatusButton } from "./ticket-status-button";

export interface TicketHeaderProps {
  /** Undefined while the ticket loads: the heading still shows, so focus can land on it. */
  ticket?: GetTicketResponse;
  statuses: readonly TicketStatus[];
  people: readonly Teammate[];
  viewers?: readonly ThreadViewer[];
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** The one header of an open ticket: the requester and title, the assignee, the status and the menu. */
export function TicketHeader({
  ticket,
  statuses,
  people,
  viewers,
  onBack,
  onPrevious,
  onNext,
}: TicketHeaderProps) {
  const { t } = useTranslation("quills");
  const requester =
    ticket?.requester?.displayName ?? t("team-tickets.noRequester");
  return (
    <DetailHeader
      onBack={onBack}
      onPrevious={onPrevious}
      onNext={onNext}
      actions={
        ticket ? (
          <>
            {viewers?.length ? (
              <ThreadViewersAvatars viewers={viewers} />
            ) : null}
            <TicketAssignee ticket={ticket} people={people} />
            <TicketStatusButton ticket={ticket} statuses={statuses} />
            <TicketMenu
              ticketId={ticket.id}
              hasRequester={Boolean(ticket.requester)}
            />
          </>
        ) : null
      }
    >
      {ticket ? (
        <PersonAvatar
          colored
          name={requester}
          avatarUrl={ticket.requester?.avatarUrl}
          className="size-8 text-xs"
        />
      ) : null}
      <div className="min-w-0">
        <h1
          tabIndex={-1}
          title={ticket?.title}
          className="truncate font-semibold leading-tight outline-none"
        >
          {ticket?.title ?? t("team-tickets.ticket")}
        </h1>
        {ticket ? (
          <p className="truncate text-xs text-muted-foreground">
            {[ticket.reference, requester].join(" · ")}
          </p>
        ) : null}
      </div>
    </DetailHeader>
  );
}
