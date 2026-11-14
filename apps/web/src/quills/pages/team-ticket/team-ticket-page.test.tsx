import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
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
import { TeamTicketPage } from "./team-ticket-page";

const ticket = getTicketFixture.ok({
  id: "ticket_test_1",
  reference: "T-1",
  title: "Login fails",
  priority: "urgent",
});
const other = getTicketFixture.ok({
  id: "ticket_test_2",
  reference: "T-2",
  title: "Export is slow",
  priority: "low",
});
const messages = listTicketMessagesFixture.ok({
  items: [
    {
      id: "message_1",
      ticketId: "ticket_test_1",
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
const page = { params: { ticketId: "ticket_test_1" } };

/** The replies in request order: the page, then the header, the thread and the panel. */
function detail() {
  const api = mockApi();
  api.reply(ticket);
  api.reply(listTicketsFixture.ok({ items: [ticket, other] }));
  api.reply(markTicketReadFixture.ok());
  api.reply(listTicketStatusesFixture.ok());
  api.reply(listPrincipalsFixture.ok());
  api.reply(messages);
  api.reply(listTicketActivityFixture.ok());
  api.reply(getTicketWatchStatusFixture.ok());
  api.reply(listTicketWatchersFixture.ok());
  api.reply(listTicketConversationsFixture.ok());
  api.reply(getTicketLinksFixture.ok({ tracker: null }));
  api.reply(listTicketExternalLinksFixture.ok());
  api.reply(getTicketSummaryFixture.ok());
  return api;
}

const reply = async (
  view: ReturnType<typeof renderPage>,
  api: ReturnType<typeof mockApi>,
) => {
  await view.findByText("I cannot sign in.");
  for (const body of [
    replyTicketFixture.ok(),
    messages,
    listTicketsFixture.ok({ items: [ticket, other] }),
    ticket,
    listTicketActivityFixture.ok(),
    getTicketWatchStatusFixture.ok(),
    listTicketWatchersFixture.ok(),
  ])
    api.reply(body);
  press(/^Reply/);
  fill("Reply to the requester", "We reset your account.");
  press("Send reply");
  await waitFor(() =>
    expect(view.queryByLabelText("Reply to the requester")).toBeNull(),
  );
};

let done: ReturnType<typeof mockApi>;

describe("TeamTicketPage", () => {
  describePageContract(meta, TeamTicketPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let i = 0; i < 3; i++) api.defer(() => undefined);
        return page;
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        for (let i = 0; i < 3; i++) api.fail();
        return page;
      },
    },
    ready: { prepare: () => (detail(), page) },
    done: {
      prepare: () => {
        done = detail();
        return page;
      },
      act: async (view) => reply(view, done),
    },
  });

  describe("behavior", () => {
    it("marks the ticket read and shows it with its list and properties", async () => {
      const api = detail();
      const view = renderPage(TeamTicketPage, meta, page);
      expect(
        await view.findByRole("heading", { level: 1, name: "Login fails" }),
      ).toBeInTheDocument();
      expect(await view.findByText("I cannot sign in.")).toBeInTheDocument();
      const [read] = api.calls("markQuillsTicketRead");
      expect(new URL(read!.url).pathname).toBe(
        "/api/quills/workspace_test_1/tickets/ticket_test_1/read",
      );
      expect(view.getByRole("link", { name: /Login fails/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      expect(await view.findByText("No links yet.")).toBeInTheDocument();
      expect(
        view.getByRole("combobox", { name: "Status" }),
      ).toBeInTheDocument();
    });

    it("sends a reply and refreshes the thread", async () => {
      const api = detail();
      const view = renderPage(TeamTicketPage, meta, page);
      await reply(view, api);
      expect(await api.calls("replyQuillsTicket")[0]!.clone().json()).toEqual({
        content: "We reset your account.",
      });
      expect(api.calls("listQuillsTicketMessages")).toHaveLength(2);
    });

    it("goes to the next ticket and back to the same list", async () => {
      detail();
      const view = renderPage(TeamTicketPage, meta, {
        ...page,
        search: { view: "mine", status: "all" },
      });
      await view.findByText("I cannot sign in.");
      fireEvent.click(view.getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/tickets/ticket_test_2?view=mine&status=all",
        ),
      );
      fireEvent.click(view.getByRole("button", { name: "Back to the list" }));
      await waitFor(() =>
        expect(view.router.history.location.href).toBe(
          "/feedback/workspace_test_1/my-tickets?status=all",
        ),
      );
    });
  });
});
