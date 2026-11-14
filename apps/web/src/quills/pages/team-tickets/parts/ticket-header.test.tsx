import { describe, expect, it, vi } from "vite-plus/test";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { getTicketWatchStatusFixture } from "../../../api/team/get-ticket-watch-status.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketHeader, type TicketHeaderProps } from "./ticket-header";

function render(props: Partial<TicketHeaderProps> = {}) {
  const handlers = { onBack: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn() };
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
      <TicketHeader statuses={[]} people={[]} {...handlers} {...props} />
    </TeamRuntimeProvider>,
  );
  return { view, handlers };
}

describe("TicketHeader", () => {
  it("keeps the heading while the ticket loads", () => {
    const { view } = render();
    expect(
      view.getByRole("heading", { level: 1, name: "Ticket" }),
    ).toBeInTheDocument();
    expect(view.queryByRole("button", { name: /^Assignee/ })).toBeNull();
  });

  it("shows the title, the reference and requester, the actions and the arrows", () => {
    const api = mockApi();
    api.reply(getTicketWatchStatusFixture.ok());
    const { view, handlers } = render({
      ticket: getTicketFixture.ok({
        title: "Login fails",
        reference: "T-1",
        requester: {
          principalId: "principal_grace",
          displayName: "Grace",
          avatarUrl: null,
        },
      }),
    });
    expect(
      view.getByRole("heading", { level: 1, name: "Login fails" }),
    ).toBeInTheDocument();
    expect(view.getByText("T-1 · Grace")).toBeInTheDocument();
    for (const name of ["Assignee: Unassigned", "More ticket actions"])
      expect(view.getByRole("button", { name })).toBeInTheDocument();
    press("Next");
    press("Previous");
    press("Back to the list");
    expect(handlers.onNext).toHaveBeenCalledOnce();
    expect(handlers.onPrevious).toHaveBeenCalledOnce();
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });
});
