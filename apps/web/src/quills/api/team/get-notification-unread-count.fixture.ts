import type { GetNotificationUnreadCountResponse } from "./get-notification-unread-count";
export const getNotificationUnreadCountFixture = {
  ok: (overrides: Partial<GetNotificationUnreadCountResponse> = {}) =>
    ({
      ...{ count: 0 },
      ...overrides,
    }) satisfies GetNotificationUnreadCountResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
