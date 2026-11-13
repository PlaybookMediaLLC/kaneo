import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { updateCustomerProfile } from "./update-customer-profile";
import { updateCustomerProfileFixture } from "./update-customer-profile.fixture";
describe("updateCustomerProfile", () => {
  describeOperationContract({
    operationId: "updateQuillsCustomerProfile",
    operation: updateCustomerProfile,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { name: "value" },
    },
    response: updateCustomerProfileFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/user/profile",
    statuses: [401, 403, 404, 429],
  });
});
