import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { slaEvents, slaPolicies } from "../../database/quills/schema/sla";
import { teams } from "../../database/quills/schema/teams";
import { ticketActivity } from "../../database/quills/schema/ticket-activity";
import {
  ticketConversations,
  ticketLinks,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import * as kaneo from "../../database/schema";
import { startFeature } from "../feedback/harness.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
let world: Awaited<ReturnType<typeof startFeature>>;
type Status = { id: TypeId<"ticket_status">; category: string; slug: string };
let statuses: Status[];
const status = (slug: string) => statuses.find((s) => s.slug === slug)!.id;

const inA = <T>(work: Parameters<typeof world.scoped<T>>[2]) =>
  world.scoped(world.a, world.users.owner, work);
const ticketIn = (
  workspaceId: string,
  values: Partial<typeof tickets.$inferInsert> = {},
) =>
  world.scoped(
    workspaceId,
    workspaceId === world.a ? world.users.owner : world.users.outsider,
    async (db) => {
      const [open] = await db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.isDefault, true));
      const [row] = await db
        .insert(tickets)
        .values({ title: "Feature ticket", statusId: open!.id, ...values })
        .returning();
      return row!;
    },
  );
const customerIn = (workspaceId: string, test = false) =>
  world.scoped(
    workspaceId,
    workspaceId === world.a ? world.users.owner : world.users.outsider,
    async (db, actor) => {
      // A teammate has at most one test customer (principal_test_owner_idx).
      const [own] = test
        ? await db
            .select({ id: principal.id })
            .from(principal)
            .where(eq(principal.testOwnerPrincipalId, actor.principalId))
        : [];
      if (own) return own.id;
      return (
        await db
          .insert(principal)
          .values({
            type: "user",
            role: "user",
            displayName: "Grace Customer",
            createdAt: new Date(),
            testOwnerPrincipalId: test ? actor.principalId : null,
          })
          .returning({ id: principal.id })
      )[0]!.id;
    },
  );
const read = (id: TypeId<"ticket">) =>
  inA(
    async (db) =>
      (await db.select().from(tickets).where(eq(tickets.id, id)))[0]!,
  );

