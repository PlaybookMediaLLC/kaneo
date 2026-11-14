import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { deletePostFixture } from "../../../api/team/delete-post.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postTeam } from "../post.fixture";
import { DeletePostDialog } from "./delete-post-dialog";

const render = (onDeleted = vi.fn(), onClose = vi.fn()) =>
  renderComponent(
    <TeamRuntimeProvider value={postTeam}>
      <DeletePostDialog
        workspaceId="workspace_test_1"
        postId="post_export"
        onClose={onClose}
        onDeleted={onDeleted}
      />
    </TeamRuntimeProvider>,
  );

describe("DeletePostDialog", () => {
  it("deletes the request after the confirmation", async () => {
    const api = mockApi();
    api.reply(deletePostFixture.ok());
    const onDeleted = vi.fn();
    const view = render(onDeleted);
    fireEvent.click(await view.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(new URL(api.calls("deleteQuillsPost")[0]!.url).pathname).toBe(
      "/api/quills/workspace_test_1/posts/post_export",
    );
  });

  it("shows a failure and cancels without a request", async () => {
    const api = mockApi();
    const problem = deletePostFixture.problem(409);
    api.reply(problem.body, problem.status);
    const onClose = vi.fn();
    const view = render(vi.fn(), onClose);
    fireEvent.click(await view.findByRole("button", { name: "Delete" }));
    expect(await view.findByRole("alert")).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.calls("deleteQuillsPost")).toHaveLength(1);
  });
});
