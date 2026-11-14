import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { getLinkedConversationsForPostFixture } from "../../../api/team/get-linked-conversations-for-post.fixture";
import { listLinksFixture } from "../../../api/team/list-links.fixture";
import { listMergedPostsFixture } from "../../../api/team/list-merged-posts.fixture";
import { listTagsFixture } from "../../../api/team/list-tags.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { inboxBoards, inboxStatuses } from "../../team-posts/inbox.fixture";
import { postDemand, postDetail, postTeam, postVoters } from "../post.fixture";
import { PostProperties } from "./post-properties";

describe("PostProperties", () => {
  it("shows every section of the panel", async () => {
    const api = mockApi();
    api.reply(listTagsFixture.ok());
    api.reply(postVoters);
    api.reply(postDemand);
    api.reply(listLinksFixture.ok());
    api.reply(getLinkedConversationsForPostFixture.ok());
    api.reply(listMergedPostsFixture.ok());
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const view = renderComponent(
      <RouterContextProvider router={router}>
        <TeamRuntimeProvider value={postTeam}>
          <PostProperties
            workspaceId="workspace_test_1"
            post={postDetail}
            statuses={inboxStatuses.statuses}
            boards={inboxBoards.items}
            onScoreSaved={vi.fn()}
          />
        </TeamRuntimeProvider>
      </RouterContextProvider>,
    );
    expect(await view.findByText("Enterprise (2 voters)")).toBeVisible();
    for (const name of ["3 votes", "Demand", "Merge into another post"])
      expect(view.getByRole("heading", { name })).toBeVisible();
    expect(view.getByText("RICE score")).toBeVisible();
    expect(view.getByText("Tasks")).toBeVisible();
    expect(api.calls()).toHaveLength(6);
  });
});
