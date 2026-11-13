import type { UpdateCustomerProfileResponse } from "./update-customer-profile";
export const updateCustomerProfileFixture = {
  ok: (overrides: Partial<UpdateCustomerProfileResponse> = {}) =>
    ({
      ...{
        linked: true,
        principalId: "principal_test_1",
        customerId: "user_test_1",
        name: "Test customer",
        email: "customer@example.test",
        avatarUrl: null,
      },
      ...overrides,
    }) satisfies UpdateCustomerProfileResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
