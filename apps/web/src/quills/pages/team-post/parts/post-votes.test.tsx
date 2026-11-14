import { describe, expect, it } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postDetail, postTeam, postVoters } from "../post.fixture";
import { PostVotes } from "./post-votes";

describe("PostVotes", () => {
  it("opens the voters and the proxy vote from the vote pill", async () => {
    const api = mockApi();
    api.reply(postVoters);
    const view = renderComponent(
      <TeamRuntimeProvider value={postTeam}>
        <PostVotes workspaceId="workspace_test_1" post={postDetail} />
      </TeamRuntimeProvider>,
    );
    press("3 votes");
    expect(await view.findByText("Linus")).toBeVisible();
    expect(view.getByText("Blocker")).toBeVisible();
    expect(view.getByLabelText("Add a vote for a customer")).toBeVisible();
    // The pill and the voter list share one request.
    expect(api.calls("listQuillsPostVoters")).toHaveLength(1);
  });
});
