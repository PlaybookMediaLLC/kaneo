import { describe, expect, it } from "vite-plus/test";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { ensureQuillsI18n } from "../i18n/load";
import { i18n } from "../ui/upstream";
import { teamSections } from "./nav";

const counts = getTeamCountsFixture.ok({
  queueConversations: 3,
  postStatuses: [
    { id: "s1", name: "Pending", color: "gray", count: 4 },
    { id: "s2", name: "Planned", color: "blue", count: 0 },
  ],
});

describe("teamSections", () => {
  it("has the Conversations, Requests and Workspace sections with translated labels", async () => {
    await ensureQuillsI18n();
    const sections = teamSections("workspace_1", counts);
    expect(sections.map((section) => section.id)).toEqual([
      "conversations",
      "requests",
      "workspace",
    ]);
    const items = sections.flatMap((section) => section.items);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const key of [
      ...sections.map((section) => section.labelKey),
      ...items.flatMap((item) => item.labelKey ?? []),
    ])
      expect(i18n.exists(key, { ns: "quills" })).toBe(true);
  });

  it("makes one Requests item for each open status, in order, with its count", () => {
    const [, requests] = teamSections("workspace_1", counts);
    expect(
      requests!.items.map((item) => [
        item.label ?? item.labelKey,
        item.search,
        item.count,
        item.attention ?? false,
        item.status?.progress,
      ]),
    ).toEqual([
      ["Pending", { statusId: "s1" }, 4, true, 0],
      ["Planned", { statusId: "s2" }, 0, false, 0.5],
      ["team.nav.allRequests", { status: "all" }, undefined, false, undefined],
    ]);
    expect(requests!.items[0]!.to).toBe("/feedback/workspace_1/posts");
  });

  it("puts the counts on the views and links outside the app where needed", () => {
    const [conversations, , workspace] = teamSections("workspace 1", counts);
    const queue = conversations!.items[0]!;
    expect(queue).toMatchObject({
      to: "/feedback/workspace%201/conversations/queue",
      count: 3,
      attention: true,
    });
    const byId = new Map(workspace!.items.map((item) => [item.id, item]));
    expect(byId.get("overview")).toMatchObject({
      to: "/feedback/workspace%201",
      exact: true,
    });
    expect(byId.get("roadmap")).toMatchObject({
      to: "/portal/workspace%201/roadmap",
      newTab: true,
    });
    expect(byId.get("members")?.to).toBe(
      "/dashboard/workspace/workspace%201/members",
    );
    expect(byId.get("share")).toMatchObject({
      to: "/portal/workspace%201",
      copy: true,
    });
    expect(byId.get("duplicates")?.count).toBe(0);
  });

  it("has no counts and no status items before the counts load", () => {
    const [conversations, requests] = teamSections("workspace_1");
    expect(conversations!.items.every((item) => item.count === undefined)).toBe(
      true,
    );
    expect(requests!.items.map((item) => item.id)).toEqual(["all-requests"]);
  });
});
