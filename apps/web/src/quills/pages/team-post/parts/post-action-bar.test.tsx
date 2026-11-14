import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { setPostStatusFixture } from "../../../api/team/set-post-status.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { inboxStatuses } from "../../team-posts/inbox.fixture";
import { postDetail, postTeam } from "../post.fixture";
import { PostActionBar } from "./post-action-bar";

const closed = {
  ...inboxStatuses.statuses[2]!,
  id: "status_closed",
  name: "Closed",
  category: "closed" as const,
  position: 3,
};
const render = (team = postTeam, onMerge = vi.fn()) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <PostActionBar
        workspaceId="workspace_test_1"
        post={postDetail}
        statuses={[...inboxStatuses.statuses, closed]}
        onMerge={onMerge}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />
    </TeamRuntimeProvider>,
  );
const sent = async (api: ReturnType<typeof mockApi>) => {
  await waitFor(() => expect(api.calls("setQuillsPostStatus")).toHaveLength(1));
  return api.calls("setQuillsPostStatus")[0]!.clone().json();
};

describe("PostActionBar", () => {
  it("closes the request with the first closed status", async () => {
    const api = mockApi();
    api.reply(setPostStatusFixture.ok());
    render();
    press("Close");
    await expect(sent(api)).resolves.toEqual({ statusId: "status_closed" });
  });

  it("picks any status from the status menu", async () => {
    const api = mockApi();
    api.reply(setPostStatusFixture.ok());
    const view = render();
    press("Status: Open");
    fireEvent.click(
      await view.findByRole("menuitemradio", { name: "Complete" }),
    );
    await expect(sent(api)).resolves.toEqual({ statusId: "status_done" });
  });

  it("opens the merge palette", () => {
    const onMerge = vi.fn();
    render(postTeam, onMerge);
    press("Merge");
    expect(onMerge).toHaveBeenCalled();
  });

  it("locks the status and merge without the update permission", () => {
    const view = render({
      ...postTeam,
      permissions: { ...postTeam.permissions, update: false },
    });
    expect(view.getByRole("button", { name: "Status: Open" })).toBeDisabled();
    expect(view.getByRole("button", { name: /^Accept/ })).toBeDisabled();
    expect(view.getByRole("button", { name: "Merge" })).toBeDisabled();
  });
});
