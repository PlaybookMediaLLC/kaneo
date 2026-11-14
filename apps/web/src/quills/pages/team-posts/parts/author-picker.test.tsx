import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { listUsersFixture } from "../../../api/team/list-users.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { postTeam } from "../../team-post/post.fixture";
import { inboxCustomer } from "../inbox.fixture";
import { AuthorPicker } from "./author-picker";

const render = (onChange = vi.fn(), team = postTeam) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>
      <AuthorPicker
        workspaceId="workspace_test_1"
        value={null}
        onChange={onChange}
      />
    </TeamRuntimeProvider>,
  );

describe("AuthorPicker", () => {
  it("finds a customer to post for", async () => {
    const api = mockApi();
    api.reply(listUsersFixture.ok({ items: [inboxCustomer] }));
    const onChange = vi.fn();
    const view = render(onChange);
    press("Author: You");
    fill("Find a customer", "barb");
    fireEvent.click(await view.findByRole("button", { name: "Barbara" }));
    expect(onChange).toHaveBeenCalledWith({
      principalId: "principal_new",
      name: "Barbara",
      avatarUrl: null,
    });
    expect(
      new URL(api.calls("listQuillsUsers")[0]!.url).searchParams.get("search"),
    ).toBe("barb");
  });

  it("posts as the teammate without the update permission", () => {
    const api = mockApi();
    const view = render(vi.fn(), {
      ...postTeam,
      permissions: { ...postTeam.permissions, update: false },
    });
    expect(view.getByText("You")).toBeVisible();
    expect(view.queryByRole("button")).toBeNull();
    expect(api.calls()).toHaveLength(0);
  });
});
