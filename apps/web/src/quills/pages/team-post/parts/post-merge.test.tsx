import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { listMergedPostsFixture } from "../../../api/team/list-merged-posts.fixture";
import { unmergePostFixture } from "../../../api/team/unmerge-post.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postDetail, postTeam } from "../post.fixture";
import { PostMerge } from "./post-merge";

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
const render = (post = postDetail) =>
  renderComponent(
    <RouterContextProvider router={router}>
      <TeamRuntimeProvider value={postTeam}>
        <PostMerge workspaceId="workspace_test_1" post={post} />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
const duplicate = {
  id: "post_dup",
  title: "CSV download",
  voteCount: 2,
  authorName: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  mergedAt: "2026-01-02T00:00:00.000Z",
};

describe("PostMerge", () => {
  it("unmerges a merged duplicate and this post when it is merged", async () => {
    const api = mockApi();
    api.reply(listMergedPostsFixture.ok({ posts: [duplicate] }));
    api.reply(unmergePostFixture.ok());
    const view = render({ ...postDetail, canonicalPostId: "post_sso" });
    expect(
      view.getByRole("link", { name: "Open the main request" }),
    ).toHaveAttribute("href", "/feedback/workspace_test_1/posts/post_sso");
    await view.findByRole("button", { name: "Unmerge “CSV download”" });
    press("Unmerge “CSV download”");
    await waitFor(() => expect(api.calls("unmergeQuillsPost")).toHaveLength(1));
    expect(new URL(api.calls("unmergeQuillsPost")[0]!.url).pathname).toBe(
      "/api/quills/workspace_test_1/posts/post_dup/unmerge",
    );
    expect(view.getByRole("button", { name: "Unmerge" })).toBeVisible();
  });
});
