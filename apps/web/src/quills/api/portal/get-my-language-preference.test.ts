import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getMyLanguagePreference } from "./get-my-language-preference";
import { getMyLanguagePreferenceFixture } from "./get-my-language-preference.fixture";
describe("getMyLanguagePreference", () => {
  describeOperationContract({
    operationId: "getQuillsMyLanguagePreference",
    operation: getMyLanguagePreference,
    request: { param: { workspace: "workspace_test_1" } },
    response: getMyLanguagePreferenceFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/user/language",
    statuses: [401, 403, 404],
  });
});
