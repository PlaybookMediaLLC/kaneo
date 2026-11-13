import type { GetCustomerProfileResponse } from "./get-customer-profile";
export const getCustomerProfileFixture = {
  ok: (overrides: Partial<GetCustomerProfileResponse> = {}) =>
    ({
      ...{
        linked: false,
        principalId: null,
        customerId: null,
        name: "Test customer",
        email: "customer@example.test",
        avatarUrl: null,
      },
      ...overrides,
    }) satisfies GetCustomerProfileResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
