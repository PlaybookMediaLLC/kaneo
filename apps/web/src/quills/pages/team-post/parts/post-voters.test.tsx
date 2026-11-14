import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { addPostProxyVoteFixture } from "../../../api/team/add-post-proxy-vote.fixture";
import type { ListUsersResponse } from "../../../api/team/list-users";
import { listUsersFixture } from "../../../api/team/list-users.fixture";
import { removePostVoteFixture } from "../../../api/team/remove-post-vote.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postDetail, postTeam, postVoters } from "../post.fixture";
import { PostVoters } from "./post-voters";

const render = (team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <PostVoters workspaceId="workspace_test_1" post={postDetail} />
    </TeamRuntimeProvider>,
  );
const user: ListUsersResponse["items"][number] = {
  principalId: "principal_new",
  userId: "user_new",
  name: "Barbara",
  email: "barbara@example.test",
  contactEmail: null,
  image: null,
  emailVerified: true,
  isLead: false,
  country: null,
  locale: null,
  externalId: null,
  attributes: [],
  companyId: null,
  blockedAt: null,
  joinedAt: "2026-01-01T00:00:00.000Z",
  postCount: 0,
  commentCount: 0,
  voteCount: 0,
};

describe("PostVoters", () => {
  it("lists the voters and removes a vote that the team added", async () => {
    const api = mockApi();
    api.reply(postVoters);
    const view = render();
    expect(await view.findByText("Blocker")).toBeVisible();
    expect(
      view.queryByRole("button", { name: /Linus/ }),
    ).not.toBeInTheDocument();
    api.reply(removePostVoteFixture.ok());
    fireEvent.click(
      view.getByRole("button", {
        name: "Remove the vote that the team added for Margaret",
      }),
    );
    await waitFor(() =>
      expect(api.calls("removeQuillsPostVote")).toHaveLength(1),
    );
    expect(new URL(api.calls("removeQuillsPostVote")[0]!.url).pathname).toBe(
      "/api/quills/workspace_test_1/posts/post_export/voters/principal_proxy",
    );
  });

  it("finds a customer and adds a vote for them", async () => {
    const api = mockApi();
    api.reply(postVoters);
    api.reply(listUsersFixture.ok({ items: [user], total: 1 }));
    api.reply(addPostProxyVoteFixture.ok());
    const view = render();
    await view.findByText("Blocker");
    fireEvent.change(view.getByLabelText("Add a vote for a customer"), {
      target: { value: "barb" },
    });
    fireEvent.click(
      await view.findByRole("button", { name: "Add a vote for Barbara" }),
    );
    await waitFor(() =>
      expect(api.calls("addQuillsPostProxyVote")).toHaveLength(1),
    );
    expect(
      new URL(api.calls("listQuillsUsers")[0]!.url).searchParams.get("search"),
    ).toBe("barb");
  });

  it("hides the vote controls without the update permission", async () => {
    mockApi().reply(postVoters);
    const view = render({
      ...postTeam,
      permissions: { ...postTeam.permissions, update: false },
    });
    await view.findByText("Blocker");
    expect(
      view.queryByLabelText("Add a vote for a customer"),
    ).not.toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: /Remove/ }),
    ).not.toBeInTheDocument();
  });
});
