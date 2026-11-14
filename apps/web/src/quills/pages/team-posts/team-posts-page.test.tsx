import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createPostFixture } from "../../api/team/create-post.fixture";
import type { ListPostsResponse } from "../../api/team/list-posts";
import { listPostsFixture } from "../../api/team/list-posts.fixture";
import { listUsersFixture } from "../../api/team/list-users.fixture";
import { choose, fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import {
  inboxBoards,
  inboxCustomer,
  inboxPosts,
  inboxStatuses,
  inboxTags,
} from "./inbox.fixture";
import { meta } from "./meta";
import { TeamPostsPage } from "./team-posts-page";

// The statuses and boards load first; the posts wait for the statuses.
const prepare = (posts: ListPostsResponse = inboxPosts) => {
  const api = mockApi();
  api.reply(inboxStatuses);
  api.reply(inboxBoards);
  api.reply(posts);
  return api;
};
// The New request modal opens with the statuses and boards, so its tags load before the posts.
const creating = () => {
  const api = mockApi();
  api.reply(inboxStatuses);
  api.reply(inboxBoards);
  api.reply(inboxTags);
  api.reply(inboxPosts);
  return api;
};
const createFlow = async (view: ReturnType<typeof renderPage>) => {
  await view.findByRole("dialog");
  fill("Submission title", "Dark mode");
  fill("Add details", "For the **night** shift.");
  press("Create");
};

describe("TeamPostsPage", () => {
  describePageContract(meta, TeamPostsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 2; index++) api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.reply(inboxBoards);
      },
    },
    empty: { prepare: () => void prepare(listPostsFixture.ok()) },
    ready: { prepare: () => void prepare() },
    done: {
      prepare: () => {
        const api = creating();
        api.reply(createPostFixture.ok({ id: "post_dark" }));
        return { search: { new: true } };
      },
      act: async (view) => {
        await createFlow(view);
        await waitFor(() =>
          expect(view.router.state.location.pathname).toBe(
            "/feedback/workspace_test_1/posts/post_dark",
          ),
        );
      },
    },
  });

  it("groups the open posts by status with the row details", async () => {
    const api = prepare({
      ...inboxPosts,
      items: [
        { ...inboxPosts.items[0]!, updatedAt: "2020-01-01T00:00:00.000Z" },
        inboxPosts.items[1]!,
      ],
    });
    const view = renderPage(TeamPostsPage, meta);
    const list = await view.findByRole("region", { name: "Requests" });
    const open = within(list).getByRole("group", { name: /^Open/ });
    const row = within(open).getByRole("link", { name: /Export to CSV/ });
    expect(row).toHaveTextContent("3 votes");
    expect(row).toHaveTextContent("Ideas");
    expect(row).toHaveTextContent(/Stale \d+mo/);
    expect(row).not.toHaveTextContent("Export to CSV details");
    expect(within(list).getByRole("group", { name: /^Planned/ })).toBeVisible();
    expect(
      view.getByRole("heading", { level: 1, name: "Requests" }),
    ).toBeVisible();
    const query = new URL(api.calls("listQuillsPosts")[0]!.url).searchParams;
    expect(query.get("statusIds")).toBe("status_open,status_planned");
    expect(query.get("sort")).toBe("newest");
  });

  it("keeps the filters in the address and opens a post with them", async () => {
    prepare();
    const view = renderPage(TeamPostsPage, meta, {
      search: { board: "board_ideas", sort: "votes" },
    });
    const row = await view.findByRole("link", { name: /Export to CSV/ });
    expect(row.getAttribute("href")).toContain(
      "/feedback/workspace_test_1/posts/post_export?",
    );
    fireEvent.click(row);
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        "/feedback/workspace_test_1/posts/post_export",
      ),
    );
    expect(view.router.state.location.search).toEqual({
      board: "board_ideas",
      sort: "votes",
    });
  });

  it("shows one sidebar status by name and changes the status group from the filter menu", async () => {
    prepare();
    const view = renderPage(TeamPostsPage, meta, {
      search: { statusId: "status_planned" },
    });
    expect(
      await view.findByRole("heading", { level: 1, name: "Planned" }),
    ).toBeVisible();
    press("Filters");
    fireEvent.click(await view.findByRole("menuitemradio", { name: "Closed" }));
    await waitFor(() =>
      expect(view.router.state.location.search).toEqual({ status: "closed" }),
    );
  });

  it("puts the typed search in the address", async () => {
    prepare();
    const view = renderPage(TeamPostsPage, meta);
    await view.findByRole("region", { name: "Requests" });
    fill("Search requests…", " export ");
    await waitFor(() =>
      expect(view.router.state.location.search).toEqual({ q: "export" }),
    );
  });

  it("creates a request with the default status", async () => {
    const api = creating();
    api.reply(createPostFixture.ok({ id: "post_dark" }));
    const view = renderPage(TeamPostsPage, meta, { search: { new: true } });
    await createFlow(view);
    await waitFor(() => expect(api.calls("createQuillsPost")).toHaveLength(1));
    await expect(
      api.calls("createQuillsPost")[0]!.clone().json(),
    ).resolves.toEqual({
      boardId: "board_ideas",
      title: "Dark mode",
      content: "For the **night** shift.",
      statusId: "status_open",
      tagIds: [],
    });
  });

  it("posts for a customer with a status and a tag", async () => {
    const api = creating();
    api.reply(listUsersFixture.ok({ items: [inboxCustomer] }));
    api.reply(createPostFixture.ok({ id: "post_dark" }));
    const view = renderPage(TeamPostsPage, meta, { search: { new: true } });
    await view.findByRole("dialog");
    fireEvent.click(view.getByRole("combobox", { name: "Author: You" }));
    fill("Find a customer", "barb");
    fireEvent.click(await view.findByRole("option", { name: "Barbara" }));
    expect(
      view.getByRole("combobox", { name: "Author: Barbara" }),
    ).toBeVisible();
    await choose("Status", "Planned");
    press("Tags");
    fireEvent.click(await view.findByRole("menuitemcheckbox", { name: "UX" }));
    await createFlow(view);
    await waitFor(() => expect(api.calls("createQuillsPost")).toHaveLength(1));
    await expect(
      api.calls("createQuillsPost")[0]!.clone().json(),
    ).resolves.toMatchObject({
      statusId: "status_planned",
      tagIds: ["tag_ux"],
      authorPrincipalId: "principal_new",
    });
  });

  it("hides New request without the create permission", async () => {
    prepare();
    const view = renderPage(TeamPostsPage, meta, {
      permissions: { create: false },
    });
    await view.findByRole("region", { name: "Requests" });
    expect(view.queryByRole("button", { name: /New request/ })).toBeNull();
    expect(view.getByRole("link", { name: /Triage/ })).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/triage",
    );
  });
});
