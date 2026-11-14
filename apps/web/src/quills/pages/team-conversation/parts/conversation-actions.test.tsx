import { fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { assignConversationFixture } from "../../../api/team/assign-conversation.fixture";
import { getConversationFixture } from "../../../api/team/get-conversation.fixture";
import { setConversationStatusFixture } from "../../../api/team/set-conversation-status.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ShortcutListener } from "../../../ui/upstream";
import { ConversationActions } from "./conversation-actions";

const team = (update = true) => ({
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "user_test_1" },
  permissions: {
    read: true,
    create: true,
    update,
    delete: true,
    manageSettings: true,
  },
});
const render = (element: ReactElement, update = true) =>
  renderComponent(
    <TeamRuntimeProvider value={team(update)}>
      <ShortcutListener />
      {element}
    </TeamRuntimeProvider>,
  );

describe("ConversationActions", () => {
  it("opens the composer by button and by R and N", () => {
    const onCompose = vi.fn();
    render(
      <ConversationActions
        workspaceId="workspace_test_1"
        conversation={getConversationFixture.ok()}
        myPrincipalId={null}
        onCompose={onCompose}
      />,
    );
    press("Reply");
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    expect(onCompose.mock.calls).toEqual([["reply"], ["note"], ["reply"]]);
  });

  it("closes, snoozes and assigns an open conversation to the caller", async () => {
    const api = mockApi();
    api.reply(setConversationStatusFixture.ok());
    api.reply(setConversationStatusFixture.ok());
    api.reply(assignConversationFixture.ok());
    const view = render(
      <ConversationActions
        workspaceId="workspace_test_1"
        conversation={getConversationFixture.ok({ id: "conversation_test_1" })}
        myPrincipalId="principal_test_1"
        onCompose={vi.fn()}
      />,
    );
    press("Close");
    await vi.waitFor(() =>
      expect(view.getByRole("button", { name: "Snooze" })).toBeEnabled(),
    );
    press("Snooze");
    await vi.waitFor(() =>
      expect(view.getByRole("button", { name: "Assign to me" })).toBeEnabled(),
    );
    press("Assign to me");
    await vi.waitFor(() =>
      expect(api.calls("assignQuillsConversation")).toHaveLength(1),
    );
    const statuses = await Promise.all(
      api.calls("setQuillsConversationStatus").map((call) => call.json()),
    );
    expect(statuses).toEqual([{ status: "closed" }, { status: "snoozed" }]);
    expect(await api.calls("assignQuillsConversation")[0]!.json()).toEqual({
      assigneePrincipalId: "me",
    });
  });

  it("reopens a closed conversation and unassigns the caller's own", async () => {
    const api = mockApi();
    api.reply(setConversationStatusFixture.ok());
    api.reply(assignConversationFixture.ok());
    const view = render(
      <ConversationActions
        workspaceId="workspace_test_1"
        conversation={getConversationFixture.ok({
          status: "closed",
          assignedAgentPrincipalId: "principal_test_1",
        })}
        myPrincipalId="principal_test_1"
        onCompose={vi.fn()}
      />,
    );
    expect(view.getByRole("button", { name: "Snooze" })).toBeDisabled();
    press("Reopen");
    await vi.waitFor(() =>
      expect(view.getByRole("button", { name: "Unassign" })).toBeEnabled(),
    );
    press("Unassign");
    await vi.waitFor(() =>
      expect(api.calls("assignQuillsConversation")).toHaveLength(1),
    );
    expect(await api.calls("setQuillsConversationStatus")[0]!.json()).toEqual({
      status: "open",
    });
    expect(await api.calls("assignQuillsConversation")[0]!.json()).toEqual({
      assigneePrincipalId: null,
    });
  });

  it("disables changes without the update permission", () => {
    const view = render(
      <ConversationActions
        workspaceId="workspace_test_1"
        conversation={getConversationFixture.ok()}
        myPrincipalId={null}
        onCompose={vi.fn()}
      />,
      false,
    );
    for (const name of ["Reply", "Close", "Assign to me"])
      expect(view.getByRole("button", { name })).toBeDisabled();
    expect(view.getByRole("button", { name: "Add note" })).toBeEnabled();
  });
});
