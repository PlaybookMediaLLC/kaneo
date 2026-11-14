import type { ReactElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import { getConversationTypingFixture } from "../../../api/team/get-conversation-typing.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { MessageList } from "./message-list";

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
const message = (
  id: string,
  values: Partial<{
    senderType: "visitor" | "agent" | "system";
    isInternal: boolean;
    authorName: string | null;
    content: string;
  }>,
) => ({
  id,
  conversationId: "conversation_test_1",
  senderType: "visitor" as const,
  isInternal: false,
  authorPrincipalId: null,
  authorName: null,
  content: "",
  systemKind: null,
  embeds: [],
  attachments: [],
  reactions: [],
  flaggedAt: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  editedAt: null,
  ...values,
});

describe("MessageList", () => {
  it("shows the thread oldest first, marks notes and shows the customer typing", async () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok({ visitorTyping: true }));
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[
          message("m4", { senderType: "system", content: "Ada closed this" }),
          message("m3", {
            senderType: "agent",
            isInternal: true,
            authorName: "Ada",
            content: "Check the invoice",
          }),
          message("m2", {
            senderType: "agent",
            authorName: "Ada",
            content: "On it",
          }),
          message("m1", { content: "Export fails" }),
        ]}
      />,
    );
    const items = view.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toContain("Grace");
    expect(items[0]).toContain("Export fails");
    expect(items[2]).toContain("Internal note");
    expect(items[3]).toBe("Ada closed this");
    expect(await view.findByText("Grace is typing…")).toBeInTheDocument();
  });

  it("says when the thread is empty", () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok());
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[]}
      />,
    );
    expect(view.getByText("No messages yet.")).toBeInTheDocument();
  });
});
