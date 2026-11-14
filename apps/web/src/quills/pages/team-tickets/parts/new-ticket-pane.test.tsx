import { describe, expect, it, vi } from "vite-plus/test";
import { createTicketFixture } from "../../../api/team/create-ticket.fixture";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { NewTicketPane } from "./new-ticket-pane";

function render() {
  const onBack = vi.fn();
  const onCreated = vi.fn();
  const view = renderComponent(
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
      <NewTicketPane onBack={onBack} onCreated={onCreated} />
    </TeamRuntimeProvider>,
  );
  return { view, onBack, onCreated };
}

describe("NewTicketPane", () => {
  it("creates the ticket without empty details and opens it", async () => {
    const api = mockApi();
    const { view, onCreated } = render();
    expect(
      view.getByRole("heading", { level: 1, name: "New ticket" }),
    ).toBeInTheDocument();
    api.reply(createTicketFixture.ok({ id: "ticket_new" }));
    fill("Title", "Login fails");
    press("Create ticket");
    await vi.waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("ticket_new"),
    );
    const [request] = api.calls("createQuillsTicket");
    expect(new URL(request!.url).pathname).toBe(
      "/api/quills/workspace_test_1/tickets",
    );
    expect(await request!.clone().json()).toEqual({ title: "Login fails" });
  });

  it("keeps the draft when the ticket is not created", async () => {
    const api = mockApi();
    const { view, onCreated } = render();
    api.reply({ message: "No default ticket status is configured" }, 409);
    fill("Title", "Login fails");
    press("Create ticket");
    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(view.getByLabelText("Title")).toHaveValue("Login fails");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("goes back to the list", () => {
    const { onBack } = render();
    press("Back to the list");
    expect(onBack).toHaveBeenCalledOnce();
  });
});
