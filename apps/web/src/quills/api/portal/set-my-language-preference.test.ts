import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setMyLanguagePreference } from "./set-my-language-preference";
import { setMyLanguagePreferenceFixture } from "./set-my-language-preference.fixture";
describe("setMyLanguagePreference", () => {
  describeOperationContract({
    operationId: "setQuillsMyLanguagePreference",
    operation: setMyLanguagePreference,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { language: null },
    },
    response: setMyLanguagePreferenceFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/user/language",
    statuses: [401, 403, 404, 429],
  });
});
