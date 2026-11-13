import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { evaluateMyPortalAccessFixture } from "../api/portal/evaluate-my-portal-access.fixture";
import { getPublicPortalConfigFixture } from "../api/portal/get-public-portal-config.fixture";
import { listPortalBoardsFixture } from "../api/feedback/list-portal-boards.fixture";
import { listPortalPostsFixture } from "../api/feedback/list-portal-posts.fixture";
import { getPublicStatusIncidentFixture } from "../api/status/get-public-status-incident.fixture";
import { mockApi } from "../test/mock-api";
import { getPortalPostFixture } from "../api/feedback/get-portal-post.fixture";
import { listPortalPostCommentsFixture } from "../api/feedback/list-portal-post-comments.fixture";
import { listPortalPostCommentsQuery } from "../api/feedback/list-portal-post-comments";
import { routeTree } from "../../routeTree.gen";

function createPortalRouter(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, user: null },
  });
  return { queryClient, router };
}

describe("portal route prefetch", () => {
  it("prefetches comment pages in the infinite query shape used by the post page", async () => {
    const api = mockApi();
    const comments = listPortalPostCommentsFixture.ok({
      items: [listPortalPostCommentsFixture.comment()],
    });
    api.reply(getPublicPortalConfigFixture.ok());
    api.reply(evaluateMyPortalAccessFixture.ok({ granted: true }));
    api.reply(getPortalPostFixture.ok());
    api.reply(comments);
    const { router, queryClient } = createPortalRouter(
      "/portal/workspace_test_1/posts/post_test_1",
    );
    await router.load();
    const options = listPortalPostCommentsQuery(
      {
        param: { workspace: "workspace_test_1", postId: "post_test_1" },
        query: { offset: "0", limit: "100" },
      },
      { kind: "anonymous" },
    );
    expect(queryClient.getQueryData(options.queryKey)).toEqual({
      pages: [comments],
      pageParams: [0],
    });
  });
  it("prefetches the home queries after portal access succeeds", async () => {
    const api = mockApi();
    api.reply(getPublicPortalConfigFixture.ok());
    api.reply(evaluateMyPortalAccessFixture.ok({ granted: true }));
    api.reply(listPortalBoardsFixture.ok());
    api.reply(listPortalPostsFixture.ok());
    const { router } = createPortalRouter("/portal/workspace_test_1/");

    await router.load();

    expect(api.calls("listQuillsPortalBoards")).toHaveLength(1);
    expect(api.calls("listQuillsPortalPosts")).toHaveLength(1);
  });

  it("does not prefetch private feedback data without access", async () => {
    const api = mockApi();
    api.reply(getPublicPortalConfigFixture.ok());
    api.reply(evaluateMyPortalAccessFixture.ok({ granted: false }));
    const { router } = createPortalRouter("/portal/workspace_test_1/");

    await router.load();

    expect(api.calls("listQuillsPortalBoards")).toHaveLength(0);
    expect(api.calls("listQuillsPortalPosts")).toHaveLength(0);
  });

  it("prefetches public status data without private portal access", async () => {
    const api = mockApi();
    api.reply(getPublicPortalConfigFixture.ok());
    api.reply(evaluateMyPortalAccessFixture.ok({ granted: false }));
    api.reply(getPublicStatusIncidentFixture.ok());
    const { router } = createPortalRouter(
      "/portal/workspace_test_1/status/incidents/incident_test_1",
    );

    await router.load();

    expect(api.calls("getQuillsPublicStatusIncident")).toHaveLength(1);
  });

  it("never prefetches a token mutation or sends the token to the API", async () => {
    const api = mockApi();
    api.reply(getPublicPortalConfigFixture.ok());
    api.reply(evaluateMyPortalAccessFixture.ok({ granted: true }));
    window.history.replaceState(
      {},
      "",
      "/portal/workspace_test_1/unsubscribe?token=mail_link_value",
    );
    const { router } = createPortalRouter(
      "/portal/workspace_test_1/unsubscribe?token=mail_link_value",
    );

    await router.load();

    expect(api.calls("processQuillsUnsubscribeToken")).toHaveLength(0);
    expect(
      api.calls().every((request) => !request.url.includes("mail_link_value")),
    ).toBe(true);
    expect(window.location.search).toBe("");
  });
});

describe("portal route hierarchy", () => {
  it.each([
    {
      path: "/portal/workspace_test_1/hc/en/articles/article_test_1-example",
      leaf: "/portal/$workspaceId/hc/$locale/articles/$idSlug",
      parentIndex: "/portal/$workspaceId/hc/$locale/",
    },
    {
      path: "/portal/workspace_test_1/changelog/entry_test_1",
      leaf: "/portal/$workspaceId/changelog/$entryId",
      parentIndex: "/portal/$workspaceId/changelog/",
    },
    {
      path: "/portal/workspace_test_1/support/tickets",
      leaf: "/portal/$workspaceId/support/tickets",
      parentIndex: "/portal/$workspaceId/support/",
    },
  ])(
    "matches $leaf without rendering its parent index",
    async ({ leaf, parentIndex, path }) => {
      const api = mockApi();
      api.reply(getPublicPortalConfigFixture.ok());
      api.reply(evaluateMyPortalAccessFixture.ok({ granted: true }));
      const { router } = createPortalRouter(path);

      await router.load();

      const routeIds = router.state.matches.map((match) => match.routeId);
      expect(routeIds).toContain(leaf);
      expect(routeIds).not.toContain(parentIndex);
      expect(routeIds.at(-1)).toBe(leaf);
    },
  );
});
