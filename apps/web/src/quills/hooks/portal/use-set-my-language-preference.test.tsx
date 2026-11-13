import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setMyLanguagePreferenceFixture } from "../../api/portal/set-my-language-preference.fixture";
import { useSetMyLanguagePreference } from "./use-set-my-language-preference";
describe("useSetMyLanguagePreference", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetMyLanguagePreference,
    operationId: "setQuillsMyLanguagePreference",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { language: null },
    },
    response: setMyLanguagePreferenceFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getMyLanguagePreference",
      ),
    ],
  });
});
