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
  author: { principalId: "principal_grace", displayName: "Grace" },
  content: "The login fails.",
  systemEvent: null,
  createdAt: "2026-11-02T00:00:00.000Z",
  ...values,
});

describe("TicketTimeline", () => {
  it("shows the messages, the notes and the changes in order", () => {
    const view = renderComponent(
      <TicketTimeline
        entries={timeline(
          [
            message("m1"),
            message("m2", {
              senderType: "agent",
              isInternal: true,
              author: null,
              content: "Check the logs.",
              createdAt: "2026-11-03T00:00:00.000Z",
            }),
          ],
          [
            {
              id: "a1",
              type: "ticket.created",
              principalId: null,
              actorName: "Grace",
              metadata: {},
              createdAt: "2026-11-01T00:00:00.000Z",
            },
          ],
        )}
      />,
    );
    const items = view.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Grace created the ticket"),
      expect.stringContaining("The login fails."),
      expect.stringContaining("Check the logs."),
    ]);
    expect(items[1]).toHaveTextContent("Grace");
    expect(items[2]).toHaveTextContent("Teammate");
    expect(items[2]).toHaveTextContent("Internal note");
  });

  it("says when the thread is empty", () => {
    const view = renderComponent(<TicketTimeline entries={[]} />);
    expect(view.getByText("No messages yet.")).toBeInTheDocument();
  });
});
