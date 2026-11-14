import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createCommentFixture } from "../../../api/team/create-comment.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postTeam } from "../post.fixture";
import { PostComposer } from "./post-composer";

const render = (team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <PostComposer workspaceId="workspace_test_1" postId="post_export" />
    </TeamRuntimeProvider>,
  );

describe("PostComposer", () => {
  it("sends a reply and closes the composer", async () => {
    const api = mockApi();
    api.reply(createCommentFixture.ok());
    const view = render();
    press("Reply");
    fill("Reply on the portal", "We ship it in June.");
    press("Send reply");
    expect(await view.findByRole("button", { name: "Reply" })).toBeVisible();
    const [call] = api.calls("createQuillsComment");
    expect(new URL(call!.url).pathname).toBe(
      "/api/quills/workspace_test_1/posts/post_export/comments",
    );
    await expect(call!.clone().json()).resolves.toEqual({
      content: "We ship it in June.",
      isPrivate: false,
    });
  });

  it("closes the note composer without a request", async () => {
    const api = mockApi();
    const view = render();
    press(/Add note/);
    expect(view.getByLabelText("Private note for the team")).toHaveFocus();
    press("Cancel");
    await waitFor(() =>
      expect(view.getByRole("button", { name: /Add note/ })).toBeVisible(),
    );
    expect(api.calls()).toHaveLength(0);
  });

  it("disables the actions without the create permission", () => {
    const view = render({
      ...postTeam,
      permissions: { ...postTeam.permissions, create: false },
    });
    expect(view.getByRole("button", { name: "Reply" })).toBeDisabled();
    expect(view.getByRole("button", { name: /Add note/ })).toBeDisabled();
  });
});
