import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createTicketFixture } from "../../api/team/create-ticket.fixture";
import { getTicketFixture } from "../../api/team/get-ticket.fixture";
import { getTicketLinksFixture } from "../../api/team/get-ticket-links.fixture";
import { getTicketSummaryFixture } from "../../api/team/get-ticket-summary.fixture";
import { getTicketWatchStatusFixture } from "../../api/team/get-ticket-watch-status.fixture";
import { listPrincipalsFixture } from "../../api/team/list-principals.fixture";
import { listTicketActivityFixture } from "../../api/team/list-ticket-activity.fixture";
import { listTicketConversationsFixture } from "../../api/team/list-ticket-conversations.fixture";
import { listTicketExternalLinksFixture } from "../../api/team/list-ticket-external-links.fixture";
import { listTicketMessagesFixture } from "../../api/team/list-ticket-messages.fixture";
import { listTicketStatusesFixture } from "../../api/team/list-ticket-statuses.fixture";
import { listTicketWatchersFixture } from "../../api/team/list-ticket-watchers.fixture";
import { listTicketsFixture } from "../../api/team/list-tickets.fixture";
import { markTicketReadFixture } from "../../api/team/mark-ticket-read.fixture";
import { replyTicketFixture } from "../../api/team/reply-ticket.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamTicketsPage } from "./team-tickets-page";

const urgent = getTicketFixture.ok({
  id: "ticket_urgent",
  reference: "T-1",
  title: "Login fails",
  priority: "urgent",
  requester: {
    principalId: "principal_grace",
    displayName: "Grace",
    avatarUrl: null,
  },
});
const low = getTicketFixture.ok({
  id: "ticket_low",
  reference: "T-2",
  title: "Export is slow",
  priority: "low",
});
const tickets = listTicketsFixture.ok({ items: [low, urgent] });
const statuses = listTicketStatusesFixture.ok();
const messages = listTicketMessagesFixture.ok({
  items: [
    {
      id: "message_1",
      ticketId: "ticket_urgent",
      conversationId: null,
      senderType: "visitor",
      isInternal: false,
      author: { principalId: "principal_grace", displayName: "Grace" },
      content: "I cannot sign in.",
      systemEvent: null,
      createdAt: "2026-11-02T00:00:00.000Z",
    },
  ],
});
const open = { params: { ticketId: "ticket_urgent" } };
const query = (api: ReturnType<typeof mockApi>) =>
  new URL(api.calls("listQuillsTickets")[0]!.url).searchParams;

function inbox() {
  const api = mockApi();
  api.reply(tickets);
  api.reply(statuses);
  return api;
}

/** The replies in request order: the page, the mark-read, then the header, thread and panel. */
function detail() {
  const api = inbox();
  api.reply(urgent);
  api.reply(listPrincipalsFixture.ok());
  api.reply(markTicketReadFixture.ok());
  api.reply(getTicketWatchStatusFixture.ok());
  api.reply(messages);
  api.reply(listTicketActivityFixture.ok());
  api.reply(listTicketWatchersFixture.ok());
  api.reply(listTicketConversationsFixture.ok());
  api.reply(getTicketLinksFixture.ok({ tracker: null }));
  api.reply(listTicketExternalLinksFixture.ok());
  api.reply(getTicketSummaryFixture.ok());
  return api;
}

let done: ReturnType<typeof mockApi>;

async function reply(view: ReturnType<typeof renderPage>) {
  await view.findByText("I cannot sign in.");
  done.reply(replyTicketFixture.ok());
  // The reply refreshes these in turn.
  for (const body of [
    messages,
    tickets,
    urgent,
    listTicketActivityFixture.ok(),
    getTicketWatchStatusFixture.ok(),
    listTicketWatchersFixture.ok(),
  ])
    done.reply(body);
  fill("Reply to Grace…", "We reset your account.");
  press("Send");
  await waitFor(() => expect(view.getByRole("textbox")).toHaveValue(""));
  await waitFor(() =>
    expect(done.calls("listQuillsTicketWatchers")).toHaveLength(2),
  );
}

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
    done: {
      prepare: () => {
        done = detail();
        return open;
      },
      act: reply,
    },
  });

  describe("behavior", () => {
    it("groups the open tickets by priority beside an empty main pane", async () => {
      const api = inbox();
      const view = renderPage(TeamTicketsPage, meta);
      const row = await view.findByRole("link", { name: /Login fails/ });
      expect(row).toHaveAttribute(
        "href",
        "/feedback/workspace_test_1/tickets/ticket_urgent",
      );
      expect(query(api).get("statusCategory")).toBe("open");
      expect(query(api).get("sort")).toBe("priority");
      expect(
        view.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Urgent 1", "Low 1", "No ticket selected"]);
      expect(
        view.getByRole("heading", { level: 1, name: "Tickets" }),
      ).toBeInTheDocument();
    });

    it("lists My tickets with the search and opens one with its list in the address", async () => {
      const api = inbox();
      const view = renderPage(TeamTicketsPage, meta, {
        search: { view: "mine", q: "login" },
      });
      expect(
        await view.findByRole("heading", { level: 1, name: "My tickets" }),
      ).toBeInTheDocument();
      expect(query(api).get("assignee")).toBe("me");
      expect(query(api).get("search")).toBe("login");
      fireEvent.click(
        await view.findByRole("link", { name: /Export is slow/ }),
      );
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/tickets/ticket_low?view=mine&q=login",
        ),
      );
    });

    it("marks the open ticket read and shows it with its list and properties", async () => {
      const api = detail();
      const view = renderPage(TeamTicketsPage, meta, open);
      expect(
        await view.findByRole("heading", { level: 1, name: "Login fails" }),
      ).toBeInTheDocument();
      expect(await view.findByText("I cannot sign in.")).toBeInTheDocument();
      expect(new URL(api.calls("markQuillsTicketRead")[0]!.url).pathname).toBe(
        "/api/quills/workspace_test_1/tickets/ticket_urgent/read",
      );
      expect(view.getByRole("link", { name: /Login fails/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      expect(
        view.getByRole("heading", { level: 2, name: "Tickets" }),
      ).toBeInTheDocument();
      expect(await view.findByText("No links yet.")).toBeInTheDocument();
      expect(
        view.getByRole("combobox", { name: "Status" }),
      ).toBeInTheDocument();
      expect(
        view.getByRole("complementary", { name: "Properties" }),
      ).toBeInTheDocument();
    });

    it("goes to the next ticket and back to the same list", async () => {
      detail();
      const view = renderPage(TeamTicketsPage, meta, {
        ...open,
        search: { view: "mine", status: "all" },
      });
      await view.findByText("I cannot sign in.");
      press("Next");
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/tickets/ticket_low?view=mine&status=all",
        ),
      );
      press("Back to the list");
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/my-tickets?status=all",
        ),
      );
    });

    it("creates a ticket from the new ticket form and opens it", async () => {
      const api = inbox();
      const view = renderPage(TeamTicketsPage, meta, { search: { new: true } });
      expect(
        await view.findByRole("heading", { level: 1, name: "New ticket" }),
      ).toBeInTheDocument();
      api.reply(createTicketFixture.ok({ id: "ticket_new" }));
      api.reply(tickets);
      fill("Title", "Printer is on fire");
      press("Create ticket");
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/tickets/ticket_new",
        ),
      );
    });

    it("opens the new ticket form from the list pane", async () => {
      inbox();
      const view = renderPage(TeamTicketsPage, meta);
      await view.findByText("Login fails");
      press("New ticket");
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/tickets?new=true",
        ),
      );
    });
  });
});
