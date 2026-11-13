import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { evaluateMyPortalAccessFixture } from "../../api/portal/evaluate-my-portal-access.fixture";
import { useEvaluateMyPortalAccess } from "./use-evaluate-my-portal-access";
describe("useEvaluateMyPortalAccess", () => {
  describeHookContract({
    kind: "query",
    hook: useEvaluateMyPortalAccess,
    operationId: "evaluateQuillsMyPortalAccess",
    request: { param: { workspace: "workspace_test_1" } },
    emptyRequest: { param: { workspace: "" } },
    response: evaluateMyPortalAccessFixture.ok(),
    viewer: { kind: "anonymous" },
  });
});
