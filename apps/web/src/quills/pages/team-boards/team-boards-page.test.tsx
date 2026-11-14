import { describe, expect, it } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { choose, press } from "../../test/actions";
import { renderPage } from "../../test/render";
import { getBoardSettingsFixture } from "../../api/team/get-board-settings.fixture";
import { listStatusesFixture } from "../../api/team/list-statuses.fixture";
import { updateBoardFixture } from "../../api/team/update-board.fixture";
import { updateBoardSettingsFixture } from "../../api/team/update-board-settings.fixture";
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
const complete = {
  id: "post_status_test_1",
  name: "Complete",
  slug: "complete",
  color: "#22c55e",
  category: "complete" as const,
  position: 0,
  showOnRoadmap: true,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};
/** The four page queries: one board, one segment, its settings and the statuses. */
const prepare = () => {
  const api = mockApi();
  api.reply(listBoardsFixture.ok({ items: [board] }));
  api.reply(listSegmentsFixture.ok({ segments: [segment] }));
  api.reply(getBoardSettingsFixture.ok({ boardId: board.id }));
  api.reply(listStatusesFixture.ok({ statuses: [complete] }));
  return api;
};
let api: ReturnType<typeof mockApi>;

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
        prepare();
      },
      assert: async (view) => {
        expect(await view.findByLabelText("Vote counts")).toBeVisible();
      },
    },
    done: {
      prepare: () => {
        api = prepare();
        api.reply(
          updateBoardSettingsFixture.ok({
            boardId: board.id,
            voteDisplay: "hidden",
          }),
        );
        api.reply(
          getBoardSettingsFixture.ok({
            boardId: board.id,
            voteDisplay: "hidden",
          }),
        );
      },
      act: async (view) => {
        await view.findByLabelText("Vote counts");
        await choose("Vote counts", "Hide counts");
        press("Save voting settings");
      },
      assert: async () => {
        await waitFor(() =>
          expect(api.calls("updateQuillsBoardSettings")).toHaveLength(1),
        );
        expect(await api.calls("updateQuillsBoardSettings")[0]!.json()).toEqual(
          { voteDisplay: "hidden", defaultSort: "votes" },
        );
      },
    },
  });

  it("saves the segments that may see a board", async () => {
    const api = prepare();
    api.reply(updateBoardFixture.ok({ visibleSegmentIds: [segment.id] }));
    api.reply(
      listBoardsFixture.ok({
        items: [{ ...board, visibleSegmentIds: [segment.id] }],
      }),
    );
    const view = renderPage(TeamBoardsPage, meta);
    expect(
      await view.findByRole("combobox", { name: "Board" }),
    ).toHaveTextContent("Ideas");
    fireEvent.click(await view.findByRole("checkbox", { name: "Enterprise" }));
    press("Save visibility");
    await waitFor(() => expect(api.calls("updateQuillsBoard")).toHaveLength(1));
    const [request] = api.calls("updateQuillsBoard");
    expect(new URL(request!.url).pathname).toContain("/boards/board_test_1");
    expect(await request!.json()).toEqual({ visibleSegmentIds: [segment.id] });
  });

  it("sets the status that a done task gives its linked posts", async () => {
    const api = prepare();
    api.reply(updateBoardSettingsFixture.ok({ boardId: board.id }));
    api.reply(getBoardSettingsFixture.ok({ boardId: board.id }));
    const view = renderPage(TeamBoardsPage, meta);
    const sync = "When a linked task is done, set the status to";
    await view.findByRole("combobox", { name: sync });
    await choose(sync, "Complete");
    press("Save task sync");
    await waitFor(() =>
      expect(api.calls("updateQuillsBoardSettings")).toHaveLength(1),
    );
    expect(await api.calls("updateQuillsBoardSettings")[0]!.json()).toEqual({
      taskSync: { statusOnTaskDone: complete.id },
    });
  });

  it("shows the visibility read-only to a teammate without manage_settings", async () => {
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
    expect(view.queryByLabelText("Vote counts")).toBeNull();
    expect(
      view.queryByLabelText("When a linked task is done, set the status to"),
    ).toBeNull();
    expect(api.calls()).toHaveLength(2);
  });
});
