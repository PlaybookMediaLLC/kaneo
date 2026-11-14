import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { recordPublicArticleFeedback } from "./record-public-article-feedback";
import { recordPublicArticleFeedbackFixture } from "./record-public-article-feedback.fixture";
describe("recordPublicArticleFeedback", () => {
  describeOperationContract({
    operationId: "recordQuillsPublicArticleFeedback",
    operation: recordPublicArticleFeedback,
    request: {
      param: { workspace: "workspace_test_1", articleId: "article-id_test_1" },
      json: { helpful: false },
    },
    response: recordPublicArticleFeedbackFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/hc/articles/article-id_test_1/feedback",
    statuses: [403, 404, 409, 429],
  });
});
