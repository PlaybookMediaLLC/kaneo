import type { ListNotificationsResponse } from "./list-notifications";
export const listNotificationsFixture = {
  ok: (overrides: Partial<ListNotificationsResponse> = {}) =>
    ({
      ...{ notifications: [], total: 0, unreadCount: 0, hasMore: false },
      ...overrides,
    }) satisfies ListNotificationsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
