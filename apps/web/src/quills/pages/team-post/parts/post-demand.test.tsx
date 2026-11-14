import { describe, expect, it } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postDemand, postTeam } from "../post.fixture";
import { PostDemand } from "./post-demand";

describe("PostDemand", () => {
  it("shows the companies, revenue, importance and segments", async () => {
    mockApi().reply(postDemand);
    const view = renderComponent(
      <TeamRuntimeProvider value={postTeam}>
        <PostDemand workspaceId="workspace_test_1" postId="post_export" />
      </TeamRuntimeProvider>,
    );
    expect(await view.findByText("Enterprise (2 voters)")).toBeVisible();
    expect(view.getByText("1,500")).toBeVisible();
    expect(
      view.getByText("1 nice to have · 1 important · 1 blocker"),
    ).toBeVisible();
  });
});
