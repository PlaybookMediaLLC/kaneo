import { describe, expect, it } from "vite-plus/test";
import { listMyConversationsFixture } from "../../../api/support/list-my-conversations.fixture";
import { renderComponent } from "../../../test/render";
import { ConversationList } from "./conversation-list";

describe("ConversationList", () => {
  it("links a conversation to the existing detail route", () => {
    const conversation = listMyConversationsFixture.ok({
      items: [
        {
          id: "conversation_test_1",
          status: "open",
          isReadOnly: false,
          subject: "Billing",
          preview: "Hello",
          lastMessageAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          unreadCount: 1,
          csatRating: null,
          csatSubmittedAt: null,
        },
      ],
    }).items;
    const view = renderComponent(
      <ConversationList
        workspaceId="workspace_test_1"
        conversations={conversation}
      />,
    );
    expect(
      view.getByRole("link", { name: "Open conversation: Billing" }),
    ).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/conversations/conversation_test_1",
    );
  });
});
