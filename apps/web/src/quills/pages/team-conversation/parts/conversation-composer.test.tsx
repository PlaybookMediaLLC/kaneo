import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { addConversationNoteFixture } from "../../../api/team/add-conversation-note.fixture";
import { replyConversationFixture } from "../../../api/team/reply-conversation.fixture";
import { sendConversationTypingFixture } from "../../../api/team/send-conversation-typing.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ConversationComposer } from "./conversation-composer";

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

describe("ConversationComposer", () => {
  it("signals typing once, sends the reply and closes", async () => {
    const api = mockApi();
    api.reply(sendConversationTypingFixture.ok());
    api.reply(replyConversationFixture.ok());
    const onClose = vi.fn();
    render(
      <ConversationComposer
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        mode="reply"
        onClose={onClose}
      />,
    );
    fill("Reply to the customer", "Fixed");
    fill("Reply to the customer", "Fixed now");
    press("Send reply");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls("sendQuillsConversationTyping")).toHaveLength(1);
    const [reply] = api.calls("replyQuillsConversation");
    expect(new URL(reply!.url).pathname).toBe(
      "/api/quills/workspace_test_1/conversations/conversation_test_1/reply",
    );
    expect(await reply!.json()).toEqual({ content: "Fixed now" });
  });

  it("saves a note without a typing signal, and keeps the text when it fails", async () => {
    const api = mockApi();
    const failed = addConversationNoteFixture.problem(429);
    api.reply(failed.body, failed.status);
    const onClose = vi.fn();
    const view = render(
      <ConversationComposer
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        mode="note"
        onClose={onClose}
      />,
    );
    fill("Note for the team", "Check the invoice");
    press("Save note");
    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(view.getByLabelText("Note for the team")).toHaveValue(
      "Check the invoice",
    );
    expect(api.calls("sendQuillsConversationTyping")).toHaveLength(0);
    expect(api.calls("addQuillsConversationNote")).toHaveLength(1);
  });
});
