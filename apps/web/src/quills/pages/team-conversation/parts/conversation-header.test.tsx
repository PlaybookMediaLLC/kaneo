import { fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import { assignConversationFixture } from "../../../api/team/assign-conversation.fixture";
import { blockUserFixture } from "../../../api/team/block-user.fixture";
import { endConversationFixture } from "../../../api/team/end-conversation.fixture";
import { getConversationFixture } from "../../../api/team/get-conversation.fixture";
import { getUserFixture } from "../../../api/team/get-user.fixture";
import { restoreConversationFromSpamFixture } from "../../../api/team/restore-conversation-from-spam.fixture";
import { setConversationStatusFixture } from "../../../api/team/set-conversation-status.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
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
  visitorPrincipalId: "principal_test_9",
});
const moves = { onBack: () => {}, onPrevious: () => {}, onNext: () => {} };
const render = (element: ReactElement) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>{element}</TeamRuntimeProvider>,
  );
const header = (value = conversation) => (
  <ConversationHeader
    workspaceId="workspace_test_1"
    conversation={value}
    people={people}
    myPrincipalId="principal_test_1"
    {...moves}
  />
);

/** Answers each request by its operation, so the order of the requests does not matter. */
function answer(answers: Record<string, { body: unknown; status?: number }>) {
  const api = mockApi();
  for (const _answer of Object.keys(answers))
    api.defer(({ resolve }) => {
      const request = api.calls().at(-1)!;
      const id = Object.keys(answers).find((operation) =>
        api.calls(operation).includes(request),
      );
      const reply = id ? answers[id]! : { body: {}, status: 500 };
      resolve(reply.body, reply.status ?? 200);
    });
  return api;
}
const user = (values = {}) => ({ body: getUserFixture.ok(values) });

describe("ConversationHeader", () => {
  it("keeps a heading while the conversation loads", () => {
    const api = mockApi();
    const view = render(
      <ConversationHeader
        workspaceId="workspace_test_1"
        people={[]}
        myPrincipalId={null}
        {...moves}
      />,
    );
    expect(view.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Conversation",
    );
    expect(view.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(api.calls()).toHaveLength(0);
  });

  it("shows the customer and the subject, resolves and assigns", async () => {
    const api = answer({
      getQuillsUser: user(),
      setQuillsConversationStatus: {
        body: setConversationStatusFixture.ok({ status: "closed" }),
      },
      assignQuillsConversation: { body: assignConversationFixture.ok() },
    });
    const view = render(header());
    expect(view.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Grace Customer",
    );
    expect(view.getByText("Export fails")).toBeInTheDocument();
    press("Resolve");
    await waitFor(() =>
      expect(api.calls("setQuillsConversationStatus")).toHaveLength(1),
    );
    expect(await api.calls("setQuillsConversationStatus")[0]!.json()).toEqual({
      status: "closed",
    });
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Assignee: Assign" }),
      ).toBeEnabled(),
    );
    press("Assignee: Assign");
    fireEvent.click(
      await view.findByRole("menuitemradio", { name: /Ada Teammate/ }),
    );
    await waitFor(() =>
      expect(api.calls("assignQuillsConversation")).toHaveLength(1),
    );
    expect(await api.calls("assignQuillsConversation")[0]!.json()).toEqual({
      assigneePrincipalId: "principal_test_2",
    });
  });

  it("reopens a spam conversation through the spam restore", async () => {
    const api = answer({
      getQuillsUser: user(),
      restoreQuillsConversationFromSpam: {
        body: restoreConversationFromSpamFixture.ok(),
      },
    });
    render(header({ ...conversation, status: "closed", endReason: "spam" }));
    press("Resolved, reopen");
    await waitFor(() =>
      expect(api.calls("restoreQuillsConversationFromSpam")).toHaveLength(1),
    );
    expect(api.calls("setQuillsConversationStatus")).toHaveLength(0);
  });

  it("marks spam and blocks the sender from the menu", async () => {
    const api = answer({
      getQuillsUser: user(),
      endQuillsConversation: { body: endConversationFixture.ok() },
      blockQuillsUser: { body: blockUserFixture.ok() },
    });
    const view = render(header());
    press("More actions");
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Mark as spam" }),
    );
    await waitFor(() =>
      expect(api.calls("endQuillsConversation")).toHaveLength(1),
    );
    expect(await api.calls("endQuillsConversation")[0]!.json()).toEqual({
      reason: "spam",
    });
    await waitFor(() =>
      expect(view.getByRole("button", { name: "More actions" })).toBeEnabled(),
    );
    press("More actions");
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Block sender" }),
    );
    await waitFor(() => expect(api.calls("blockQuillsUser")).toHaveLength(1));
    const [block] = api.calls("blockQuillsUser");
    expect(block!.method).toBe("PUT");
    expect(new URL(block!.url).pathname).toBe(
      "/api/quills/workspace_test_1/users/principal_test_9/block",
    );
  });

  it("explains a refused close", async () => {
    answer({
      getQuillsUser: user(),
      setQuillsConversationStatus: {
        body: { message: "Missing required attributes" },
        status: 409,
      },
    });
    const view = render(header());
    press("Resolve");
    expect(await view.findByRole("alert")).toHaveTextContent(
      /required fields/i,
    );
  });
});
