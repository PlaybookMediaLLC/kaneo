import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { addConversationTagFixture } from "../../../api/team/add-conversation-tag.fixture";
import { listConversationTagsFixture } from "../../../api/team/list-conversation-tags.fixture";
import { removeConversationTagFixture } from "../../../api/team/remove-conversation-tag.fixture";
import { choose, press } from "../../../test/actions";
import { TagEditor } from "./tag-editor";

const team = {
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "user_test_1" },
  permissions: {
    read: true,
    create: true,
    update: true,
    delete: true,
    manageSettings: true,
  },
};
const render = (element: ReactElement) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>{element}</TeamRuntimeProvider>,
  );

const tag = (id: string, name: string) => ({
  id,
  name,
  color: "gray",
  count: null,
});

describe("TagEditor", () => {
  it("removes a tag and adds a tag that the conversation does not have", async () => {
    const api = mockApi();
    api.reply(
      listConversationTagsFixture.ok({
        items: [tag("tag_1", "Billing"), tag("tag_2", "Bug")],
      }),
    );
    api.reply(removeConversationTagFixture.ok());
    api.reply(addConversationTagFixture.ok());
    const view = render(
      <TagEditor
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        tags={[{ id: "tag_1", name: "Billing" }]}
      />,
    );
    await view.findByRole("combobox", { name: "Add a tag" });
    await choose("Add a tag", "Bug");
    await vi.waitFor(() =>
      expect(api.calls("addQuillsConversationTag")).toHaveLength(1),
    );
    expect(await api.calls("addQuillsConversationTag")[0]!.json()).toEqual({
      tagId: "tag_2",
    });
    await vi.waitFor(() => press("Remove the tag Billing"));
    await vi.waitFor(() =>
      expect(api.calls("removeQuillsConversationTag")).toHaveLength(1),
    );
    expect(
      new URL(api.calls("removeQuillsConversationTag")[0]!.url).pathname,
    ).toBe(
      "/api/quills/workspace_test_1/conversations/conversation_test_1/tags/tag_1",
    );
  });
});
