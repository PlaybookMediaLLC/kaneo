import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getTicketFixture } from "../../api/team/get-ticket.fixture";
import { listTicketStatusesFixture } from "../../api/team/list-ticket-statuses.fixture";
import { listTicketsFixture } from "../../api/team/list-tickets.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamTicketsPage } from "./team-tickets-page";

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
const tickets = listTicketsFixture.ok({
  items: [
    getTicketFixture.ok({
      id: "ticket_low",
      reference: "T-2",
      title: "Export is slow",
      priority: "low",
    }),
    getTicketFixture.ok({
      id: "ticket_urgent",
      reference: "T-1",
      title: "Login fails",
      priority: "urgent",
      requester: {
        principalId: "principal_grace",
        displayName: "Grace",
        avatarUrl: null,
      },
    }),
  ],
});
const statuses = listTicketStatusesFixture.ok({
  items: [status("status_new", "New"), status("status_doing", "Doing")],
});
const inbox = () => {
  const api = mockApi();
  api.reply(tickets);
  api.reply(statuses);
  return api;
};

describe("TeamTicketsPage", () => {
  describePageContract(meta, TeamTicketsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.fail();
      },
    },
    empty: {
      prepare: () => {
        const api = mockApi();
        api.reply(listTicketsFixture.ok());
        api.reply(statuses);
      },
    },
    ready: { prepare: () => void inbox() },
  });

  describe("behavior", () => {
    it("groups the open tickets by priority under the workspace status tabs", async () => {
      const api = inbox();
      const view = renderPage(TeamTicketsPage, meta);
      expect(await view.findByText("Login fails")).toBeInTheDocument();
      const query = new URL(api.calls("listQuillsTickets")[0]!.url)
        .searchParams;
      expect(query.get("statusCategory")).toBe("open");
      expect(query.get("sort")).toBe("priority");
      expect(
        view.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Urgent 1", "Low 1"]);
      const tabs = await view.findAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
        "Open",
        "New",
        "Doing",
        "All",
      ]);
      expect(view.getByRole("tab", { name: "Open" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(view.getByRole("link", { name: /Login fails/ })).toHaveAttribute(
        "href",
        "/feedback/workspace_test_1/tickets/ticket_urgent",
      );
    });

    it("lists one status and moves the tab into the address", async () => {
      const api = inbox();
      const view = renderPage(TeamTicketsPage, meta, {
        search: { status: "status_doing" },
      });
      await view.findByText("Login fails");
      const query = new URL(api.calls("listQuillsTickets")[0]!.url)
        .searchParams;
      expect(query.get("statusId")).toBe("status_doing");
      expect(query.get("statusCategory")).toBeNull();
      fireEvent.click(view.getByRole("tab", { name: "All" }));
      await waitFor(() =>
        expect(view.router.history.location.search).toBe("?status=all"),
      );
    });

    it("opens a ticket of My tickets with its list in the address", async () => {
      const api = inbox();
      const view = renderPage(TeamTicketsPage, meta, {
        search: { view: "mine" },
      });
      expect(
        await view.findByRole("heading", { level: 1, name: "My tickets" }),
      ).toBeInTheDocument();
      await view.findByText("Login fails");
      const query = new URL(api.calls("listQuillsTickets")[0]!.url)
        .searchParams;
      expect(query.get("assignee")).toBe("me");
      fireEvent.click(view.getByRole("link", { name: /Export is slow/ }));
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/tickets/ticket_low?view=mine",
        ),
      );
    });
  });
});
