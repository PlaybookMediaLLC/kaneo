import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { listTagsFixture } from "../../../api/team/list-tags.fixture";
import { setPostStatusFixture } from "../../../api/team/set-post-status.fixture";
import { setPostTagsFixture } from "../../../api/team/set-post-tags.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { inboxBoards, inboxStatuses } from "../../team-posts/inbox.fixture";
import { postDetail, postTeam } from "../post.fixture";
import { PostFields } from "./post-fields";

const tag = (id: string, name: string) => ({
  id,
  name,
  color: "gray",
  description: null,
  aiPrompt: null,
  isPublic: true,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const render = (team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <PostFields
        workspaceId="workspace_test_1"
        post={postDetail}
        statuses={inboxStatuses.statuses}
        boards={inboxBoards.items}
      />
    </TeamRuntimeProvider>,
  );
const json = (request: Request | undefined) => request!.clone().json();

describe("PostFields", () => {
  it("changes the status and the tags", async () => {
    const api = mockApi();
    api.reply(
      listTagsFixture.ok({
        tags: [tag("tag_api", "API"), tag("tag_ux", "UX")],
      }),
    );
    const view = render();
    expect(view.getByText("Ada")).toBeVisible();
    api.reply(setPostStatusFixture.ok());
    fireEvent.change(view.getByRole("combobox", { name: "Status" }), {
      target: { value: "status_done" },
    });
    await waitFor(() =>
      expect(api.calls("setQuillsPostStatus")).toHaveLength(1),
    );
    await expect(json(api.calls("setQuillsPostStatus")[0])).resolves.toEqual({
      statusId: "status_done",
    });
    api.reply(setPostTagsFixture.ok());
    fireEvent.click(await view.findByRole("checkbox", { name: "UX" }));
    await waitFor(() => expect(api.calls("setQuillsPostTags")).toHaveLength(1));
    await expect(json(api.calls("setQuillsPostTags")[0])).resolves.toEqual({
      tagIds: ["tag_api", "tag_ux"],
    });
  });

  it("shows a failed change", async () => {
    const api = mockApi();
    api.reply(listTagsFixture.ok());
    const view = render();
    api.fail();
    fireEvent.change(view.getByRole("combobox", { name: "Status" }), {
      target: { value: "status_done" },
    });
    expect(await view.findByRole("alert")).toHaveTextContent("went wrong");
  });

  it("locks the pickers without the update permission", () => {
    mockApi().reply(listTagsFixture.ok());
    const view = render({
      ...postTeam,
      permissions: { ...postTeam.permissions, update: false },
    });
    expect(view.getByRole("combobox", { name: "Status" })).toBeDisabled();
    expect(view.getByRole("combobox", { name: "Board" })).toBeDisabled();
  });
});
