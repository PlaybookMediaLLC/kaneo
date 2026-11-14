import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createCommentFixture } from "../../api/team/create-comment.fixture";
import { deletePostFixture } from "../../api/team/delete-post.fixture";
import { getLinkedConversationsForPostFixture } from "../../api/team/get-linked-conversations-for-post.fixture";
import { listLinksFixture } from "../../api/team/list-links.fixture";
import { listMergedPostsFixture } from "../../api/team/list-merged-posts.fixture";
import { mergePostFixture } from "../../api/team/merge-post.fixture";
import { setPostStatusFixture } from "../../api/team/set-post-status.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import {
  inboxBoards,
  inboxPosts,
  inboxStatuses,
} from "../team-posts/inbox.fixture";
import { meta } from "./meta";
import {
  postComments,
  postDemand,
  postDetail,
  postVoters,
} from "./post.fixture";
import { TeamPostPage } from "./team-post-page";

const options = {
  params: { postId: "post_export" },
  search: { board: "board_ideas" },
};
// The page requests, then the voters of the chip row and the panel from top to bottom (meta.ts).
const prepare = () => {
  const api = mockApi();
  api.reply(postDetail);
  api.reply(postComments);
  api.reply(inboxStatuses);
  api.reply(inboxBoards);
  api.reply(inboxPosts);
  api.reply(postVoters);
  api.reply(postDemand);
  api.reply(listLinksFixture.ok());
  api.reply(getLinkedConversationsForPostFixture.ok());
  api.reply(listMergedPostsFixture.ok());
  return api;
};
const render = () => renderPage(TeamPostPage, meta, options);
// The request shows once every page request has an answer.
const loaded = (view: ReturnType<typeof render>) =>
  view.findByRole("group", { name: "Request actions" });
const comment = (view: ReturnType<typeof render>, text: string) => {
  const box = view.getByRole("textbox", { name: "Write a comment…" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("TeamPostPage", () => {
  describePageContract(meta, TeamPostPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 4; index++) api.defer(() => undefined);
        return options;
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.reply(postComments);
        api.reply(inboxStatuses);
        api.reply(inboxBoards);
        api.reply(inboxPosts);
        return options;
      },
    },
    ready: {
      prepare: () => {
        prepare();
        return options;
      },
      assert: async (view) => {
        await loaded(view);
        expect(
          view.getByRole("complementary", { name: "Request properties" }),
        ).toHaveTextContent("Enterprise");
      },
    },
    done: {
      prepare: () => {
        const api = prepare();
        api.reply(createCommentFixture.ok());
        // The comment refreshes the list, the post and the comments.
        api.reply(inboxPosts);
        api.reply(postDetail);
        api.reply(postComments);
        return options;
      },
      act: async (view) => {
        await loaded(view);
        comment(view, "We ship it in June.");
        await waitFor(() =>
          expect(
            view.getByRole("textbox", { name: "Write a comment…" }),
          ).toHaveValue(""),
        );
      },
    },
  });

  it("shows the request, its chips, the comments and the properties", async () => {
    prepare();
    const view = render();
    expect(
      await view.findByRole("heading", { level: 1, name: "Export to CSV" }),
    ).toBeVisible();
    await loaded(view);
    expect(view.getByText(postDetail.content)).toBeVisible();
    expect(view.getByRole("button", { name: "Board: Ideas" })).toBeVisible();
    expect(view.getByText("On board")).toBeVisible();
    expect(view.getByText("API")).toBeVisible();
    expect(view.getByRole("button", { name: "3 votes" })).toBeVisible();
    expect(
      view.getByText("Two enterprise accounts ask for this."),
    ).toBeVisible();
    expect(view.getByText("Private note")).toBeVisible();
    expect(view.getByRole("button", { name: "Back to Ideas" })).toBeVisible();
    const panel = view.getByRole("complementary", {
      name: "Request properties",
    });
    expect(
      await within(panel).findByText("Enterprise (2 voters)"),
    ).toBeVisible();
    expect(within(panel).getByText("40")).toBeVisible();
    const list = view.getByRole("region", { name: "Requests" });
    expect(
      within(list).getByRole("link", { name: /Export to CSV/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("sends a private note from the composer", async () => {
    const api = prepare();
    api.reply(createCommentFixture.ok({ isPrivate: true }));
    const view = render();
    await loaded(view);
    press("Mode: Public");
    fireEvent.click(
      await view.findByRole("menuitemradio", { name: "Private note" }),
    );
    comment(view, "Call them on Monday.");
    await waitFor(() =>
      expect(api.calls("createQuillsComment")).toHaveLength(1),
    );
    await expect(
      api.calls("createQuillsComment")[0]!.clone().json(),
    ).resolves.toEqual({ content: "Call them on Monday.", isPrivate: true });
  });

  it("accepts a pending request into the next status", async () => {
    const api = prepare();
    api.reply(setPostStatusFixture.ok({ id: "post_export" }));
    api.reply(inboxPosts);
    api.reply({ ...postDetail, statusId: "status_planned" });
    const view = render();
    await loaded(view);
    // The test workspace has no closed status.
    expect(view.getByRole("button", { name: "Close" })).toBeDisabled();
    press(/^Accept/);
    await waitFor(() =>
      expect(api.calls("setQuillsPostStatus")).toHaveLength(1),
    );
    await expect(
      api.calls("setQuillsPostStatus")[0]!.clone().json(),
    ).resolves.toEqual({ statusId: "status_planned" });
    expect(
      await view.findByRole("button", { name: "Status: Planned" }),
    ).toBeVisible();
    expect(
      view.getByRole("button", { name: /^Move to Complete/ }),
    ).toBeVisible();
  });

  it("merges this request into another one from the palette", async () => {
    const api = prepare();
    api.reply(inboxPosts);
    api.reply(mergePostFixture.ok());
    const view = render();
    await loaded(view);
    press("Merge");
    fireEvent.change(
      await view.findByRole("combobox", {
        name: "Find the request to merge this into…",
      }),
      { target: { value: "sign" } },
    );
    const option = await view.findByRole("option", { name: /Single sign-on/ });
    // The search leaves out this request.
    expect(view.queryByRole("option", { name: /Export to CSV/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(api.calls("mergeQuillsPost")).toHaveLength(1));
    expect(new URL(api.calls("mergeQuillsPost")[0]!.url).pathname).toBe(
      "/api/quills/workspace_test_1/posts/post_export/merge",
    );
    await expect(
      api.calls("mergeQuillsPost")[0]!.clone().json(),
    ).resolves.toEqual({ canonicalPostId: "post_sso" });
  });

  it("deletes the request after a confirmation and goes back to the list", async () => {
    const api = prepare();
    api.reply(deletePostFixture.ok());
    api.reply(inboxPosts);
    const view = render();
    await loaded(view);
    press("More actions");
    fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
    const dialog = await view.findByRole("dialog", {
      name: "Delete this request?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        "/feedback/workspace_test_1/posts",
      ),
    );
    expect(api.calls("deleteQuillsPost")).toHaveLength(1);
    expect(view.router.state.location.search).toEqual({ board: "board_ideas" });
  });

  it("moves to the next request and back to the list with the filters", async () => {
    prepare();
    const view = render();
    await loaded(view);
    fireEvent.click(view.getAllByRole("button", { name: "Next" })[0]!);
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        "/feedback/workspace_test_1/posts/post_sso",
      ),
    );
    press(/^Back to /);
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        "/feedback/workspace_test_1/posts",
      ),
    );
    expect(view.router.state.location.search).toEqual({ board: "board_ideas" });
  });
});