describe.skipIf(!url)("Support tickets", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 10 });
    world = await startFeature(pool, url!, "tickets");
    // Provisions B's actor and default statuses.
    await world.scoped(world.b, world.users.outsider, async () => {});
    statuses = await inA((db) =>
      db
        .select({
          id: ticketStatuses.id,
          category: ticketStatuses.category,
          slug: ticketStatuses.slug,
        })
        .from(ticketStatuses)
        .where(isNull(ticketStatuses.deletedAt)),
    );
  }, 120000);
  afterAll(() => world?.stop());

  it("allocates unique ticket numbers under concurrent creation through quills_runtime", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 16 }, (_, i) =>
        world.request(world.users.owner, "POST", "/tickets", {
          title: `Parallel ${i}`,
          type: "back_office",
        }),
      ),
      // Workspace B allocates from the same sequence at the same time.
      ...Array.from({ length: 4 }, () =>
        ticketIn(world.b).then((row) => ({ status: 200, body: row })),
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 200));
    const numbers = results.map((r) => Number(r.body.number));
    expect(new Set(numbers).size).toBe(numbers.length);
    const stored = await inA((db) =>
      db
        .select({ number: tickets.number })
        .from(tickets)
        .where(
          inArray(
            tickets.id,
            results.slice(0, 16).map((r) => r.body.id),
          ),
        ),
    );
    expect(stored.map((r) => r.number).sort()).toEqual(
      numbers.slice(0, 16).sort(),
    );
    // The database rejects a reused number in the same workspace, whatever the caller sends.
    await expect(ticketIn(world.a, { number: numbers[0] })).rejects.toThrow();
  }, 60000);

  it("applies a bulk action to every ticket or to none", async () => {
    const one = await ticketIn(world.a);
    const two = await ticketIn(world.a);
    const foreign = await ticketIn(world.b);
    const bulk = (ticketIds: string[], action: object) =>
      world.request(world.users.owner, "POST", "/tickets/bulk", {
        ticketIds,
        action,
      });

    expect(
      (
        await bulk([one.id, foreign.id], {
          type: "priority",
          priority: "urgent",
        })
      ).status,
    ).toBe(404);
    const foreignStatus = await world.scoped(
      world.b,
      world.users.outsider,
      async (db) =>
        (
          await db
            .select({ id: ticketStatuses.id })
            .from(ticketStatuses)
            .limit(1)
        )[0]!.id,
    );
    expect(
      (
        await bulk([one.id, two.id], {
          type: "set_status",
          statusId: foreignStatus,
        })
      ).status,
    ).toBe(404);
    expect((await read(one.id)).priority).toBe("none");
    expect((await read(two.id)).statusId).toBe(one.statusId);

    const ok = await bulk([one.id, two.id], {
      type: "priority",
      priority: "urgent",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.items.map((t: { id: string }) => t.id)).toEqual([
      one.id,
      two.id,
    ]);
    expect((await read(one.id)).priority).toBe("urgent");
    expect((await read(two.id)).priority).toBe("urgent");
  });

  it("stamps resolution and reopens, and a tracker moves its open linked tickets", async () => {
    const tracker = await ticketIn(world.a, { type: "tracker" });
    const open = await ticketIn(world.a);
    const done = await ticketIn(world.a, { statusId: status("resolved") });
    await inA((db) =>
      db.insert(ticketLinks).values([
        { trackerTicketId: tracker.id, linkedTicketId: open.id },
        { trackerTicketId: tracker.id, linkedTicketId: done.id },
      ]),
    );
    const set = (id: string, slug: string) =>
      world.request(world.users.owner, "POST", `/tickets/${id}/status`, {
        statusId: status(slug),
      });

    expect((await set(tracker.id, "waiting_customer")).status).toBe(200);
    expect((await read(open.id)).statusId).toBe(status("waiting_customer"));
    expect((await read(done.id)).statusId).toBe(status("resolved"));

    const closed = await set(open.id, "resolved");
    expect(closed.body.resolvedAt).not.toBeNull();
    expect(closed.body.stage).toEqual({
      slot: "resolved",
      label: "Resolved",
      closed: true,
    });
    const reopened = await set(open.id, "new");
    expect(reopened.body.resolvedAt).toBeNull();
    expect(reopened.body.reopenedCount).toBe(1);
    const moves = await inA((db) =>
      db
        .select({ type: ticketActivity.type })
        .from(ticketActivity)
        .where(eq(ticketActivity.ticketId, open.id)),
    );
    expect(moves.filter((m) => m.type === "status.changed")).toHaveLength(3);
    const stageLines = await inA((db) =>
      db
        .select({ content: conversationMessages.content })
        .from(conversationMessages)
        .where(eq(conversationMessages.ticketId, open.id))
        .orderBy(asc(conversationMessages.createdAt)),
    );
    expect(stageLines.map((m) => m.content)).toEqual([
      "Status updated to Awaiting your reply",
      "Status updated to Resolved",
      "Status updated to Received",
    ]);
  });

  it("never lists another workspace's tickets or accepts its cursor", async () => {
    const own = await ticketIn(world.a, { title: "Needle in A" });
    const foreign = await ticketIn(world.b, { title: "Needle in B" });
    const list = await world.request(
      world.users.owner,
      "GET",
      "/tickets?search=Needle&limit=100",
    );
    expect(list.status).toBe(200);
    const ids = list.body.items.map((t: { id: string }) => t.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
    expect(JSON.stringify(list.body)).not.toContain("Needle in B");
    expect(
      (
        await world.request(
          world.users.owner,
          "GET",
          `/tickets?cursor=${foreign.id}`,
        )
      ).status,
    ).toBe(404);
    const byNumber = await world.request(
      world.users.owner,
      "GET",
      `/tickets?search=%23${own.number}`,
    );
    expect(byNumber.body.items.map((t: { id: string }) => t.id)).toEqual([
      own.id,
    ]);
    expect(
      (await world.request(world.users.owner, "GET", `/tickets/${foreign.id}`))
        .status,
    ).toBe(404);
  });

  it("pairs a requester's customer ticket with a conversation that carries replies but not notes", async () => {
    const requester = await customerIn(world.a);
    const created = await world.request(world.users.owner, "POST", "/tickets", {
      title: "Refund",
      description: "Please refund order 7.",
      requesterPrincipalId: requester,
    });
    expect(created.status).toBe(200);
    const pair = await world.request(
      world.users.owner,
      "GET",
      `/tickets/${created.body.id}/conversations`,
    );
    expect(pair.body.pairConversationId).not.toBeNull();
    expect(created.body.assignee.principalId).not.toBeNull();

    await world.request(
      world.users.owner,
      "POST",
      `/tickets/${created.body.id}/reply`,
      { content: "Done." },
    );
    await world.request(
      world.users.owner,
      "POST",
      `/tickets/${created.body.id}/note`,
      { content: "Internal." },
    );
    const onConversation = await inA((db) =>
      db
        .select({
          content: conversationMessages.content,
          isInternal: conversationMessages.isInternal,
        })
        .from(conversationMessages)
        .where(
          eq(conversationMessages.conversationId, pair.body.pairConversationId),
        )
        .orderBy(asc(conversationMessages.createdAt)),
    );
    expect(onConversation).toEqual([
      { content: "Please refund order 7.", isInternal: false },
      { content: "Done.", isInternal: false },
    ]);
    const visible = await world.request(
      world.users.owner,
      "GET",
      `/tickets/${created.body.id}/messages`,
    );
    expect(
      visible.body.items.map((m: { content: string }) => m.content),
    ).toEqual(["Please refund order 7.", "Done."]);
    const all = await world.request(
      world.users.owner,
      "GET",
      `/tickets/${created.body.id}/messages?includeInternal=true`,
    );
    expect(all.body.items.map((m: { content: string }) => m.content)).toContain(
      "Internal.",
    );
  });

  it("keeps one customer ticket per conversation and never links test and real records", async () => {
    const requester = await customerIn(world.a);
    const testCustomer = await customerIn(world.a, true);
    const conversation = await inA(
      async (db) =>
        (
          await db
            .insert(conversations)
            .values({ visitorPrincipalId: requester, channel: "messenger" })
            .returning({ id: conversations.id })
        )[0]!.id,
    );
    const first = await ticketIn(world.a, { requesterPrincipalId: requester });
    const second = await ticketIn(world.a, { requesterPrincipalId: requester });
    const testTicket = await ticketIn(world.a, {
      requesterPrincipalId: testCustomer,
    });
    const link = (id: string) =>
      world.request(
        world.users.owner,
        "PUT",
        `/tickets/${id}/conversations/${conversation}`,
      );

    expect((await link(testTicket.id)).status).toBe(409);
    expect((await link(first.id)).status).toBe(200);
    expect((await link(second.id)).status).toBe(409);
    expect((await link(first.id)).status).toBe(409);
    const rows = await inA((db) =>
      db
        .select({ ticketId: ticketConversations.ticketId })
        .from(ticketConversations)
        .where(and(eq(ticketConversations.conversationId, conversation))),
    );
    expect(rows).toEqual([{ ticketId: first.id }]);
  });

  it("applies a macro's actions to the conversation and skips a removed tag", async () => {
    const requester = await customerIn(world.a);
    const { conversation, tag, goneTag } = await inA(async (db) => {
      const [row] = await db
        .insert(conversations)
        .values({
          visitorPrincipalId: requester,
          channel: "messenger",
          subject: "Order 7",
        })
        .returning({ id: conversations.id });
      const [kept, gone] = await db
        .insert(conversationTags)
        .values([
          { name: `kept-${Date.now()}` },
          { name: `gone-${Date.now()}` },
        ])
        .returning({ id: conversationTags.id });
      return { conversation: row!.id, tag: kept!.id, goneTag: gone!.id };
    });
    const created = await world.request(world.users.owner, "POST", "/macros", {
      name: "Close politely",
      body: "Hi {firstName}, about {conversationTitle}. {unknown}",
      actions: [
        { type: "set_priority", priority: "high" },
        { type: "add_tag", tagId: tag },
        { type: "add_tag", tagId: goneTag },
        { type: "set_attribute", key: "plan", value: "pro" },
        { type: "close" },
      ],
    });
    expect(created.status).toBe(200);
    await inA((db) =>
      db
        .update(conversationTags)
        .set({ deletedAt: new Date() })
        .where(eq(conversationTags.id, goneTag)),
    );
    const applied = await world.request(
      world.users.owner,
      "POST",
      `/macros/${created.body.id}/apply`,
      { conversationId: conversation },
    );
    expect(applied.status).toBe(200);
    expect(applied.body.body).toBe("Hi Grace, about Order 7. ");
    expect(applied.body.applied).toHaveLength(4);
    const after = await inA(async (db) => ({
      row: (
        await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversation))
      )[0]!,
      tags: await db
        .select({ id: conversationTagAssignments.conversationTagId })
        .from(conversationTagAssignments)
        .where(eq(conversationTagAssignments.conversationId, conversation)),
    }));
    expect(after.row.priority).toBe("high");
    expect(after.row.status).toBe("closed");
    expect(after.row.resolvedAt).not.toBeNull();
    expect(after.row.customAttributes).toEqual({ plan: "pro" });
    expect(after.tags).toEqual([{ id: tag }]);
  });

  it("refuses to delete the default status or a status in use", async () => {
    const del = (id: string) =>
      world.request(world.users.owner, "DELETE", `/ticket-statuses/${id}`);
    expect((await del(status("new"))).status).toBe(409);
    await ticketIn(world.a, { statusId: status("escalated") });
    expect((await del(status("escalated"))).status).toBe(409);
    const live = await world.request(
      world.users.owner,
      "GET",
      "/ticket-statuses",
    );
    expect(live.body.items.map((s: { slug: string }) => s.slug)).toContain(
      "escalated",
    );
    // The last status of a category stays, whether or not tickets use it.
    expect((await del(status("waiting_third_party"))).status).toBe(200);
    const last = await del(status("waiting_customer"));
    expect(last.status).toBe(409);
    expect(last.body.message).toContain("last 'pending' status");
  });

  it("counts only this workspace's real SLA events", async () => {
    const policyIn = (workspaceId: string) =>
      world.scoped(
        workspaceId,
        workspaceId === world.a ? world.users.owner : world.users.outsider,
        async (db) =>
          (
            await db
              .insert(slaPolicies)
              .values({
                name: `Report ${workspaceId}`,
                firstResponseTargetSecs: 60,
              })
              .returning({ id: slaPolicies.id })
          )[0]!.id,
      );
    const events = (
      workspaceId: string,
      rows: {
        ticketId: TypeId<"ticket">;
        policyId: TypeId<"sla_policy">;
        kind: string;
      }[],
    ) =>
      world.scoped(
        workspaceId,
        workspaceId === world.a ? world.users.owner : world.users.outsider,
        (db) => db.insert(slaEvents).values(rows),
      );
    const policyA = await policyIn(world.a);
    const policyB = await policyIn(world.b);
    const real = await ticketIn(world.a);
    const test = await ticketIn(world.a, {
      requesterPrincipalId: await customerIn(world.a, true),
    });
    const foreign = await ticketIn(world.b);
    await events(world.a, [
      { ticketId: real.id, policyId: policyA, kind: "first_response_met" },
      { ticketId: real.id, policyId: policyA, kind: "first_response_breached" },
      { ticketId: test.id, policyId: policyA, kind: "first_response_breached" },
    ]);
    await events(world.b, [
      { ticketId: foreign.id, policyId: policyB, kind: "first_response_met" },
    ]);
    const from = new Date(Date.now() - 3600000).toISOString();
    const to = new Date(Date.now() + 3600000).toISOString();
    const report = await world.request(
      world.users.owner,
      "GET",
      `/support/reporting?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(report.status).toBe(200);
    expect(report.body.sla.firstResponse).toEqual({
      met: 1,
      breached: 1,
      rate: 0.5,
    });
    const mine = report.body.slaByPolicy.find(
      (p: { policyId: string }) => p.policyId === policyA,
    );
    expect(mine.firstResponse).toEqual({ met: 1, breached: 1, rate: 0.5 });
    expect(JSON.stringify(report.body)).not.toContain(policyB);
    expect(
      report.body.slaHeatmap.reduce(
        (n: number, c: { count: number }) => n + c.count,
        0,
      ),
    ).toBe(1);
  });

  it("copies a tracker's reply-all to linked tickets and a shared note to the origin conversation", async () => {
    const tracker = await ticketIn(world.a, { type: "tracker" });
    const linked = await ticketIn(world.a);
    const backOffice = await ticketIn(world.a, { type: "back_office" });
    const requester = await customerIn(world.a);
    const origin = await inA(async (db) => {
      const [row] = await db
        .insert(conversations)
        .values({ visitorPrincipalId: requester, channel: "messenger" })
        .returning({ id: conversations.id });
      await db
        .insert(ticketLinks)
        .values({ trackerTicketId: tracker.id, linkedTicketId: linked.id });
      await db.insert(ticketConversations).values({
        ticketId: backOffice.id,
        conversationId: row!.id,
        ticketType: "back_office",
      });
      return row!.id;
    });
    const replied = await world.request(
      world.users.owner,
      "POST",
      `/tickets/${tracker.id}/reply`,
      {
        content: "Fixed in 2.1",
        replyAll: true,
      },
    );
    expect(replied.status).toBe(200);
    const noted = await world.request(
      world.users.owner,
      "POST",
      `/tickets/${backOffice.id}/note`,
      {
        content: "Root cause found",
        shareWithConversation: true,
      },
    );
    expect(noted.status).toBe(200);
    const copies = await inA(async (db) => ({
      reply: await db
        .select({
          content: conversationMessages.content,
          metadata: conversationMessages.metadata,
        })
        .from(conversationMessages)
        .where(eq(conversationMessages.ticketId, linked.id)),
      note: await db
        .select({
          content: conversationMessages.content,
          isInternal: conversationMessages.isInternal,
          metadata: conversationMessages.metadata,
        })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, origin)),
    }));
    expect(copies.reply).toEqual([
      {
        content: "Fixed in 2.1",
        metadata: { repliedAllFromTicketId: tracker.id },
      },
    ]);
    expect(copies.note).toEqual([
      {
        content: "Root cause found",
        isInternal: true,
        metadata: { crossPostedFromTicketId: backOffice.id },
      },
    ]);
  });

  it("pages tickets and messages with keyset cursors, without gaps or repeats", async () => {
    const title = `Pager ${Date.now()}`;
    const created = [];
    for (const priority of ["low", "urgent", "none", "high", "urgent"] as const)
      created.push(await ticketIn(world.a, { title, priority }));
    for (const sort of ["priority", "recent", "created", "oldest"]) {
      const seen: string[] = [];
      let cursor = "";
      for (let page = 0; page < 5; page++) {
        const res = await world.request(
          world.users.owner,
          "GET",
          `/tickets?search=${encodeURIComponent(title)}&sort=${sort}&limit=2${cursor && `&cursor=${cursor}`}`,
        );
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((t: { id: string }) => t.id));
        if (!res.body.hasMore) break;
        cursor = res.body.nextCursor;
      }
      expect(seen.sort()).toEqual(created.map((t) => t.id).sort());
    }
    const thread = created[0]!;
    await inA((db) =>
      db.insert(conversationMessages).values(
        ["one", "two", "three"].map((content) => ({
          ticketId: thread.id,
          senderType: "agent" as const,
          content,
        })),
      ),
    );
    const first = await world.request(
      world.users.owner,
      "GET",
      `/tickets/${thread.id}/messages?limit=2`,
    );
    expect(first.body.hasMore).toBe(true);
    const second = await world.request(
      world.users.owner,
      "GET",
      `/tickets/${thread.id}/messages?limit=2&before=${first.body.nextCursor}`,
    );
    expect(second.body.hasMore).toBe(false);
    const contents = [...second.body.items, ...first.body.items].map(
      (m: { content: string }) => m.content,
    );
    expect(contents.sort()).toEqual(["one", "three", "two"]);
  });

  it("keeps a customer pair's read marker on its conversation", async () => {
    const created = await world.request(world.users.owner, "POST", "/tickets", {
      title: "Pair marker",
      description: "First message",
      requesterPrincipalId: await customerIn(world.a),
    });
    const pair = (
      await world.request(
        world.users.owner,
        "GET",
        `/tickets/${created.body.id}/conversations`,
      )
    ).body.pairConversationId;
    const marker = () =>
      inA(async (db) => ({
        conversation: (
          await db
            .select({ at: conversations.agentLastReadAt })
            .from(conversations)
            .where(eq(conversations.id, pair))
        )[0]!.at,
        ticket: (await read(created.body.id)).assigneeLastReadAt,
      }));
    expect(
      (
        await world.request(
          world.users.owner,
          "POST",
          `/tickets/${created.body.id}/read`,
        )
      ).status,
    ).toBe(200);
    const afterRead = await marker();
    expect(afterRead.conversation).not.toBeNull();
    expect(afterRead.ticket).toBeNull();
    const [message] = await inA((db) =>
      db
        .select({
          id: conversationMessages.id,
          at: conversationMessages.createdAt,
        })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, pair)),
    );
    await world.request(
      world.users.owner,
      "POST",
      `/tickets/${created.body.id}/unread`,
      {
        messageId: message!.id,
      },
    );
    expect((await marker()).conversation!.getTime()).toBe(
      message!.at.getTime() - 1,
    );
  });

  it("assigns only current members, checks the source conversation and inherits its assignee", async () => {
    const ticket = await ticketIn(world.a);
    const customer = await customerIn(world.a);
    const assign = await world.request(
      world.users.owner,
      "POST",
      `/tickets/${ticket.id}/assign`,
      {
        assigneePrincipalId: customer,
      },
    );
    expect(assign.status).toBe(404);
    expect((await read(ticket.id)).assigneePrincipalId).toBeNull();

    const member = await world.scoped(
      world.a,
      world.users.member,
      async (_db, actor) => actor.principalId,
    );
    const foreignConversation = await world.scoped(
      world.b,
      world.users.outsider,
      async (db) => {
        const [visitor] = await db
          .insert(principal)
          .values({ type: "user", role: "user", createdAt: new Date() })
          .returning({ id: principal.id });
        return (
          await db
            .insert(conversations)
            .values({ visitorPrincipalId: visitor!.id, channel: "messenger" })
            .returning({ id: conversations.id })
        )[0]!.id;
      },
    );
    const foreign = await world.request(world.users.owner, "POST", "/tickets", {
      title: "From B",
      conversationId: foreignConversation,
    });
    expect(foreign.status).toBe(404);
    const source = await inA(
      async (db) =>
        (
          await db
            .insert(conversations)
            .values({
              visitorPrincipalId: customer,
              channel: "messenger",
              assignedAgentPrincipalId: member,
            })
            .returning({ id: conversations.id })
        )[0]!.id,
    );
    const inherited = await world.request(
      world.users.owner,
      "POST",
      "/tickets",
      {
        title: "From a conversation",
        type: "back_office",
        conversationId: source,
      },
    );
    expect(inherited.status).toBe(200);
    expect(inherited.body.assignee.principalId).toBe(member);
  });

  it("refuses a macro whose actions name another workspace's team or a deleted tag", async () => {
    const foreignTeam = await world.scoped(
      world.b,
      world.users.outsider,
      async (db) =>
        (
          await db
            .insert(teams)
            .values({ name: "B team" })
            .returning({ id: teams.id })
        )[0]!.id,
    );
    const deletedTag = await inA(
      async (db) =>
        (
          await db
            .insert(conversationTags)
            .values({ name: `deleted-${Date.now()}`, deletedAt: new Date() })
            .returning({ id: conversationTags.id })
        )[0]!.id,
    );
    for (const action of [
      { type: "assign_team", teamId: foreignTeam },
      { type: "add_tag", tagId: deletedTag },
    ]) {
      const res = await world.request(world.users.owner, "POST", "/macros", {
        name: "Bad",
        body: "Body",
        actions: [action],
      });
      expect(res.status).toBe(404);
    }
  });
});
