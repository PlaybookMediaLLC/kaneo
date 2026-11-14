import { describe, expect, it } from "vite-plus/test";
import { listTicketsFixture } from "../../api/team/list-tickets.fixture";
import { getTicketFixture } from "../../api/team/get-ticket.fixture";
import {
  priorityGroups,
  statusFill,
  ticketHref,
  ticketListHref,
  ticketQuery,
  ticketRow,
  ticketScope,
  ticketSearch,
} from "./ticket-scope";

const ticket = (id: string, priority: "urgent" | "low") =>
  getTicketFixture.ok({ id, priority });

describe("ticket scope", () => {
  it("opens the open tab of all tickets by default", () => {
    const scope = ticketScope({});
    expect(scope).toEqual({ mine: false, status: "open", q: "" });
    expect(ticketQuery(scope)).toEqual({
      sort: "priority",
      limit: "50",
      statusCategory: "open",
    });
  });

  it("asks for the caller's tickets in one status", () => {
    const scope = ticketScope({
      view: "mine",
      status: "ticket_status_1",
      q: " login ",
    });
    expect(ticketQuery(scope)).toEqual({
      sort: "priority",
      limit: "50",
      assignee: "me",
      statusId: "ticket_status_1",
      search: "login",
    });
    expect(ticketQuery({ mine: false, status: "all", q: " " })).toEqual({
      sort: "priority",
      limit: "50",
    });
  });

  it("keeps the list of a ticket in its address", () => {
    const open = { mine: false, status: "open", q: "" };
    expect(ticketHref("w 1", "t/1", open)).toBe(
      "/feedback/w%201/tickets/t%2F1",
    );
    const mine = { mine: true, status: "all", q: "login" };
    expect(ticketHref("w1", "t1", mine)).toBe(
      "/feedback/w1/tickets/t1?view=mine&status=all&q=login",
    );
    expect(ticketListHref("w1", mine)).toBe(
      "/feedback/w1/my-tickets?status=all&q=login",
    );
    expect(ticketListHref("w1", open)).toBe("/feedback/w1/tickets");
    expect(ticketListHref("w1", open, true)).toBe(
      "/feedback/w1/tickets?new=true",
    );
  });

  it("reads the address and drops values that do not fit", () => {
    expect(
      ticketSearch.parse({ view: "all", status: "s1", q: 123, new: true }),
    ).toEqual({ status: "s1", q: "123", new: true });
    expect(ticketSearch.parse({ new: "yes", q: "x".repeat(201) })).toEqual({});
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

  it("shows the requester, the reference, the status and a team or unassigned assignee", () => {
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
    expect(row.title).toBe("Login fails");
    expect(row.preview).toBe("T-7 · Bug");
    expect(row.badge).toEqual({
      id: "status",
      label: "value",
      tone: "neutral",
    });
    expect(row.assignee).toEqual({ name: "Billing" });
    expect(ticketRow(getTicketFixture.ok(), "Nobody").assignee).toBeNull();
  });

  it("fills the status icon by the status category", () => {
    expect(
      ["open", "pending", "closed"].map((c) => statusFill(c as "open")),
    ).toEqual([0, 0.5, 1]);
  });
});
