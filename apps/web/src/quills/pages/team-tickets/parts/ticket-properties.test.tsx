import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { getTicketLinksFixture } from "../../../api/team/get-ticket-links.fixture";
import { getTicketSummaryFixture } from "../../../api/team/get-ticket-summary.fixture";
import { getTicketWatchStatusFixture } from "../../../api/team/get-ticket-watch-status.fixture";
import { listTicketConversationsFixture } from "../../../api/team/list-ticket-conversations.fixture";
import { listTicketExternalLinksFixture } from "../../../api/team/list-ticket-external-links.fixture";
import { listTicketWatchersFixture } from "../../../api/team/list-ticket-watchers.fixture";
import { setTicketPriorityFixture } from "../../../api/team/set-ticket-priority.fixture";
import { setTicketStatusFixture } from "../../../api/team/set-ticket-status.fixture";
import { choose } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketProperties } from "./ticket-properties";

const ticket = getTicketFixture.ok({
  id: "ticket_test_1",
  priority: "low",
  status: { id: "status_new", name: "New", color: "gray", category: "open" },
  requester: {
    principalId: "principal_grace",
    displayName: "Grace",
    avatarUrl: null,
  },
  company: { id: "company_1", name: "Acme" },
  assignee: {
    principalId: null,
    displayName: null,
    teamId: "team_1",
    teamName: "Billing",
  },
});

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

function render(update = true) {
  const api = mockApi();
  api.reply(getTicketWatchStatusFixture.ok());
  api.reply(listTicketWatchersFixture.ok());
  api.reply(listTicketConversationsFixture.ok());
  api.reply(getTicketLinksFixture.ok({ tracker: null }));
  api.reply(listTicketExternalLinksFixture.ok());
  api.reply(getTicketSummaryFixture.ok());
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = renderComponent(
    <RouterContextProvider router={router}>
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
        <TicketProperties
          ticket={ticket}
          statuses={[
            status("status_new", "New"),
            status("status_doing", "Doing"),
          ]}
        />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
  return { api, view };
}

describe("TicketProperties", () => {
  it("shows the requester and the properties and changes the priority", async () => {
    const { api, view } = render();
    expect(await view.findByText("No links yet.")).toBeInTheDocument();
    for (const text of ["Grace", "Acme", "No type"])
      expect(view.getByText(text)).toBeInTheDocument();
    expect(view.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "New",
    );
    api.reply(setTicketPriorityFixture.ok());
    await choose("Priority", "Urgent");
    await waitFor(() =>
      expect(api.calls("setQuillsTicketPriority")).toHaveLength(1),
    );
    expect(
      await api.calls("setQuillsTicketPriority")[0]!.clone().json(),
    ).toEqual({ priority: "urgent" });
  });

  it("moves the ticket to another workspace status", async () => {
    const { api, view } = render();
    await view.findByText("No links yet.");
    api.reply(setTicketStatusFixture.ok());
    await choose("Status", "Doing");
    await waitFor(() =>
      expect(api.calls("setQuillsTicketStatus")).toHaveLength(1),
    );
    expect(await api.calls("setQuillsTicketStatus")[0]!.clone().json()).toEqual(
      { statusId: "status_doing" },
    );
  });

  it("keeps the status and priority read only without update permission", async () => {
    const { view } = render(false);
    await view.findByText("No links yet.");
    for (const name of ["Status", "Priority"])
      expect(view.getByRole("combobox", { name })).toHaveAttribute(
        "data-disabled",
      );
  });
});
