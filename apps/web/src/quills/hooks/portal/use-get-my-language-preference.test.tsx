import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getMyLanguagePreferenceFixture } from "../../api/portal/get-my-language-preference.fixture";
import { useGetMyLanguagePreference } from "./use-get-my-language-preference";
describe("useGetMyLanguagePreference", () => {
  describeHookContract({
    kind: "query",
    hook: useGetMyLanguagePreference,
    operationId: "getQuillsMyLanguagePreference",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getMyLanguagePreferenceFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
