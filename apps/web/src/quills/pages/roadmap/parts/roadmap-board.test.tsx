import { fireEvent } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { mockApi } from "../../../test/mock-api";
import { listPortalRoadmapPostsFixture } from "../../../api/feedback/list-portal-roadmap-posts.fixture";
import { RoadmapBoard } from "./roadmap-board";
it("uses server date buckets including unplanned work", async () => {
  const api = mockApi();
  api.reply(
    listPortalRoadmapPostsFixture.ok({
      buckets: [
        {
          id: "no-eta",
          label: "No ETA",
          start: null,
          end: null,
          targetMonth: null,
          noEta: true,
        },
      ],
    }),
  );
  api.reply(listPortalRoadmapPostsFixture.ok());
  const view = renderComponent(
    <RoadmapBoard
      workspaceId="workspace_test_1"
      viewer={{ kind: "anonymous" }}
      roadmap={{
        id: "roadmap_1",
        name: "Timeline",
        slug: "timeline",
        description: null,
        type: "date",
        frequency: "monthly",
        position: 0,
        columns: [],
      }}
      search=""
      sort="votes"
    />,
  );
  await view.findByRole("heading", { name: "No ETA" });
  expect(api.calls("listQuillsPortalRoadmapPosts")).toHaveLength(2);
});

it("loads only three periods of a long timeline and pages forward", async () => {
  const api = mockApi();
  api.reply(
    listPortalRoadmapPostsFixture.ok({
      buckets: Array.from({ length: 102 }, (_, i) => ({
        id: String(i),
        label: `Period ${i}`,
        start: null,
        end: null,
        targetMonth: null,
        noEta: false,
      })),
    }),
  );
  for (let i = 0; i < 6; i++) api.reply(listPortalRoadmapPostsFixture.ok());
  const view = renderComponent(
    <RoadmapBoard
      workspaceId="workspace_test_1"
      viewer={{ kind: "anonymous" }}
      roadmap={{
        id: "roadmap_1",
        name: "Timeline",
        slug: "timeline",
        description: null,
        type: "date",
        frequency: "monthly",
        position: 0,
        columns: [],
      }}
      search=""
      sort="votes"
    />,
  );
  await view.findByRole("heading", { name: "Period 2" });
  expect(api.calls("listQuillsPortalRoadmapPosts")).toHaveLength(4);
  expect(
    view.queryByRole("heading", { name: "Period 3" }),
  ).not.toBeInTheDocument();
  fireEvent.click(view.getByRole("button", { name: "Next periods" }));
  await view.findByRole("heading", { name: "Period 5" });
  expect(api.calls("listQuillsPortalRoadmapPosts")).toHaveLength(7);
});
