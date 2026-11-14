import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { setMyWeeklyDigestPreferenceFixture } from "../../api/portal/set-my-weekly-digest-preference.fixture";
import { useSetMyWeeklyDigestPreference } from "./use-set-my-weekly-digest-preference";
describe("useSetMyWeeklyDigestPreference", () => {
  describeHookContract({
    kind: "mutation",
    hook: useSetMyWeeklyDigestPreference,
    operationId: "setQuillsMyWeeklyDigestPreference",
    request: {
      param: { workspace: "workspace_test_1" },
      json: { weeklyDigest: false },
    },
    response: setMyWeeklyDigestPreferenceFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "getMyWeeklyDigestPreference",
      ),
    ],
  });
});
