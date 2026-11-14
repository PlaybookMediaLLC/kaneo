import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { setMyWeeklyDigestPreference } from "./set-my-weekly-digest-preference";
import { setMyWeeklyDigestPreferenceFixture } from "./set-my-weekly-digest-preference.fixture";
describe("setMyWeeklyDigestPreference", () => {
  describeOperationContract({
    operationId: "setQuillsMyWeeklyDigestPreference",
    operation: setMyWeeklyDigestPreference,
    request: {
      param: { workspace: "workspace_test_1" },
      json: { weeklyDigest: false },
    },
    response: setMyWeeklyDigestPreferenceFixture.ok(),
    method: "put",
    path: "/api/quills-public/workspace_test_1/user/weekly-digest",
    statuses: [401, 403, 404, 429],
  });
});
