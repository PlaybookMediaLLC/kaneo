import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { recordPublicArticleFeedbackFixture } from "../../api/help-center/record-public-article-feedback.fixture";
import { useRecordPublicArticleFeedback } from "./use-record-public-article-feedback";
describe("useRecordPublicArticleFeedback", () => {
  describeHookContract({
    kind: "mutation",
    hook: useRecordPublicArticleFeedback,
    operationId: "recordQuillsPublicArticleFeedback",
    request: {
      param: { workspace: "workspace_test_1", articleId: "article-id_test_1" },
      json: { helpful: false },
    },
    response: recordPublicArticleFeedbackFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "help-center",
        "getPublicHelpCenterArticle",
      ),
    ],
  });
});
