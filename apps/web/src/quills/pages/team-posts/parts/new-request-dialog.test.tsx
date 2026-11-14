import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createPostFixture } from "../../../api/team/create-post.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postTeam } from "../../team-post/post.fixture";
import { inboxBoards, inboxStatuses, inboxTags } from "../inbox.fixture";
import { NewRequestDialog } from "./new-request-dialog";

const render = (onCreated = vi.fn(), onClose = vi.fn()) =>
  renderComponent(
    <TeamRuntimeProvider value={postTeam}>
      <NewRequestDialog
        workspaceId="workspace_test_1"
        boards={inboxBoards.items}
        statuses={inboxStatuses.statuses}
        boardId="board_ideas"
        onClose={onClose}
        onCreated={onCreated}
      />
    </TeamRuntimeProvider>,
  );

describe("NewRequestDialog", () => {
  it("creates the request on the chosen board and opens it", async () => {
    const api = mockApi();
    api.reply(inboxTags);
    api.reply(createPostFixture.ok({ id: "post_dark" }));
    const onCreated = vi.fn();
    const view = render(onCreated);
    expect(
      await view.findByRole("dialog", { name: "New request" }),
    ).toBeVisible();
    fill("Submission title", "Dark mode");
    press("Create");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("post_dark"));
    await expect(
      api.calls("createQuillsPost")[0]!.clone().json(),
    ).resolves.toMatchObject({ boardId: "board_ideas", title: "Dark mode" });
  });

  it("closes without a request on Escape", async () => {
    const api = mockApi();
    api.reply(inboxTags);
    const onClose = vi.fn();
    const view = render(vi.fn(), onClose);
    fireEvent.keyDown(await view.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls("createQuillsPost")).toHaveLength(0);
  });
});
