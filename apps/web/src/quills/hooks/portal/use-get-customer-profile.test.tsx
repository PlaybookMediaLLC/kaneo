import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getCustomerProfileFixture } from "../../api/portal/get-customer-profile.fixture";
import { useGetCustomerProfile } from "./use-get-customer-profile";
describe("useGetCustomerProfile", () => {
  describeHookContract({
    kind: "query",
    hook: useGetCustomerProfile,
    operationId: "getQuillsCustomerProfile",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getCustomerProfileFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
