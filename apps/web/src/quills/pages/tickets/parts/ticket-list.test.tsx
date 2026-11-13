import { describe, expect, it } from "vite-plus/test";
import { getMyTicketsFixture } from "../../../api/support/get-my-tickets.fixture";
import { renderComponent } from "../../../test/render";
import { TicketList } from "./ticket-list";

describe("TicketList", () => {
  it("links a ticket to its existing conversation detail", () => {
    const tickets = getMyTicketsFixture.ok({
      items: [
        {
          id: "ticket_test_1",
          number: 1,
          reference: "SUP-1",
          title: "Cannot sign in",
          stage: "received",
          stageLabel: "Received",
          ticketType: null,
          conversationId: "conversation_test_1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: null,
          resolvedAt: null,
        },
      ],
    }).items;
    const view = renderComponent(
      <TicketList workspaceId="workspace_test_1" tickets={tickets} />,
    );
    expect(
      view.getByRole("link", {
        name: "Open ticket conversation: Cannot sign in",
      }),
    ).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/conversations/conversation_test_1",
    );
  });
});
