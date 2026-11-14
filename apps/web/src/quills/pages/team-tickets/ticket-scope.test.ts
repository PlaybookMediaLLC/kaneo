import { describe, expect, it } from "vite-plus/test";
import { listTicketsFixture } from "../../api/team/list-tickets.fixture";
import { getTicketFixture } from "../../api/team/get-ticket.fixture";
import {
  priorityGroups,
  ticketHref,
  ticketListHref,
  ticketQuery,
  ticketRow,
  ticketScope,
} from "./ticket-scope";

const ticket = (id: string, priority: "urgent" | "low") =>
  getTicketFixture.ok({ id, priority });

describe("ticket scope", () => {
  it("opens the open tab of all tickets by default", () => {
    const scope = ticketScope({});
    expect(scope).toEqual({ mine: false, status: "open" });
    expect(ticketQuery(scope)).toEqual({
      sort: "priority",
      limit: "50",
      statusCategory: "open",
    });
  });

  it("asks for the caller's tickets in one status", () => {
    const scope = ticketScope({ view: "mine", status: "ticket_status_1" });
    expect(ticketQuery(scope)).toEqual({
      sort: "priority",
      limit: "50",
      assignee: "me",
      statusId: "ticket_status_1",
    });
    expect(ticketQuery({ mine: false, status: "all" })).toEqual({
      sort: "priority",
      limit: "50",
    });
  });

  it("keeps the list of a ticket in its address", () => {
    expect(ticketHref("w 1", "t/1", { mine: false, status: "open" })).toBe(
      "/feedback/w%201/tickets/t%2F1",
    );
    const mine = { mine: true, status: "all" };
    expect(ticketHref("w1", "t1", mine)).toBe(
      "/feedback/w1/tickets/t1?view=mine&status=all",
    );
    expect(ticketListHref("w1", mine)).toBe(
      "/feedback/w1/my-tickets?status=all",
    );
    expect(ticketListHref("w1", { mine: false, status: "open" })).toBe(
      "/feedback/w1/tickets",
    );
  });

  it("groups tickets by priority, the most urgent first", () => {
    const { items } = listTicketsFixture.ok({
      items: [ticket("a", "low"), ticket("b", "urgent"), ticket("c", "low")],
    });
    const groups = priorityGroups(items, (key) => key.split(".").at(-1)!);
    expect(
      groups.map((group) => [group.label, group.items.map((t) => t.id)]),
    ).toEqual([
      ["urgent", ["b"]],
      ["high", []],
      ["medium", []],
      ["low", ["a", "c"]],
      ["none", []],
    ]);
  });

  it("shows the requester, the chips and a team or unassigned assignee", () => {
    const row = ticketRow(
      getTicketFixture.ok({
        reference: "T-7",
        title: "Login fails",
        ticketType: {
          id: "type_1",
          name: "Bug",
          slug: "bug",
          category: "customer",
          icon: null,
          color: "gray",
        },
        assignee: {
          principalId: null,
          displayName: null,
          teamId: "team_1",
          teamName: "Billing",
        },
      }),
      "Nobody",
    );
    expect(row.person?.name).toBe("Nobody");
    expect(row.shortId).toBe("T-7");
    expect(row.chips?.map((chip) => chip.label)).toEqual(["value", "Bug"]);
    expect(row.assignee).toEqual({ name: "Billing" });
    expect(ticketRow(getTicketFixture.ok(), "Nobody").assignee).toBeNull();
  });
});
