import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { assistantInvolvements } from "../../database/quills/schema/assistant";
import { principal, user } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { events } from "../../database/quills/schema/events";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
import { startFeature } from "../feedback/harness.fixture";
import type { Database } from "../framework/define-route";
import { supportSubscribers } from "../jobs/handlers/support-mail";
import { conversation, customer } from "./conversation-seed.fixture";

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
const email = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

type Status = (typeof assistantInvolvements.$inferInsert)["status"];
let ids: {
  visitor: string;
  real: string;
  twice: string;
  test: string;
  spam: string;
  foreign: string;
  foreignCustomer: string;
  hiddenPost: TypeId<"post">;
  openPost: TypeId<"post">;
  teammate: string;
};

describe.skipIf(!url)("Assistant inbox surface and outbound start", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "assistant_surface");
    const { users, projects } = world;
    const involve = (
      db: Database,
      conversationId: string,
      status: Status,
      sources: (typeof assistantInvolvements.$inferInsert)["sources"] = [],
    ) =>
      db.insert(assistantInvolvements).values({
        conversationId: conversationId as never,
        triggeredBy: "first_touch",
        status,
        sources,
      });
    const foreign = await world.scoped(
      world.b,
      users.outsider,
      async (db, actor) => {
        const visitor = await customer(db, email("b"));
        const { conversationId } = await conversation(
          db,
          actor.principalId,
          visitor,
        );
        await involve(db, conversationId, "active");
        return { conversationId, visitor };
      },
    );
    ids = await world.scoped(world.a, users.owner, async (db, actor) => {
      const board = async (projectId: string) => {
        const [row] = await db
          .insert(boards)
          .values({ name: projectId, slug: `${projectId}-board` })
          .returning({ id: boards.id });
        await db.insert(boardProjects).values({ boardId: row!.id, projectId });
        const [post] = await db
          .insert(posts)
          .values({
            title: `Post on ${projectId}`,
            content: "Cited",
            boardId: row!.id,
            principalId: actor.principalId,
          })
          .returning({ id: posts.id });
        return post!.id;
      };
      const hiddenPost = await board(projects.hidden);
      const openPost = await board(projects.open);
      const visitor = await customer(db, email("a"));
      const tester = await customer(db, email("test"), actor.principalId);
      const real = (await conversation(db, actor.principalId, visitor))
        .conversationId;
      const twice = (await conversation(db, actor.principalId, visitor))
        .conversationId;
      const test = (await conversation(db, actor.principalId, tester))
        .conversationId;
      const spam = (
        await conversation(db, actor.principalId, visitor, {
          status: "closed",
          endReason: "spam",
          spamReason: "manual",
          resolvedAt: new Date(),
        })
      ).conversationId;
      await involve(db, real, "resolved_assumed", [
        { type: "post", id: hiddenPost, title: "Hidden" },
        { type: "post", id: openPost, title: "Open" },
        { type: "post", id: "not-a-post-id", title: "Broken" },
        { type: "article", id: "article", title: "Guide", url: "/guide" },
      ]);
      // A conversation the agent handed off and then took again counts once in each bucket.
      await involve(db, twice, "handed_off");
      await involve(db, twice, "active");
      await involve(db, test, "active");
      await involve(db, spam, "active");
      return {
        visitor,
        real,
        twice,
        test,
        spam,
        foreign: foreign.conversationId,
        foreignCustomer: foreign.visitor,
        hiddenPost,
        openPost,
        teammate: actor.principalId,
      };
    });
  }, 120000);
  afterAll(() => world?.stop());

  it("counts real, non-spam conversations of this workspace only", async () => {
    const res = await world.request(
      world.users.member,
      "GET",
      "/inbox/assistant-counts",
    );
    expect(res.status).toBe(200);
    // Not counted: the test customer's, the spam and workspace B's active involvements.
    expect(res.body).toEqual({ resolved: 1, escalated: 1, pending: 1 });
  });

  it("leaves out a cited post on a board the caller cannot see", async () => {
    const path = `/conversations/${ids.real}/assistant-activity`;
    const member = await world.request(world.users.member, "GET", path);
    expect(member.status).toBe(200);
    expect(member.body.activity.outcome).toBe("resolved_assumed");
    expect(
      member.body.activity.sources.map((s: { id: string }) => s.id),
    ).toEqual([ids.openPost, "article"]);
    const owner = await world.request(world.users.owner, "GET", path);
    expect(
      owner.body.activity.sources.map((s: { id: string }) => s.id),
    ).toEqual([ids.hiddenPost, ids.openPost, "article"]);
    expect(
      (
        await world.request(
          world.users.owner,
          "GET",
          `/conversations/${ids.foreign}/assistant-activity`,
        )
      ).status,
    ).toBe(404);
    const spam = await world.request(
      world.users.owner,
      "GET",
      `/conversations/${ids.spam}/assistant-activity`,
    );
    // One conversation reads like getQuillsConversation: a spam thread has its activity too.
    expect(spam.body.activity.outcome).toBe("active");
  });

  it("starts a conversation and mails its first message once, after commit", async () => {
    const { owner } = world.users;
    const res = await world.request(owner, "POST", "/conversations", {
      targetPrincipalId: ids.visitor,
      content: "We have news about your request",
    });
    expect(res.status).toBe(200);
    const { conversation: started, message } = res.body;
    expect(started).toMatchObject({
      status: "open",
      channel: "messenger",
      assignedAgentPrincipalId: ids.teammate,
      subject: "We have news about your request",
      lastMessagePreview: "We have news about your request",
    });
    expect(message).toMatchObject({ senderType: "agent", isInternal: false });
    await world.scoped(world.a, owner, async (db) => {
      const recorded = await db
        .select({ type: events.type, entityId: events.entityId })
        .from(events)
        .where(eq(events.entityId, started.id));
      expect(recorded).toEqual([
        { type: "conversation.agent_started", entityId: started.id },
      ]);
      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.entityId, started.id));
      const entry = supportSubscribers["conversation.agent_started"]!;
      expect(
        typeof entry.direct === "function" && (await entry.direct(db, event!)),
      ).toBe(true);
      const mail = await entry.mail!(db, event!, null);
      const [address] = await db
        .select({ email: user.email })
        .from(principal)
        .innerJoin(user, eq(user.id, principal.userId))
        .where(eq(principal.id, ids.visitor as never));
      expect(mail).toMatchObject({
        to: address!.email,
        emailType: "ConversationStartedEmail",
        conversationId: started.id,
      });
      // The message.created event of the same message mails nothing: a messenger reply is not mail.
      const [created] = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.type, "message.created"),
            eq(events.entityId, message.id),
          ),
        );
      const reply = supportSubscribers["message.created"]!;
      expect(
        typeof reply.direct === "function" &&
          (await reply.direct(db, created!)),
      ).toBe(false);
    });
  });

  it("refuses a target that cannot receive the message, and changes nothing", async () => {
    const { owner } = world.users;
    // A lead has an account row with a synthetic address.
    const lead = await world.scoped(world.a, owner, async (db) => {
      const [identity] = await db
        .insert(user)
        .values({ name: "Lead", email: `${Date.now()}@anon.quills.io` })
        .returning({ id: user.id });
      const [row] = await db
        .insert(principal)
        .values({
          userId: identity!.id,
          type: "anonymous",
          role: "user",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      return row!.id;
    });
    const [noMail, blocked] = await world.scoped(world.a, owner, async (db) => {
      const [identity] = await db
        .insert(user)
        .values({ name: "No mail", email: null })
        .returning({ id: user.id });
      const [row] = await db
        .insert(principal)
        .values({
          userId: identity!.id,
          type: "user",
          role: "user",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      const blockedId = await customer(db, email("blocked"));
      await db
        .update(principal)
        .set({ blockedAt: new Date() })
        .where(eq(principal.id, blockedId as never));
      return [row!.id, blockedId];
    });
    const count = () =>
      world.scoped(world.a, owner, (db) => db.$count(conversations));
    const before = await count();
    for (const [target, status] of [
      [ids.teammate, 404],
      [ids.foreignCustomer, 404],
      [lead, 409],
      [noMail, 409],
      [blocked, 409],
    ] as const)
      expect(
        (
          await world.request(owner, "POST", "/conversations", {
            targetPrincipalId: target,
            content: "Hello",
          })
        ).status,
        target,
      ).toBe(status);
    expect(await count()).toBe(before);
    await world.scoped(world.a, owner, async (db) =>
      expect(
        await db.$count(
          conversationMessages,
          eq(conversationMessages.content, "Hello"),
        ),
      ).toBe(0),
    );
  });
});
