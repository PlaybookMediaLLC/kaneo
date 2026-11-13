import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getPortalPostFixture } from "../../../api/feedback/get-portal-post.fixture";
import { listPortalPostsFixture } from "../../../api/feedback/list-portal-posts.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { RoadmapColumn } from "./roadmap-column";

const stage = { value: "planned" as const, label: "Planned", color: "blue" };

describe("RoadmapColumn", () => {
  it("lists the stage's posts by votes and loads more", async () => {
    const api = mockApi();
    const post = getPortalPostFixture.ok({ id: "post_test_1", title: "Sync" });
    api.reply(
      listPortalPostsFixture.ok({
        items: [post],
        nextCursor: "post_test_1",
        hasMore: true,
      }),
    );
    api.reply(listPortalPostsFixture.ok());
    const view = renderComponent(
      <RoadmapColumn
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        stage={stage}
        canVote={() => false}
      />,
    );
    await waitFor(
      () =>
        expect(
          view.getByRole("heading", { name: /Planned/ }),
        ).toHaveTextContent("1+"),
      { timeout: 3000 },
    );
    expect(view.getByText("Committed and queued")).toBeInTheDocument();
    const first = new URL(api.calls("listQuillsPortalPosts")[0]!.url);
    expect(first.searchParams.get("stage")).toBe("planned");
    expect(first.searchParams.get("sort")).toBe("votes");
    press("Show more");
    await waitFor(() =>
      expect(api.calls("listQuillsPortalPosts")).toHaveLength(2),
    );
    const next = new URL(api.calls("listQuillsPortalPosts")[1]!.url);
    expect(next.searchParams.get("cursor")).toBe("post_test_1");
  });

  it("shows an empty column", async () => {
    mockApi().reply(listPortalPostsFixture.ok());
    const view = renderComponent(
      <RoadmapColumn
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        stage={stage}
        canVote={() => false}
      />,
    );
    expect(await view.findByText("Nothing here yet.")).toBeInTheDocument();
  });
});
