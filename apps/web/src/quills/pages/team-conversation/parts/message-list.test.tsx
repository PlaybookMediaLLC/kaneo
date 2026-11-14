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
    systemKind: string | null;
    createdAt: string;
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
  it("shows the thread oldest first with day lines, bubbles, notes, events and the typing", async () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok({ visitorTyping: true }));
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[
          message("m4", {
            senderType: "system",
            systemKind: "chat_ended",
            content: "Conversation ended",
            createdAt: "2026-11-02T09:00:00.000Z",
          }),
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
        people={[]}
      />,
    );
    const items = view.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Grace");
    expect(items[0]).toHaveTextContent("Export fails");
    // A day line starts the thread and each new day.
    expect(items[0]!.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-01T10:00:00.000Z",
    );
    expect(items[1]!.querySelectorAll("time")).toHaveLength(1);
    expect(items[2]).toHaveTextContent("Note");
    expect(items[2]).toHaveTextContent("Check the invoice");
    expect(items[3]).toHaveTextContent("Conversation ended");
    expect(items[3]!.querySelectorAll("time")).toHaveLength(2);
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
        people={[]}
      />,
    );
    expect(view.getByText("No messages yet.")).toBeInTheDocument();
  });
});
