import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { setPostScoreFixture } from "../../../api/team/set-post-score.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postDetail, postTeam } from "../post.fixture";
import { PostScore } from "./post-score";

const render = (onSaved = vi.fn(), team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <PostScore
        workspaceId="workspace_test_1"
        post={postDetail}
        onSaved={onSaved}
      />
    </TeamRuntimeProvider>,
  );

describe("PostScore", () => {
  it("edits the RICE inputs and refreshes the post", async () => {
    const api = mockApi();
    api.reply(setPostScoreFixture.ok());
    const onSaved = vi.fn();
    const view = render(onSaved);
    expect(view.getByText("40")).toBeVisible();
    press("Edit score");
    fill("Reach", "200");
    press("Save score");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await expect(
      api.calls("setQuillsPostScore")[0]!.clone().json(),
    ).resolves.toEqual({
      reach: 200,
      impact: 2,
      confidence: 80,
      effort: 4,
    });
    expect(
      view.queryByRole("button", { name: "Save score" }),
    ).not.toBeInTheDocument();
  });

  it("shows the score without an editor for a reader", () => {
    const view = render(vi.fn(), {
      ...postTeam,
      permissions: { ...postTeam.permissions, update: false },
    });
    expect(view.getByText("40")).toBeVisible();
    expect(
      view.queryByRole("button", { name: "Edit score" }),
    ).not.toBeInTheDocument();
  });
});
