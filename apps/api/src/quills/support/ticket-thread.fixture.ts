import { onTicket } from "./seed.fixture";

export const listQuillsTicketMessages = onTicket(() => ({
  query: { includeInternal: "true" },
}));
export const replyQuillsTicket = onTicket(() => ({
  body: { content: "We are on it." },
}));
export const addQuillsTicketNote = onTicket(
  () => ({
    body: { content: "Checked the logs.", shareWithConversation: true },
  }),
  () => ({}),
  "backOfficeId",
  ["links"],
);
export const listQuillsTicketActivity = onTicket();
