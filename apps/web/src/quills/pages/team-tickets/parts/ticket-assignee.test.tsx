import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { assignTicketFixture } from "../../../api/team/assign-ticket.fixture";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketAssignee } from "./ticket-assignee";

const person = (id: string, userId: string, name: string) => ({
  id,
  userId,
  name,
  avatarUrl: null,
  role: "member",
  createdAt: "2026-11-01T00:00:00.000Z",
});
const people = [
  person("principal_me", "user_test_1", "Me"),
  person("principal_ada", "user_ada", "Ada"),
];
const assigned = (principalId: string | null, displayName: string | null) =>
  getTicketFixture.ok({
    id: "ticket_test_1",
    assignee: { principalId, displayName, teamId: null, teamName: null },
  });

function render(ticket = assigned(null, null), update = true) {
  return renderComponent(
    <TeamRuntimeProvider
      value={{
        workspaceId: "workspace_test_1",
        viewer: { kind: "user", id: "user_test_1" },
        permissions: {
          read: true,
          create: true,
          update,
          delete: false,
          manageSettings: false,
        },
      }}
    >
      <TicketAssignee ticket={ticket} people={people} />
    </TeamRuntimeProvider>,
  );
}

describe("TicketAssignee", () => {
  it("shows Assign without an assignee and assigns a teammate", async () => {
    const api = mockApi();
    const view = render();
    expect(
      view.getByRole("button", { name: "Assignee: Unassigned" }),
    ).toHaveTextContent("Assign");
    api.reply(assignTicketFixture.ok());
    press("Assignee: Unassigned");
    fireEvent.click(await view.findByRole("menuitemradio", { name: "Ada" }));
    await waitFor(() =>
      expect(api.calls("assignQuillsTicket")).toHaveLength(1),
    );
    expect(await api.calls("assignQuillsTicket")[0]!.clone().json()).toEqual({
      assigneePrincipalId: "principal_ada",
    });
  });

  it("shows You for the caller and unassigns", async () => {
    const api = mockApi();
    const view = render(assigned("principal_me", "Me"));
    api.reply(assignTicketFixture.ok());
    press("Assignee: You");
    fireEvent.click(
      await view.findByRole("menuitemradio", { name: "Unassigned" }),
    );
    await waitFor(() =>
      expect(api.calls("assignQuillsTicket")).toHaveLength(1),
    );
    expect(await api.calls("assignQuillsTicket")[0]!.clone().json()).toEqual({
      assigneePrincipalId: null,
    });
  });

  it("keeps a former teammate as the current choice", async () => {
    const view = render(assigned("principal_old", "Former teammate"));
    press("Assignee: Former teammate");
    expect(
      await view.findByRole("menuitemradio", { name: "Former teammate" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("shows a failed change and is locked without update permission", async () => {
    const api = mockApi();
    const view = render();
    api.reply({ message: "Conflict" }, 409);
    press("Assignee: Unassigned");
    fireEvent.click(await view.findByRole("menuitemradio", { name: "Ada" }));
    expect(await view.findByRole("alert")).toHaveTextContent(
      "The change was not saved.",
    );
    view.unmount();
    expect(
      render(assigned(null, null), false).getByRole("button", {
        name: "Assignee: Unassigned",
      }),
    ).toBeDisabled();
  });
});
