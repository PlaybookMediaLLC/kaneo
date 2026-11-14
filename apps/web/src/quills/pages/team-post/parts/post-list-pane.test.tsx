import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { setPostScoreFixture } from "../../../api/team/set-post-score.fixture";
import { listStatusesFixture } from "../../../api/team/list-statuses.fixture";
import { renderComponent } from "../../../test/render";
import { PostListPane } from "./post-list-pane";

const post = {
  ...setPostScoreFixture.ok({ title: "Request 1" }),
  demand: {
    voters: 0,
    companies: 0,
    mrrCents: 0,
    importance: { nice: 0, important: 0, critical: 0 },
  },
};

describe("PostListPane", () => {
  it("shows compact cards with the open post selected", () => {
    const onOpen = vi.fn();
    const pair = [
      { ...post, id: "post_1" },
      { ...post, id: "post_2", title: "Request 2" },
    ];
    const view = renderComponent(
      <PostListPane
        posts={pair}
        statuses={listStatusesFixture.ok().statuses}
        boardName={new Map()}
        activeId="post_2"
        href={(id) => `/feedback/workspace_test_1/posts/${id}`}
        onOpen={onOpen}
        loading={false}
      />,
    );
    expect(
      view.getByRole("heading", { level: 2, name: "Feedback inbox" }),
    ).toBeVisible();
    const open = view.getByRole("link", { name: /Request 2/ });
    expect(open).toHaveAttribute("aria-current", "true");
    expect(open).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/posts/post_2",
    );
    fireEvent.click(view.getByRole("link", { name: /Request 1/ }));
    expect(onOpen).toHaveBeenCalledWith("post_1");
  });
});
