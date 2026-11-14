import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { mergePostFixture } from "../../../api/team/merge-post.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { inboxPosts, inboxStatuses } from "../../team-posts/inbox.fixture";
import { postDetail, postTeam } from "../post.fixture";
import { MergePalette } from "./merge-palette";

describe("MergePalette", () => {
  it("merges the chosen request into this one in the here mode", async () => {
    const api = mockApi();
    api.reply(inboxPosts);
    api.reply(mergePostFixture.ok());
    const onClose = vi.fn();
    const view = renderComponent(
      <TeamRuntimeProvider value={postTeam}>
        <MergePalette
          workspaceId="workspace_test_1"
          post={postDetail}
          statuses={inboxStatuses.statuses}
          mode="here"
          onClose={onClose}
        />
      </TeamRuntimeProvider>,
    );
    expect(view.getByText("Merge here")).toBeVisible();
    fireEvent.change(
      view.getByRole("combobox", { name: "Find the request to merge here…" }),
      { target: { value: "sign" } },
    );
    fireEvent.click(
      await view.findByRole("option", { name: /Single sign-on/ }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(new URL(api.calls("mergeQuillsPost")[0]!.url).pathname).toBe(
      "/api/quills/workspace_test_1/posts/post_sso/merge",
    );
    await expect(
      api.calls("mergeQuillsPost")[0]!.clone().json(),
    ).resolves.toEqual({ canonicalPostId: "post_export" });
  });
});
