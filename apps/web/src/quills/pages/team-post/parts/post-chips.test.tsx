import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { setPostBoardFixture } from "../../../api/team/set-post-board.fixture";
import { setPostTagsFixture } from "../../../api/team/set-post-tags.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { inboxBoards, inboxTags } from "../../team-posts/inbox.fixture";
import { postDetail, postTeam } from "../post.fixture";
import { PostChips } from "./post-chips";

const boards = [
  ...inboxBoards.items,
  { ...inboxBoards.items[0]!, id: "board_bugs", name: "Bugs" },
];
const render = (post = postDetail, team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <PostChips workspaceId="workspace_test_1" post={post} boards={boards} />
    </TeamRuntimeProvider>,
  );

describe("PostChips", () => {
  it("moves the request to another board", async () => {
    const api = mockApi();
    api.reply(setPostBoardFixture.ok());
    const view = render();
    press("Board: Ideas");
    fireEvent.click(await view.findByRole("menuitemradio", { name: "Bugs" }));
    await waitFor(() =>
      expect(api.calls("setQuillsPostBoard")).toHaveLength(1),
    );
    await expect(
      api.calls("setQuillsPostBoard")[0]!.clone().json(),
    ).resolves.toEqual({ boardId: "board_bugs" });
  });

  it("loads the tags when the tag menu opens and adds one", async () => {
    const api = mockApi();
    expect(api.calls()).toHaveLength(0);
    api.reply(inboxTags);
    api.reply(setPostTagsFixture.ok());
    const view = render();
    expect(view.getByText("API")).toBeVisible();
    press("Edit tags");
    fireEvent.click(await view.findByRole("menuitemcheckbox", { name: "UX" }));
    await waitFor(() => expect(api.calls("setQuillsPostTags")).toHaveLength(1));
    await expect(
      api.calls("setQuillsPostTags")[0]!.clone().json(),
    ).resolves.toEqual({ tagIds: ["tag_api", "tag_ux"] });
  });

  it("shows a request that is not public, read-only without the update permission", () => {
    mockApi();
    const view = render(
      { ...postDetail, moderationState: "pending" },
      { ...postTeam, permissions: { ...postTeam.permissions, update: false } },
    );
    expect(view.getByText("Not on board")).toBeVisible();
    expect(view.getByRole("button", { name: "Board: Ideas" })).toBeDisabled();
    expect(view.queryByRole("button", { name: "Edit tags" })).toBeNull();
  });
});
