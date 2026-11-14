import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { listTicketsFixture } from "../../../api/team/list-tickets.fixture";
import { useListTickets } from "../../../hooks/team/use-list-tickets";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import {
  priorityGroups,
  ticketQuery,
  type TicketScope,
  type TicketStatus,
} from "../ticket-scope";
import { TicketListPane, type TicketListPaneProps } from "./ticket-list-pane";

const status = (id: string, name: string): TicketStatus => ({
  id,
  name,
  slug: name.toLowerCase(),
  color: "gray",
  category: "open",
  position: 0,
  isDefault: false,
  publicStage: null,
});
const scope: TicketScope = { mine: false, status: "open", q: "" };
const viewer = { kind: "user", id: "user_test_1" } as const;

// The page owns the list query; this harness does the same for the pane alone.
function Harness(props: Partial<TicketListPaneProps>) {
  const list = useListTickets(
    { param: { workspaceId: "workspace_test_1" }, query: ticketQuery(scope) },
    viewer,
  );
  return (
    <TicketListPane
      scope={scope}
      headingLevel={1}
      statuses={[status("status_doing", "Doing")]}
      groups={priorityGroups(
        list.data?.pages.flatMap((page) => page.items) ?? [],
        (key) => key.split(".").at(-1)!,
      )}
      list={list}
      activeId={null}
      onOpen={vi.fn()}
      {...props}
    />
  );
}

function render(props: Partial<TicketListPaneProps> = {}) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = renderComponent(
    <RouterContextProvider router={router}>
      <TeamRuntimeProvider
        value={{
          workspaceId: "workspace_test_1",
          viewer,
          permissions: {
            read: true,
            create: true,
            update: true,
            delete: false,
            manageSettings: false,
          },
        }}
      >
        <Harness {...props} />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
  return { view, router };
}

describe("TicketListPane", () => {
  it("shows the rows and opens one", async () => {
    const api = mockApi();
    api.reply(
      listTicketsFixture.ok({
        items: [getTicketFixture.ok({ id: "ticket_1", title: "Login fails" })],
        hasMore: true,
        nextCursor: "cursor_1",
      }),
    );
    const onOpen = vi.fn();
    const { view } = render({ onOpen, activeId: "ticket_1" });
    const row = await view.findByRole("link", { name: /Login fails/ });
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/tickets/ticket_1",
    );
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith("ticket_1");
    expect(
      view.getByRole("button", { name: "Load more tickets" }),
    ).toBeInTheDocument();
  });

  it("filters by status and searches through the address", async () => {
    const api = mockApi();
    api.reply(listTicketsFixture.ok());
    const { view, router } = render();
    expect(await view.findByRole("status")).toHaveTextContent(/nothing/i);
    press("Filters");
    fireEvent.click(await view.findByRole("menuitemradio", { name: "Doing" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ status: "status_doing" }),
    );
    fill("Search tickets…", "login");
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        status: "status_doing",
        q: "login",
      }),
    );
  });

  it("offers New ticket only with the create permission", async () => {
    const api = mockApi();
    api.reply(listTicketsFixture.ok());
    const onNew = vi.fn();
    const { view } = render({ onNew });
    press("New ticket");
    expect(onNew).toHaveBeenCalledOnce();
    view.unmount();
    api.reply(listTicketsFixture.ok());
    expect(
      render().view.queryByRole("button", { name: "New ticket" }),
    ).toBeNull();
  });
});
