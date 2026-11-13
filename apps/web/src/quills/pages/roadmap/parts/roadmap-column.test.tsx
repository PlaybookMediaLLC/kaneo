import { expect, it, vi } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
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
