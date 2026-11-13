import { describe, expect, it } from "vite-plus/test";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { listPortalRoadmapsFixture } from "../../api/feedback/list-portal-roadmaps.fixture";
import { listPortalRoadmapPostsFixture } from "../../api/feedback/list-portal-roadmap-posts.fixture";
import { meta } from "./meta";
import { RoadmapPage } from "./roadmap-page";
const roadmap = {
  id: "roadmap_1",
  name: "Product roadmap",
  slug: "product",
  description: "Our plans",
  type: "column" as const,
  frequency: null,
  position: 0,
  columns: [
    {
      id: "column_1",
      statusId: "status_1",
      name: "Planned",
      icon: null,
      color: "",
      position: 0,
    },
  ],
};
describe("RoadmapPage", () => {
  describePageContract(meta, RoadmapPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return { accessLoading: true };
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return { accessProblem: { kind: "failed" } };
      },
    },
    ready: {
      prepare: () => {
        mockApi().reply(listPortalRoadmapsFixture.ok());
        return {};
      },
    },
  });
  it("selects the shared roadmap and renders linked cards with search and sort", async () => {
    const api = mockApi();
    api.reply(listPortalRoadmapsFixture.ok({ roadmaps: [roadmap] }));
    api.reply(
      listPortalRoadmapPostsFixture.ok({
        items: [
          {
            id: "post_1",
            title: "Exports",
            voteCount: 3,
            commentCount: 1,
            statusId: "status_1",
            eta: null,
            board: { id: "board_1", name: "Ideas", slug: "ideas" },
          },
        ],
        total: 1,
      }),
    );
    const view = renderPage(RoadmapPage, meta, {
      search: { roadmap: "product", search: "exports", sort: "newest" },
    });
    expect(await view.findByRole("link", { name: "Exports" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/posts/post_1",
    );
    const url = new URL(api.calls("listQuillsPortalRoadmapPosts")[0].url);
    expect(url.searchParams.get("statusId")).toBe("status_1");
    expect(url.searchParams.get("search")).toBe("exports");
  });
});
