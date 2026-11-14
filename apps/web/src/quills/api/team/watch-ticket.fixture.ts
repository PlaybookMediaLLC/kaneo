import type { WatchTicketResponse } from "./watch-ticket";
export const watchTicketFixture = {
  ok: (overrides: Partial<WatchTicketResponse> = {}) =>
    ({
      ...{ watching: false, reason: "requester", mutedUntil: null },
      ...overrides,
    }) satisfies WatchTicketResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
