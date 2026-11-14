import type { MuteTicketResponse } from "./mute-ticket";
export const muteTicketFixture = {
  ok: (overrides: Partial<MuteTicketResponse> = {}) =>
    ({
      ...{ watching: false, reason: "requester", mutedUntil: null },
      ...overrides,
    }) satisfies MuteTicketResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
