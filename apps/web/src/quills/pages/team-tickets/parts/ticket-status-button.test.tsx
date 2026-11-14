import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { setTicketStatusFixture } from "../../../api/team/set-ticket-status.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import type { TicketStatus } from "../ticket-scope";
import { TicketStatusButton } from "./ticket-status-button";

const status = (
  id: string,
  name: string,
  category: TicketStatus["category"],
): TicketStatus => ({
  id,
  name,
  slug: name.toLowerCase(),
  color: "gray",
  category,
  position: 0,
  isDefault: false,
  publicStage: null,
});
const statuses = [
  status("status_new", "New", "open"),
  status("status_wait", "Waiting", "pending"),
  status("status_done", "Resolved", "closed"),
];
const inStatus = (value: TicketStatus) =>
  getTicketFixture.ok({
    id: "ticket_test_1",
    status: {
      id: value.id,
      name: value.name,
      color: value.color,
      category: value.category,
    },
  });

function render(ticket = inStatus(statuses[1]!), list = statuses) {
  return renderComponent(
    <TeamRuntimeProvider
      value={{
        workspaceId: "workspace_test_1",
        viewer: { kind: "user", id: "user_test_1" },
        permissions: {
          read: true,
          create: true,
          update: true,
          delete: false,
          manageSettings: false,
        },
      }}
    >
      <TicketStatusButton ticket={ticket} statuses={list} />
    </TeamRuntimeProvider>,
  );
}

const sent = async (api: ReturnType<typeof mockApi>) => {
  await waitFor(() =>
    expect(api.calls("setQuillsTicketStatus")).toHaveLength(1),
  );
  return api.calls("setQuillsTicketStatus")[0]!.clone().json();
};

describe("TicketStatusButton", () => {
  it("resolves an open ticket with the first closed status", async () => {
    const api = mockApi();
    render();
    api.reply(setTicketStatusFixture.ok());
    press("Resolve");
    expect(await sent(api)).toEqual({ statusId: "status_done" });
  });

  it("reopens a closed ticket from its green status pill", async () => {
    const api = mockApi();
    const view = render(inStatus(statuses[2]!));
    expect(
      view.getByRole("button", { name: "Resolved: reopen" }),
    ).toHaveTextContent("Resolved");
    api.reply(setTicketStatusFixture.ok());
    press("Resolved: reopen");
    expect(await sent(api)).toEqual({ statusId: "status_new" });
  });

  it("is absent when the workspace has no closed status", () => {
    const view = render(inStatus(statuses[0]!), statuses.slice(0, 2));
    expect(view.queryByRole("button")).toBeNull();
  });
});
