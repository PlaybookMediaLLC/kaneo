import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { listUsersFixture } from "../../../api/team/list-users.fixture";
import { startAgentConversationFixture } from "../../../api/team/start-agent-conversation.fixture";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { renderComponent } from "../../../test/render";
import { NewMessage } from "./new-message";

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

const ada = {
  principalId: "principal_test_9",
  userId: "user_test_9",
  name: "Ada Customer",
  email: "ada@example.test",
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

function renderNewMessage() {
  const onStarted = vi.fn();
  const onClose = vi.fn();
  const view = renderComponent(
    <TeamRuntimeProvider value={team}>
      <NewMessage
        workspaceId="workspace_test_1"
        onClose={onClose}
        onStarted={onStarted}
      />
    </TeamRuntimeProvider>,
  );
  return { view, onStarted, onClose };
}

describe("NewMessage", () => {
  it("finds a customer, then sends the first message and opens the conversation", async () => {
    const api = mockApi();
    api.reply(listUsersFixture.ok({ items: [ada], total: 1 }));
    api.reply(
      startAgentConversationFixture.ok({
        conversation: {
          ...startAgentConversationFixture.ok().conversation,
          id: "conversation_test_9",
        },
      }),
    );
    const { view, onStarted } = renderNewMessage();
    expect(
      view.getByRole("heading", { level: 2, name: "New message" }),
    ).toBeInTheDocument();
    fill("To", "ada");
    fireEvent.click(await view.findByRole("button", { name: /Ada Customer/ }));
    expect(
      view.getByRole("button", { name: "Remove Ada Customer" }),
    ).toBeInTheDocument();
    const query = new URL(api.calls("listQuillsUsers")[0]!.url).searchParams;
    expect(Object.fromEntries(query)).toEqual({ search: "ada", limit: "8" });
    fill("Write a message…", "Your export is ready.");
    fireEvent.keyDown(view.getByLabelText("Write a message…"), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith("conversation_test_9"),
    );
    expect(await api.calls("startQuillsAgentConversation")[0]!.json()).toEqual({
      targetPrincipalId: "principal_test_9",
      content: "Your export is ready.",
    });
  });

  it("says when no customer matches and when the customer cannot get mail", async () => {
    const api = mockApi();
    api.reply(listUsersFixture.ok());
    api.reply(listUsersFixture.ok({ items: [ada], total: 1 }));
    api.reply({ message: "Lead" }, 409);
    const { view } = renderNewMessage();
    fill("To", "nobody");
    expect(
      await view.findByText("No customer matches this search."),
    ).toBeInTheDocument();
    fill("To", "ada");
    fireEvent.click(await view.findByRole("button", { name: /Ada Customer/ }));
    fill("Write a message…", "Hello");
    press("Send");
    expect(await view.findByRole("alert")).toHaveTextContent(
      "This customer cannot get mail.",
    );
  });

  it("keeps the send button off until a customer is chosen, and closes", () => {
    const { view, onClose } = renderNewMessage();
    expect(view.getByLabelText("Write a message…")).toBeDisabled();
    press("Back to the list");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
