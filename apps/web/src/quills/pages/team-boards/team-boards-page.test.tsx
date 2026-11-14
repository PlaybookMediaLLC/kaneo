import { describe, expect, it } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { press } from "../../test/actions";
import { renderPage } from "../../test/render";
import { updateBoardFixture } from "../../api/team/update-board.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { listBoardsFixture } from "../../api/team/list-boards.fixture";
import { listSegmentsFixture } from "../../api/team/list-segments.fixture";
import { meta } from "./meta";
import { TeamBoardsPage } from "./team-boards-page";
const board = {
  ...updateBoardFixture.ok(),
  id: "board_test_1",
  name: "Ideas",
  visibleSegmentIds: null,
};
const segment = {
  id: "segment_test_1",
  name: "Enterprise",
  slug: "enterprise",
  description: null,
  type: "manual",
  color: "#6b7280",
  rules: null,
  memberCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("TeamBoardsPage", () => {
  describePageContract(meta, TeamBoardsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(listBoardsFixture.ok());
        api.reply(listSegmentsFixture.ok());
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(listBoardsFixture.ok());
        api.reply(listSegmentsFixture.ok());
      },
    },
  });
  it("saves the segments that may see a board", async () => {
    const api = mockApi();
    api.reply(listBoardsFixture.ok({ items: [board] }));
    api.reply(listSegmentsFixture.ok({ segments: [segment] }));
    api.reply(updateBoardFixture.ok({ visibleSegmentIds: [segment.id] }));
    api.reply(
      listBoardsFixture.ok({
        items: [{ ...board, visibleSegmentIds: [segment.id] }],
      }),
    );
    const view = renderPage(TeamBoardsPage, meta);
    fireEvent.click(await view.findByRole("checkbox", { name: "Enterprise" }));
    press("Save visibility");
    await waitFor(() => expect(api.calls("updateQuillsBoard")).toHaveLength(1));
    const [request] = api.calls("updateQuillsBoard");
    expect(new URL(request!.url).pathname).toContain("/boards/board_test_1");
    expect(await request!.json()).toEqual({ visibleSegmentIds: [segment.id] });
  });

  it("hides the save control from a teammate without manage_settings", async () => {
    const api = mockApi();
    api.reply(listBoardsFixture.ok({ items: [board] }));
    api.reply(listSegmentsFixture.ok({ segments: [segment] }));
    const view = renderPage(TeamBoardsPage, meta, {
      permissions: { manageSettings: false },
    });
    expect(
      await view.findByRole("checkbox", { name: "Enterprise" }),
    ).toBeVisible();
    expect(view.queryByRole("button", { name: "Save visibility" })).toBeNull();
  });
});
