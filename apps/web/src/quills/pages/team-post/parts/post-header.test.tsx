import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { postDetail, postTeam } from "../post.fixture";
import { PostHeader } from "./post-header";

const render = (post = postDetail, onMerge = vi.fn(), onBack = vi.fn()) =>
  renderComponent(
    <TeamRuntimeProvider value={postTeam}>
      <PostHeader
        workspaceId="workspace_test_1"
        post={post}
        boardName="Ideas"
        onBack={onBack}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onMerge={onMerge}
        onDeleted={vi.fn()}
      />
    </TeamRuntimeProvider>,
  );

describe("PostHeader", () => {
  it("goes back to the board and offers both merge directions", async () => {
    const onMerge = vi.fn();
    const onBack = vi.fn();
    const view = render(postDetail, onMerge, onBack);
    press("Back to Ideas");
    expect(onBack).toHaveBeenCalled();
    press("Merge options");
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Merge others here…" }),
    );
    expect(onMerge).toHaveBeenCalledWith("here");
    press("Merge options");
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Merge with other…" }),
    );
    expect(onMerge).toHaveBeenLastCalledWith("into");
  });

  it("does not merge a request that is merged already", () => {
    const view = render({ ...postDetail, canonicalPostId: "post_sso" });
    expect(view.getByRole("button", { name: "Merge options" })).toBeDisabled();
  });
});
