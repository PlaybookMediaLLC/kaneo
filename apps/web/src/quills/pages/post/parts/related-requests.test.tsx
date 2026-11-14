import { describe, expect, it } from "vite-plus/test";
import { findPortalSimilarPostsFixture } from "../../../api/feedback/find-portal-similar-posts.fixture";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { RelatedRequests } from "./related-requests";

const item = (id: string, title: string) => ({
  id,
  title,
  voteCount: 2,
  stage: null,
  board: { id: "board_test_1", slug: "ideas" },
});

describe("RelatedRequests", () => {
  it("lists similar requests without the post itself", async () => {
    const api = mockApi();
    api.reply(
      findPortalSimilarPostsFixture.ok({
        items: [
          item("post_test_1", "Export history"),
          item("post_test_2", "CSV export"),
        ],
      }),
    );
    const view = renderComponent(
      <RelatedRequests
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        postId="post_test_1"
        title="Export history"
      />,
    );
    expect(await view.findByRole("link", { name: /CSV export/ })).toBeVisible();
    expect(
      view.queryByRole("link", { name: /Export history/ }),
    ).not.toBeInTheDocument();
    expect(
      new URL(
        api.calls("findQuillsPortalSimilarPosts")[0]!.url,
      ).searchParams.get("title"),
    ).toBe("Export history");
  });

  it("does not search for a title shorter than three characters", () => {
    const api = mockApi();
    renderComponent(
      <RelatedRequests
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        postId="post_test_1"
        title="Hi"
      />,
    );
    expect(api.calls()).toHaveLength(0);
  });
});
