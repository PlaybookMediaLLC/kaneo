import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { timeline, type TicketMessage } from "../timeline";
import { TicketTimeline } from "./ticket-timeline";

const message = (
  id: string,
  values: Partial<TicketMessage> = {},
): TicketMessage => ({
  id,
  ticketId: "ticket_test_1",
  conversationId: null,
  senderType: "visitor",
  isInternal: false,
  author: null,
  content: "The login fails.",
  systemEvent: null,
  createdAt: "2026-11-02T10:00:00.000Z",
  ...values,
});
const requester = { name: "Grace", avatarUrl: null };

describe("TicketTimeline", () => {
  it("shows the changes, the customer message, the reply and the note in order", () => {
    const view = renderComponent(
      <TicketTimeline
        requester={requester}
        entries={timeline(
          [
            message("m1"),
            message("m2", {
              senderType: "agent",
              author: { principalId: "principal_ada", displayName: "Ada" },
              content: "We reset it.",
              createdAt: "2026-11-02T11:00:00.000Z",
            }),
            message("m3", {
              senderType: "agent",
              isInternal: true,
              content: "Check the logs.",
              createdAt: "2026-11-03T10:00:00.000Z",
            }),
          ],
          [
            {
              id: "a1",
              type: "ticket.created",
              principalId: null,
              actorName: "Grace",
              metadata: {},
              createdAt: "2026-11-02T09:00:00.000Z",
            },
          ],
        )}
      />,
    );
    const items = view.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Grace created the ticket"),
      expect.stringContaining("The login fails."),
      expect.stringContaining("We reset it."),
      expect.stringContaining("Check the logs."),
    ]);
    // A day separator starts the first entry of each day only.
    expect(items.map((item) => item.querySelectorAll("time").length)).toEqual([
      2, 1, 1, 2,
    ]);
    expect(items[1]).toHaveTextContent("Grace");
    expect(items[2]).toHaveTextContent("Ada");
    expect(items[3]).toHaveTextContent("Note");
    expect(items[3]).toHaveTextContent("Teammate");
  });

  it("shows a system message as a centered line", () => {
    const view = renderComponent(
      <TicketTimeline
        requester={requester}
        entries={timeline(
          [message("m1", { senderType: "system", content: "Linked T-2" })],
          [],
        )}
      />,
    );
    expect(view.getByText("Linked T-2")).toBeInTheDocument();
    expect(view.queryByText("Grace")).toBeNull();
  });

  it("says when the thread is empty", () => {
    const view = renderComponent(
      <TicketTimeline requester={requester} entries={[]} />,
    );
    expect(view.getByText("No messages yet.")).toBeInTheDocument();
  });
});
