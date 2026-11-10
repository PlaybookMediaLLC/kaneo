import { fixture } from "../framework/contract";
import { onTicket, seed, type Ids } from "./seed.fixture";

export const listQuillsTickets = fixture({ seed, valid: () => ({}) });
export const getQuillsTicket = onTicket();
export const createQuillsTicket = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      ticketTypeId: a.ticketTypeId,
      title: "Cannot log in",
      description: "The login page spins.",
      priority: "high",
      requesterPrincipalId: a.customerId,
      assigneePrincipalId: a.teammateId,
      companyId: a.companyId,
      customAttributes: { severity: "high" },
    },
  }),
  foreign: ({ b }: Ids) => ({
    ticketTypeId: b.ticketTypeId,
    requesterPrincipalId: b.customerId,
    assigneePrincipalId: b.teammateId,
    companyId: b.companyId,
  }),
});
export const setQuillsTicketStatus = onTicket(
  ({ a }) => ({ body: { statusId: a.otherStatusId } }),
  ({ b }) => ({ statusId: b.otherStatusId }),
);
export const setQuillsTicketPriority = onTicket(() => ({
  body: { priority: "urgent" },
}));
export const assignQuillsTicket = onTicket(
  ({ a }) => ({
    body: { assigneePrincipalId: a.teammateId, assigneeTeamId: a.teamId },
  }),
  ({ b }) => ({ assigneePrincipalId: b.teammateId, assigneeTeamId: b.teamId }),
);
export const bulkUpdateQuillsTickets = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      ticketIds: [a.ticketId, a.trackerId],
      action: { type: "set_status", statusId: a.closedStatusId },
    },
  }),
});
