import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { assignTicketFixture } from "../../../api/team/assign-ticket.fixture";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { listPrincipalsFixture } from "../../../api/team/list-principals.fixture";
import { listTicketStatusesFixture } from "../../../api/team/list-ticket-statuses.fixture";
import { setTicketStatusFixture } from "../../../api/team/set-ticket-status.fixture";
import { choose } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import {
  TeamRuntimeProvider,
  type TeamPermissions,
} from "../../../team/runtime";
import { TicketPickers } from "./ticket-pickers";

const status = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  color: "gray",
  category: "open" as const,
  position: 0,
  isDefault: false,
  publicStage: null,
});
const ticket = getTicketFixture.ok({
  id: "ticket_test_1",
  status: { id: "status_new", name: "New", color: "gray", category: "open" },
  assignee: {
    principalId: "principal_old",
    displayName: "Former teammate",
    teamId: null,
    teamName: null,
  },
});
const all = {
  read: true,
  create: true,
  update: true,
  delete: true,
  manageSettings: true,
};

function render(permissions: TeamPermissions = all) {
  const api = mockApi();
  api.reply(
    listTicketStatusesFixture.ok({
      items: [status("status_new", "New"), status("status_doing", "Doing")],
    }),
  );
  api.reply(
    listPrincipalsFixture.ok({
      items: [
        {
          id: "principal_ada",
          userId: "user_ada",
          name: "Ada",
          avatarUrl: null,
          role: "member",
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    }),
  );
  const view = renderComponent(
    <TeamRuntimeProvider
      value={{
        workspaceId: "workspace_test_1",
        viewer: { kind: "user", id: "user_test_1" },
        permissions,
      }}
    >
      <TicketPickers ticket={ticket} />
    </TeamRuntimeProvider>,
  );
  return { api, view };
}

describe("TicketPickers", () => {
  it("moves the ticket to another workspace status", async () => {
    const { api, view } = render();
    api.reply(setTicketStatusFixture.ok());
    expect(
      await view.findByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Former teammate");
    await choose("Status", "Doing");
    await waitFor(() =>
      expect(api.calls("setQuillsTicketStatus")).toHaveLength(1),
    );
    const [request] = api.calls("setQuillsTicketStatus");
    expect(new URL(request!.url).pathname).toBe(
      "/api/quills/workspace_test_1/tickets/ticket_test_1/status",
    );
    expect(await request!.clone().json()).toEqual({ statusId: "status_doing" });
  });

  it("assigns a teammate and unassigns", async () => {
    const { api, view } = render();
    api.reply(assignTicketFixture.ok());
    api.reply(assignTicketFixture.ok());
    await view.findByText("Former teammate");
    await choose("Assignee", "Ada");
    await waitFor(() =>
      expect(api.calls("assignQuillsTicket")).toHaveLength(1),
    );
    const [first] = api.calls("assignQuillsTicket");
    expect(await first!.clone().json()).toEqual({
      assigneePrincipalId: "principal_ada",
    });
    await choose("Assignee", "Unassigned");
    await waitFor(() =>
      expect(api.calls("assignQuillsTicket")).toHaveLength(2),
    );
    const [, second] = api.calls("assignQuillsTicket");
    expect(await second!.clone().json()).toEqual({ assigneePrincipalId: null });
  });

  it("shows a failed change", async () => {
    const { api, view } = render();
    api.reply({ message: "Conflict" }, 409);
    await view.findByText("Former teammate");
    await choose("Status", "Doing");
    expect(await view.findByRole("alert")).toHaveTextContent(
      "The change was not saved.",
    );
  });

  it("is read only without update permission", async () => {
    const { view } = render({ ...all, update: false });
    expect(
      await view.findByRole("combobox", { name: "Status" }),
    ).toHaveAttribute("data-disabled");
    expect(view.getByRole("combobox", { name: "Assignee" })).toHaveAttribute(
      "data-disabled",
    );
  });
});
