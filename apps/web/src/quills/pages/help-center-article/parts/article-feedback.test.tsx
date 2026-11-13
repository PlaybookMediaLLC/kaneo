import { describe, expect, it } from "vite-plus/test";
import { recordPublicArticleFeedbackFixture } from "../../../api/help-center/record-public-article-feedback.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ArticleFeedback } from "./article-feedback";

describe("ArticleFeedback", () => {
  it("records a helpful vote and thanks the reader", async () => {
    const api = mockApi();
    api.reply(recordPublicArticleFeedbackFixture.ok({ helpful: true }));
    const view = renderComponent(
      <ArticleFeedback
        workspaceId="workspace_test_1"
        articleId="article_test_1"
        viewer={{ kind: "anonymous" }}
      />,
    );
    expect(
      view.getByRole("heading", { name: "Did this answer your question?" }),
    ).toBeInTheDocument();
    press("Yes");
    expect(await view.findByText("Thanks for the feedback.")).toHaveAttribute(
      "role",
      "status",
    );
    const [request] = api.calls("recordQuillsPublicArticleFeedback");
    expect(await request!.json()).toEqual({ helpful: true });
  });

  it("shows a failed vote with a retry", async () => {
    mockApi().fail();
    const view = renderComponent(
      <ArticleFeedback
        workspaceId="workspace_test_1"
        articleId="article_test_1"
        viewer={{ kind: "anonymous" }}
      />,
    );
    press("No");
    expect((await view.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(view.queryByRole("status")).not.toBeInTheDocument();
  });
});
