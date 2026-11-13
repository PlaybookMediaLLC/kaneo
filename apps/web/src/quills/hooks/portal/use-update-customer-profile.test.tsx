import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { updateCustomerProfileFixture } from "../../api/portal/update-customer-profile.fixture";
import { useUpdateCustomerProfile } from "./use-update-customer-profile";
describe("useUpdateCustomerProfile", () => {
  describeHookContract({
    kind: "mutation",
    hook: useUpdateCustomerProfile,
    operationId: "updateQuillsCustomerProfile",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { name: "value" },
    },
    response: updateCustomerProfileFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getCustomerProfile",
      ),
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getPublicUserProfile",
      ),
    ],
  });
});
