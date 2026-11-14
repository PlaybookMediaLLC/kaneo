import { describe, expect, it } from "vite-plus/test";
import { activityText, timeline, type TicketActivity } from "./timeline";

const t = (key: string, values?: Record<string, string>) =>
  `${key.split(".").at(-1)}${values ? ` ${JSON.stringify(values)}` : ""}`;
const change = (
  type: string,
  metadata: TicketActivity["metadata"] = {},
  actorName: string | null = "Ada",
): TicketActivity => ({
  id: type,
  type,
  principalId: null,
  actorName,
  metadata,
  createdAt: "2026-11-02T00:00:00.000Z",
});

describe("timeline", () => {
  it("puts messages and changes in one list, oldest first", () => {
    const entries = timeline(
      [
        {
          id: "m1",
          ticketId: "t1",
          conversationId: null,
          senderType: "visitor",
          isInternal: false,
          author: null,
          content: "Help",
          systemEvent: null,
          createdAt: "2026-11-03T00:00:00.000Z",
        },
      ],
      [change("ticket.created")],
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      "activity:ticket.created",
      "message:m1",
    ]);
  });

  it("describes each kind of change", () => {
    expect(activityText(change("ticket.created"), t)).toBe(
      'created {"actor":"Ada"}',
    );
    expect(
      activityText(
        change("status.changed", { fromName: "New", toName: "Done" }),
        t,
      ),
    ).toBe('status {"actor":"Ada","from":"New","to":"Done"}');
    expect(
      activityText(
        change("priority.changed", { from: "low", to: "urgent" }),
        t,
      ),
    ).toBe('priority {"actor":"Ada","from":"low","to":"urgent"}');
    expect(
      activityText(
        change("ticket.assigned", {
          toPrincipalId: "p1",
          toPrincipalName: "Grace",
        }),
        t,
      ),
    ).toBe('assigned {"actor":"Ada","name":"Grace"}');
    expect(
      activityText(
        change("ticket.assigned", { toTeamId: "team1", toTeamName: "Billing" }),
        t,
      ),
    ).toBe('assigned {"actor":"Ada","name":"Billing"}');
    expect(
      activityText(change("ticket.assigned", { toPrincipalId: null }), t),
    ).toBe('unassigned {"actor":"Ada"}');
    expect(activityText(change("ticket.merged", {}, null), t)).toBe(
      'updated {"actor":"someone"}',
    );
  });
});
