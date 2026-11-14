import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { listPortalVotedPostsFixture } from "../api/feedback/list-portal-voted-posts.fixture";
import { setPortalVoteFixture } from "../api/feedback/set-portal-vote.fixture";
import type { Viewer } from "../core/types";
import { press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { PortalRuntimeProvider, type PortalRuntimeValue } from "./runtime";
import { SimilarRequests } from "./similar-requests";

const runtime = (viewer: Viewer): PortalRuntimeValue => ({
  config: {
    name: "Workspace",
    features: {
      allowAnonymous: false,
      allowEditAfterEngagement: false,
      allowDeleteAfterEngagement: false,
      showPublicEditHistory: false,
      ai: true,
    },
    portalAccess: { isPrivate: false },
    branding: {
      logoUrl: null,
      theme: { themeMode: "user", light: {}, dark: {} },
      headerDisplayMode: "logo_and_name",
      headerDisplayName: null,
    },
  },
  viewer,
  access: { granted: true, reason: "public" },
  accessLoading: false,
  accessProblem: null,
});
const post = (id: string, title: string, boardId = "board_test_1") => ({
  id,
  title,
  voteCount: 3,
  stage: null,
  board: { id: boardId, slug: "ideas" },
});
const posts = [
  post("post_test_1", "Dark mode"),
  post("post_test_2", "Weekly reports"),
  post("post_test_3", "Dark mode for the dashboard", "board_test_2"),
];
const render = (viewer: Viewer) =>
  renderComponent(
    <PortalRuntimeProvider value={runtime(viewer)}>
      <SimilarRequests
        workspaceId="workspace_test_1"
        title="Add dark mode"
        posts={posts}
        canVote={(boardId) => boardId === "board_test_1"}
      />
    </PortalRuntimeProvider>,
  );

describe("SimilarRequests", () => {
  it("offers a vote on a strong match, then marks the vote", async () => {
    const api = mockApi();
    api.reply(listPortalVotedPostsFixture.ok());
    api.reply(setPortalVoteFixture.ok({ postId: "post_test_1", voted: true }));
    api.reply(listPortalVotedPostsFixture.ok({ postIds: ["post_test_1"] }));
    const view = render({ kind: "user", id: "account_test_1" });
    const offer = await view.findByRole("button", {
      name: "Vote for this instead: Dark mode",
    });
    expect(offer).toHaveTextContent("Vote for this instead");
    // A weak match, and a match on a board without votes, offer nothing.
    expect(view.getAllByRole("button")).toHaveLength(1);
    press("Vote for this instead: Dark mode");
    const link = view.getByRole("link", { name: /votes ?Dark mode$/ });
    await view.findByText("You voted");
    await waitFor(() => expect(link).toHaveFocus());
    expect(view.queryByRole("button")).not.toBeInTheDocument();
    const [vote] = api.calls("setQuillsPortalVote");
    expect(new URL(vote!.url).pathname).toContain("/posts/post_test_1/vote");
    expect(await vote!.clone().json()).toEqual({ voted: true });
  });

  it("offers nothing to a viewer who has voted", async () => {
    const api = mockApi();
    api.reply(listPortalVotedPostsFixture.ok({ postIds: ["post_test_1"] }));
    const view = render({ kind: "user", id: "account_test_1" });
    await view.findByText("You voted");
    expect(view.queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks nothing and offers nothing to a visitor", () => {
    const api = mockApi();
    const view = render({ kind: "anonymous" });
    expect(view.getByRole("link", { name: /Dark mode$/ })).toBeVisible();
    expect(view.queryByRole("button")).not.toBeInTheDocument();
    expect(api.calls()).toHaveLength(0);
  });
});
