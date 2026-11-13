import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getPortalPostFixture } from "../../../api/feedback/get-portal-post.fixture";
import { listPortalPostsFixture } from "../../../api/feedback/list-portal-posts.fixture";
import { listPortalStatusesFixture } from "../../../api/feedback/list-portal-statuses.fixture";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { HomeFeed } from "./home-feed";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

describe("HomeFeed", () => {
  it("sends the selected sort and search to the workspace-scoped API", async () => {
    const api = mockApi();
    api.reply(listPortalStatusesFixture.ok());
    api.reply(listPortalPostsFixture.ok());
    const view = renderComponent(
      <HomeFeed
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        boards={[]}
        filters={{ sort: "votes", search: "exports" }}
      />,
    );
    await view.findByText("No posts match these filters.");
    expect(
      new URL(api.calls("listQuillsPortalPosts")[0].url).searchParams.get(
        "limit",
      ),
    ).toBe("10");
    const url = new URL(api.calls("listQuillsPortalPosts")[0].url);
    expect(url.searchParams.get("sort")).toBe("votes");
    expect(url.searchParams.get("search")).toBe("exports");
    expect(url.pathname).toContain("workspace_test_1");
  });
});

it("serializes votes and retains failure recovery on the active row", async () => {
  const api = mockApi();
  const post = getPortalPostFixture.ok();
  api.reply(listPortalStatusesFixture.ok());
  api.reply(
    listPortalPostsFixture.ok({
      items: [post, { ...post, id: "post_test_2", title: "Another idea" }],
    }),
  );
  let resolve!: (body: unknown, status?: number) => void;
  api.defer((controls) => {
    resolve = controls.resolve;
  });
  const view = renderComponent(
    <HomeFeed
      workspaceId="workspace_test_1"
      viewer={{ kind: "user", id: "user_1" }}
      boards={[
        {
          ...post.board,
          description: null,
          canVote: true,
          canSubmit: true,
          canComment: true,
          postCount: 2,
        },
      ]}
    />,
  );
  await view.findByText("Another idea");
  const buttons = view.getAllByRole("button", { name: "Vote" });
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(buttons[1]).toBeDisabled());
  fireEvent.click(buttons[1]);
  expect(api.calls("setQuillsPortalVote")).toHaveLength(1);
  await act(async () => resolve({ message: "Unavailable" }, 500));
  await view.findByRole("button", { name: "Try again" });
  expect(buttons[1]).toBeDisabled();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(view.getAllByRole("button", { name: "Vote" })[1]).toBeEnabled(),
  );
});
