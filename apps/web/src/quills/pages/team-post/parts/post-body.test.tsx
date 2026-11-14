import { describe, expect, it } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { inboxBoards } from "../../team-posts/inbox.fixture";
import { postDetail, postTeam, postVoters } from "../post.fixture";
import { PostBody } from "./post-body";

describe("PostBody", () => {
  it("shows the author, the rendered text and the chip row", async () => {
    const api = mockApi();
    api.reply(postVoters);
    const view = renderComponent(
      <TeamRuntimeProvider value={postTeam}>
        <PostBody
          workspaceId="workspace_test_1"
          post={{ ...postDetail, content: "We need **CSV** exports." }}
          boards={inboxBoards.items}
        />
      </TeamRuntimeProvider>,
    );
    expect(view.getByText("Ada")).toBeVisible();
    expect(view.getByText("CSV").tagName).toBe("STRONG");
    expect(view.getByRole("button", { name: "Board: Ideas" })).toBeVisible();
    expect(view.getByRole("button", { name: "3 votes" })).toBeVisible();
    await view.findByText("On board");
    expect(api.calls("listQuillsPostVoters")).toHaveLength(1);
  });
});
