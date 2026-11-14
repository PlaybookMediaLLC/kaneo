import { describe, expect, it } from "vite-plus/test";
import { getConversationFixture } from "../../api/team/get-conversation.fixture";
import {
  conversationHref,
  listHref,
  listQuery,
  peopleById,
  priorityGroups,
  readContext,
  rowData,
  type Conversation,
  type SavedView,
} from "./conversation-list";

// A detail response is a list row with more fields.
const conversation = (values: Partial<Conversation> = {}): Conversation => ({
  ...getConversationFixture.ok(),
  ...values,
});
const saved = (rules: SavedView["filters"]["rules"]): SavedView => ({
  id: "view_test_1",
  name: "Urgent billing",
  filters: { rules },
  sort: null,
  isShared: true,
  isPinned: true,
  createdByPrincipalId: null,
});

describe("conversation list", () => {
  it("reads the list context and falls back on unknown values", () => {
    expect(
      readContext({ status: "snoozed", savedView: "view_1" }, "mine"),
    ).toEqual({ view: "mine", status: "snoozed", savedView: "view_1" });
    expect(readContext({ view: "other", status: 3, savedView: "" })).toEqual({
      view: "all",
      status: "open",
      savedView: undefined,
    });
  });

  it("filters a view by its assignee and status tab", () => {
    expect(listQuery({ view: "mine", status: "closed" })).toEqual({
      sort: "priority",
      limit: "50",
      assignee: "mine",
      status: "closed",
    });
    expect(listQuery({ view: "all", status: "open" })).toEqual({
      sort: "priority",
      limit: "50",
      status: "open",
    });
  });

  it("applies a pinned view's rules instead of the status tab", () => {
    const view = saved([
      { field: "priority", value: "urgent" },
      { field: "assignee", value: "me" },
      { field: "tag", value: "tag_1" },
      { field: "waiting", value: true },
      { field: "attribute", key: "plan", operator: "eq", value: "pro" },
    ]);
    expect(
      listQuery(
        { view: "unassigned", status: "open" },
        { ...view, sort: "waiting" },
      ),
    ).toEqual({
      sort: "waiting",
      limit: "50",
      assignee: "mine",
      priority: "urgent",
      tagId: "tag_1",
      waitingOnly: "true",
    });
  });

  it("groups rows by priority, most urgent first", () => {
    const groups = priorityGroups(
      [
        conversation({ id: "a", priority: "low" }),
        conversation({ id: "b", priority: "urgent" }),
      ],
      (key) => key,
    );
    expect(groups.map((group) => group.id)).toEqual([
      "urgent",
      "high",
      "medium",
      "low",
      "none",
    ]);
    expect(groups[0]!.items.map((item) => item.id)).toEqual(["b"]);
    expect(groups[0]!.label).toBe("team-conversations.priority.urgent");
  });

  it("names the customer, the title and the assignee of a row", () => {
    const people = peopleById([
      {
        id: "principal_1",
        userId: "user_1",
        name: "Ada",
        avatarUrl: null,
        role: "member",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(
      rowData(
        conversation({
          visitorEmail: "grace@example.test",
          lastMessagePreview: "Export fails",
          assignedAgentPrincipalId: "principal_1",
          unreadCount: 2,
          tags: [{ id: "tag_1", name: "Billing", color: "gray" }],
        }),
        people,
        "Unknown",
      ),
    ).toMatchObject({
      person: { name: "grace@example.test" },
      title: "Export fails",
      preview: null,
      chips: [{ id: "tag_1", label: "Billing" }],
      assignee: { name: "Ada" },
      unread: true,
    });
    expect(
      rowData(conversation({ subject: "Refund" }), people, "Unknown"),
    ).toMatchObject({
      person: { name: "Unknown" },
      title: "Refund",
      assignee: null,
    });
  });

  it("keeps the list in the address of a conversation and back", () => {
    const context = {
      view: "mine",
      status: "snoozed",
      savedView: "v 1",
    } as const;
    expect(conversationHref("w 1", "c/1", context)).toBe(
      "/feedback/w%201/conversations/c%2F1?view=mine&status=snoozed&savedView=v+1",
    );
    expect(listHref("w", { view: "all", status: "open" })).toBe(
      "/feedback/w/conversations/all?status=open",
    );
  });
});
