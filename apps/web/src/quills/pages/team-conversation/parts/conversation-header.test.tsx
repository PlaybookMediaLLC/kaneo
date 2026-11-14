import type { ReactElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import { assignConversationFixture } from "../../../api/team/assign-conversation.fixture";
import { getConversationFixture } from "../../../api/team/get-conversation.fixture";
import { setConversationStatusFixture } from "../../../api/team/set-conversation-status.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { choose } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ConversationHeader } from "./conversation-header";

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
const people = [
  {
    id: "principal_test_2",
    userId: "user_test_2",
    name: "Ada Teammate",
    avatarUrl: null,
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];
const conversation = getConversationFixture.ok({
  id: "conversation_test_1",
  subject: "Export fails",
  visitorName: "Grace Customer",
  channel: "email",
});

describe("ConversationHeader", () => {
  it("keeps a heading while the conversation loads", () => {
    const view = render(
      <ConversationHeader workspaceId="workspace_test_1" people={[]} />,
    );
    expect(view.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Conversation",
    );
    expect(view.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the subject, customer and source, and changes the status and assignee", async () => {
    const api = mockApi();
    api.reply(setConversationStatusFixture.ok({ status: "closed" }));
    api.reply(assignConversationFixture.ok());
    const view = render(
      <ConversationHeader
        workspaceId="workspace_test_1"
        conversation={conversation}
        people={people}
      />,
    );
    expect(view.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Export fails",
    );
    expect(view.getByText("Grace Customer")).toBeInTheDocument();
    expect(view.getByText("Email")).toBeInTheDocument();
    await choose("Status", "Closed");
    await view.findByRole("combobox", { name: "Status" });
    await expect
      .poll(() => api.calls("setQuillsConversationStatus").length)
      .toBe(1);
    expect(await api.calls("setQuillsConversationStatus")[0]!.json()).toEqual({
      status: "closed",
    });
    await choose("Assignee", "Ada Teammate");
    await expect
      .poll(() => api.calls("assignQuillsConversation").length)
      .toBe(1);
    expect(await api.calls("assignQuillsConversation")[0]!.json()).toEqual({
      assigneePrincipalId: "principal_test_2",
    });
  });

  it("explains a refused close", async () => {
    const api = mockApi();
    const refused = setConversationStatusFixture.problem(409);
    api.reply(refused.body, refused.status);
    const view = render(
      <ConversationHeader
        workspaceId="workspace_test_1"
        conversation={conversation}
        people={people}
      />,
    );
    await choose("Status", "Closed");
    expect(await view.findByRole("alert")).toHaveTextContent(
      /required fields/i,
    );
  });
});
