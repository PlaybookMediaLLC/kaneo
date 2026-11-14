import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createCommentFixture } from "../../../api/team/create-comment.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postComments, postDetail, postTeam } from "../post.fixture";
import { PostThread } from "./post-thread";

const [customer, reply, note] = postComments.items;

describe("PostThread", () => {
  it("nests replies and marks the private note", () => {
    const onLoadMore = vi.fn();
    const view = renderComponent(
      <TeamRuntimeProvider value={postTeam}>
        <PostThread
          workspaceId="workspace_test_1"
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
        />
      </TeamRuntimeProvider>,
    );
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
      <TeamRuntimeProvider value={postTeam}>
        <PostThread
          workspaceId="workspace_test_1"
          post={{ ...postDetail, commentCount: 0 }}
          comments={[]}
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => undefined}
        />
      </TeamRuntimeProvider>,
    );
    expect(view.getByText("No replies yet.")).toBeVisible();
  });

  it("replies to a comment in its thread", async () => {
    const api = mockApi();
    api.reply(createCommentFixture.ok());
    const view = renderComponent(
      <TeamRuntimeProvider value={postTeam}>
        <PostThread
          workspaceId="workspace_test_1"
          post={postDetail}
          comments={[customer]}
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => undefined}
        />
      </TeamRuntimeProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Reply" }));
    const box = view.getByRole("textbox", { name: /^Reply to / });
    fireEvent.change(box, { target: { value: "Thanks!" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(api.calls("createQuillsComment")).toHaveLength(1),
    );
    await expect(
      api.calls("createQuillsComment")[0]!.clone().json(),
    ).resolves.toEqual({ content: "Thanks!", parentId: customer.id });
  });
});
