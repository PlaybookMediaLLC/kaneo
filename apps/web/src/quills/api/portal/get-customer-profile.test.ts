import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getCustomerProfile } from "./get-customer-profile";
import { getCustomerProfileFixture } from "./get-customer-profile.fixture";
describe("getCustomerProfile", () => {
  describeOperationContract({
    operationId: "getQuillsCustomerProfile",
    operation: getCustomerProfile,
    request: { param: { workspace: "workspace_test_1" } },
    response: getCustomerProfileFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/user/profile",
    statuses: [401, 403, 404],
  });
});
