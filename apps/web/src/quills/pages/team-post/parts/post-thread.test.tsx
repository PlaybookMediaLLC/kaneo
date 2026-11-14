import { fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { postComments, postDetail } from "../post.fixture";
import { PostThread } from "./post-thread";

const [customer, reply, note] = postComments.items;

describe("PostThread", () => {
  it("shows the post, nests replies and marks the private note", () => {
    const onLoadMore = vi.fn();
    const view = renderComponent(
      <PostThread
        post={postDetail}
        comments={[
          customer,
          { ...reply, parentId: customer.id },
          note,
          { ...note, id: "comment_removed", isRemovedByTeam: true },
        ]}
        hasMore
        loadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );
    expect(view.getByText(postDetail.content)).toBeVisible();
    expect(view.getByRole("heading", { name: "3 comments" })).toBeVisible();
    const first = view.getByText(customer.content).closest("li")!;
    expect(within(first).getByText(reply.content)).toBeVisible();
    expect(view.getAllByText("Private note")).toHaveLength(1);
    expect(view.getByText(note.content)).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Load more replies" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("says when there is no reply", () => {
    const view = renderComponent(
      <PostThread
        post={{ ...postDetail, commentCount: 0 }}
        comments={[]}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
      />,
    );
    expect(view.getByText("No replies yet.")).toBeVisible();
  });
});
