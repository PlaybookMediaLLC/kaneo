import { expect, it, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/render";
import { mockApi } from "../../../test/mock-api";
import { listPortalRoadmapPostsFixture } from "../../../api/feedback/list-portal-roadmap-posts.fixture";
import { RoadmapColumn } from "./roadmap-column";
it("pages one column without changing its roadmap filters", async () => {
  const api = mockApi();
  api.reply(listPortalRoadmapPostsFixture.ok({ hasMore: true, total: 11 }));
  api.reply(listPortalRoadmapPostsFixture.ok({ total: 11 }));
  const view = renderComponent(
    <RoadmapColumn
      workspaceId="workspace_test_1"
      viewer={{ kind: "anonymous" }}
      roadmapId="roadmap_1"
      statusId="status_1"
      label="Planned"
      search="exports"
      sort="votes"
    />,
  );
  fireEvent.click(await view.findByRole("button", { name: "Next" }));
  await view.findByRole("button", { name: "Previous" });
  expect(
    new URL(
      api.calls("listQuillsPortalRoadmapPosts").at(-1)!.url,
    ).searchParams.get("offset"),
  ).toBe("10");
});

it("formats ETA months in UTC, matching date buckets", async () => {
  vi.stubEnv("TZ", "America/New_York");
  try {
    const api = mockApi();
    api.reply(
      listPortalRoadmapPostsFixture.ok({
        items: [
          {
            id: "post_1",
            title: "December release",
            board: { id: "board_1", name: "Feedback", slug: "feedback" },
            statusId: null,
            voteCount: 0,
            commentCount: 0,
            eta: "2026-12-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const view = renderComponent(
      <RoadmapColumn
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        roadmapId="roadmap_1"
        label="December"
        search=""
        sort="votes"
      />,
    );
    expect(await view.findByText("Dec 2026")).toBeVisible();
  } finally {
    vi.unstubAllEnvs();
  }
});

it("shows the viewer's votes and keeps a failed vote on its own card", async () => {
  const item = (id: string, title: string) => ({
    id,
    title,
    board: { id: "board_1", name: "Feedback", slug: "feedback" },
    statusId: "status_1",
    voteCount: 2,
    commentCount: 0,
    eta: null,
  });
  const api = mockApi();
  api.reply(
    listPortalRoadmapPostsFixture.ok({
      items: [item("post_1", "Exports"), item("post_2", "Imports")],
      total: 2,
    }),
  );
  api.reply({ message: "Post not found" }, 404);
  const view = renderComponent(
    <RoadmapColumn
      workspaceId="workspace_test_1"
      viewer={{ kind: "user", id: "account_test_1" }}
      roadmapId="roadmap_1"
      statusId="status_1"
      label="Planned"
      search=""
      sort="votes"
      votedIds={new Set(["post_1"])}
      canVote={(boardId) => boardId === "board_1"}
    />,
  );
  expect(
    await view.findByRole("button", { name: "Remove vote" }),
  ).toBeEnabled();
  fireEvent.click(view.getByRole("button", { name: "Vote" }));
  await waitFor(() =>
    expect(view.getAllByRole("alert").length).toBeGreaterThan(0),
  );
  expect(api.calls("setQuillsPortalVote")).toHaveLength(1);
  expect(view.getByRole("button", { name: "Remove vote" })).toBeEnabled();
});
