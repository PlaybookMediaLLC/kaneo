import { onTicket } from "./seed.fixture";

export const markQuillsTicketRead = onTicket();
export const markQuillsTicketUnread = onTicket(
  ({ a }) => ({ body: { messageId: a.messageId } }),
  ({ b }) => ({ messageId: b.messageId }),
);
