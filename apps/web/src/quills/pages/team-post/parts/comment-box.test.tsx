import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createCommentFixture } from "../../../api/team/create-comment.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ShortcutListener } from "../../../ui/upstream";
import { postTeam } from "../post.fixture";
import { CommentBox } from "./comment-box";

const render = (team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <ShortcutListener />
      <CommentBox workspaceId="workspace_test_1" postId="post_export" />
    </TeamRuntimeProvider>,
  );

describe("CommentBox", () => {
  it("sends a public comment on Enter and clears the box", async () => {
    const api = mockApi();
    api.reply(createCommentFixture.ok());
    const view = render();
    const box = view.getByRole("textbox", { name: "Write a comment…" });
    fireEvent.change(box, { target: { value: " Shipped. " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box).toHaveValue(""));
    await expect(
      api.calls("createQuillsComment")[0]!.clone().json(),
    ).resolves.toEqual({ content: "Shipped.", isPrivate: false });
  });

  it("focuses the box as a private note on N", () => {
    mockApi();
    const view = render();
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    expect(
      view.getByRole("textbox", { name: "Write a comment…" }),
    ).toHaveFocus();
    expect(
      view.getByRole("button", { name: "Mode: Private note" }),
    ).toBeVisible();
  });

  it("is read-only without the create permission", () => {
    mockApi();
    const view = render({
      ...postTeam,
      permissions: { ...postTeam.permissions, create: false },
    });
    expect(
      view.getByRole("textbox", { name: "Write a comment…" }),
    ).toBeDisabled();
  });
});
