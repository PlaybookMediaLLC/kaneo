import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { getMyWeeklyDigestPreference } from "./get-my-weekly-digest-preference";
import { getMyWeeklyDigestPreferenceFixture } from "./get-my-weekly-digest-preference.fixture";
describe("getMyWeeklyDigestPreference", () => {
  describeOperationContract({
    operationId: "getQuillsMyWeeklyDigestPreference",
    operation: getMyWeeklyDigestPreference,
    request: { param: { workspace: "workspace_test_1" } },
    response: getMyWeeklyDigestPreferenceFixture.ok(),
    method: "get",
    path: "/api/quills-public/workspace_test_1/user/weekly-digest",
    statuses: [401, 403, 404],
  });
});
