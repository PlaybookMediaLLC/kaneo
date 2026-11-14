import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createCommentFixture } from "../../api/team/create-comment.fixture";
import { getLinkedConversationsForPostFixture } from "../../api/team/get-linked-conversations-for-post.fixture";
import { listLinksFixture } from "../../api/team/list-links.fixture";
import { listMergedPostsFixture } from "../../api/team/list-merged-posts.fixture";
import { listTagsFixture } from "../../api/team/list-tags.fixture";
import { setPostStatusFixture } from "../../api/team/set-post-status.fixture";
import { fill, press } from "../../test/actions";
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
// The page requests, then the properties panel from top to bottom (meta.ts).
const prepare = () => {
  const api = mockApi();
  api.reply(postDetail);
  api.reply(postComments);
  api.reply(inboxStatuses);
  api.reply(inboxBoards);
  api.reply(inboxPosts);
  api.reply(listTagsFixture.ok());
  api.reply(postVoters);
  api.reply(postDemand);
  api.reply(listLinksFixture.ok());
  api.reply(getLinkedConversationsForPostFixture.ok());
  api.reply(listMergedPostsFixture.ok());
  return api;
};
const render = () => renderPage(TeamPostPage, meta, options);
// The properties panel shows once every page request has an answer.
const loaded = (view: ReturnType<typeof render>) =>
  view.findByRole("combobox", { name: "Status" });

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
          view.getByRole("complementary", { name: "Post properties" }),
        ).toHaveTextContent("Margaret");
      },
    },
    done: {
      prepare: () => {
        const api = prepare();
        api.reply(createCommentFixture.ok());
        // The reply refreshes the list, the post and the comments.
        api.reply(inboxPosts);
        api.reply(postDetail);
        api.reply(postComments);
        return options;
      },
      act: async (view) => {
        await loaded(view);
        press("Reply");
        fill("Reply on the portal", "We ship it in June.");
        press("Send reply");
        await waitFor(() =>
          expect(view.getByRole("button", { name: /Reply/ })).toBeVisible(),
        );
      },
    },
  });

  it("shows the post, the replies, the private note and the properties", async () => {
    prepare();
    const view = render();
    expect(
      await view.findByRole("heading", { level: 1, name: "Export to CSV" }),
    ).toBeVisible();
    await loaded(view);
    const panel = view.getByRole("complementary", { name: "Post properties" });
    expect(
      view.getByText("Two enterprise accounts ask for this."),
    ).toBeVisible();
    expect(view.getByText("Private note")).toBeVisible();
    expect(within(panel).getByRole("combobox", { name: "Status" })).toHaveValue(
      "status_open",
    );
    expect(
      await within(panel).findByText("Enterprise (2 voters)"),
    ).toBeVisible();
    expect(within(panel).getByText("40")).toBeVisible();
    const list = view.getByRole("region", { name: "Inbox" });
    expect(
      within(list).getByRole("link", { name: /Export to CSV/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("saves a private note", async () => {
    const api = prepare();
    api.reply(createCommentFixture.ok({ isPrivate: true }));
    const view = render();
    await loaded(view);
    press(/Add note/);
    fill("Private note for the team", "Call them on Monday.");
    press("Save note");
    await waitFor(() =>
      expect(api.calls("createQuillsComment")).toHaveLength(1),
    );
    await expect(
      api.calls("createQuillsComment")[0]!.clone().json(),
    ).resolves.toEqual({ content: "Call them on Monday.", isPrivate: true });
  });

  it("changes the status and refreshes the post", async () => {
    const api = prepare();
    api.reply(setPostStatusFixture.ok({ id: "post_export" }));
    api.reply(inboxPosts);
    api.reply({ ...postDetail, statusId: "status_done" });
    const view = render();
    await loaded(view);
    const panel = view.getByRole("complementary", { name: "Post properties" });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Status" }), {
      target: { value: "status_done" },
    });
    await waitFor(() => expect(api.calls("getQuillsPost")).toHaveLength(2));
    await expect(
      api.calls("setQuillsPostStatus")[0]!.clone().json(),
    ).resolves.toEqual({ statusId: "status_done" });
    await waitFor(() =>
      expect(
        within(panel).getByRole("combobox", { name: "Status" }),
      ).toHaveValue("status_done"),
    );
  });

  it("moves to the next post and back to the list with the filters", async () => {
    prepare();
    const view = render();
    await loaded(view);
    press("Next");
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
