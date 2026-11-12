import { fixture } from "../framework/contract";

/** A settings read that needs manage_settings and a read that needs read. */
export const readQuillsTogether = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      reads: [
        { operationId: "getQuillsOfficeHours" },
        { operationId: "listQuillsTicketStatuses" },
      ],
    },
  }),
});
