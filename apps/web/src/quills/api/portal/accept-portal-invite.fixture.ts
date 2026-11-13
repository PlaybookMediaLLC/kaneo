import type { AcceptPortalInviteResponse } from "./accept-portal-invite";
export const acceptPortalInviteFixture = {
  ok: (overrides: Partial<AcceptPortalInviteResponse> = {}) =>
    ({
      accepted: true,
      alreadyAccepted: false,
      ...overrides,
    }) satisfies AcceptPortalInviteResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
