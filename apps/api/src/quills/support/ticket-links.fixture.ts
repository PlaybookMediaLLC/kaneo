import { fixture } from "../framework/contract";
import { onTicket, seed, seedFor, type Ids } from "./seed.fixture";

export const getQuillsTicketLinks = onTicket(
  undefined,
  undefined,
  "trackerId",
  ["links"],
);
export const linkQuillsTicketToTracker = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { ticketId: a.ticketId, trackerTicketId: a.trackerId },
  }),
  foreign: ({ b }: Ids) => ({
    ticketId: b.ticketId,
    trackerTicketId: b.trackerId,
  }),
});
export const unlinkQuillsTicketFromTracker = fixture({
  seed: seedFor("links"),
  valid: ({ a }: Ids) => ({
    params: { ticketId: a.trackedId, trackerTicketId: a.trackerId },
  }),
  foreign: ({ b }: Ids) => ({
    ticketId: b.trackedId,
    trackerTicketId: b.trackerId,
  }),
});
export const linkQuillsTicketToConversation = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { ticketId: a.ticketId, conversationId: a.conversationId },
  }),
  foreign: ({ b }: Ids) => ({
    ticketId: b.ticketId,
    conversationId: b.conversationId,
  }),
});
export const listQuillsTicketConversations = onTicket(
  undefined,
  undefined,
  "backOfficeId",
  ["links"],
);
