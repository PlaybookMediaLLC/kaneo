import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getMyWeeklyDigestPreferenceFixture } from "../../api/portal/get-my-weekly-digest-preference.fixture";
import { useGetMyWeeklyDigestPreference } from "./use-get-my-weekly-digest-preference";
describe("useGetMyWeeklyDigestPreference", () => {
  describeHookContract({
    kind: "query",
    hook: useGetMyWeeklyDigestPreference,
    operationId: "getQuillsMyWeeklyDigestPreference",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: getMyWeeklyDigestPreferenceFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
