import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { auditLog } from "../../database/quills/schema/audit-log";
import { conversations } from "../../database/quills/schema/conversation";
import { events } from "../../database/quills/schema/events";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import * as kaneo from "../../database/schema";
import { startFeature } from "../feedback/harness.fixture";
import {
  conversation,
  customer,
  testCustomer,
} from "./conversation-seed.fixture";

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
const ids = {} as Record<
  | "real"
  | "testA"
  | "testB"
  | "foreignTest"
  | "pairTicket"
  | "otherTestTicket"
  | "backOffice",
  string
>;

describe.skipIf(!url)("Delete test conversations", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "test_threads");
    const { a, b, users } = world;
    await world.scoped(a, users.owner, async (db, actor) => {
      const real = await customer(db, "real@example.test");
      const tester = await testCustomer(
        db,
        actor.principalId,
        "tester@example.test",
      );
      ids.real = (
        await conversation(db, actor.principalId, real)
      ).conversationId;
      ids.testA = (
        await conversation(db, actor.principalId, tester)
      ).conversationId;
      ids.testB = (
        await conversation(db, actor.principalId, tester)
      ).conversationId;
      const [status] = await db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.isDefault, true));
      const [pair, other, backOffice] = await db
        .insert(tickets)
        .values([
          {
            title: "Pair",
            statusId: status!.id,
            requesterPrincipalId: tester,
          },
          {
            title: "Other",
            statusId: status!.id,
            requesterPrincipalId: tester,
          },
          { title: "Back office", statusId: status!.id, type: "back_office" },
        ])
        .returning({ id: tickets.id });
      await db.insert(ticketConversations).values([
        {
          ticketId: pair!.id,
          conversationId: ids.testA as TypeId<"conversation">,
          ticketType: "customer",
        },
        {
          ticketId: backOffice!.id,
          conversationId: ids.testA as TypeId<"conversation">,
          ticketType: "back_office",
        },
      ]);
      ids.pairTicket = pair!.id;
      ids.otherTestTicket = other!.id;
      ids.backOffice = backOffice!.id;
    });
    await world.scoped(b, users.outsider, async (db, actor) => {
      const tester = await testCustomer(
        db,
        actor.principalId,
        "tester-b@example.test",
      );
      ids.foreignTest = (
        await conversation(db, actor.principalId, tester)
      ).conversationId;
    });
  }, 120000);
  afterAll(() => world?.stop());

  it("deletes only test threads of the caller's workspace, with their pair ticket", async () => {
    const res = await world.request(
      world.users.member,
      "DELETE",
      "/test-conversations",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });

    await world.scoped(world.a, world.users.owner, async (db) => {
      const left = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          inArray(conversations.id, [
            ids.real,
            ids.testA,
            ids.testB,
          ] as TypeId<"conversation">[]),
        );
      expect(left.map((row) => row.id)).toEqual([ids.real]);
      const ticketsLeft = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          inArray(tickets.id, [
            ids.pairTicket,
            ids.otherTestTicket,
            ids.backOffice,
          ] as TypeId<"ticket">[]),
        );
      expect(ticketsLeft.map((row) => row.id).sort()).toEqual(
        [ids.otherTestTicket, ids.backOffice].sort(),
      );
      const recorded = await db
        .select({ payload: events.payload })
        .from(events)
        .where(eq(events.type, "conversation.test_deleted"));
      expect(recorded).toEqual([{ payload: { count: "2" } }]);
      expect(
        await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.eventType, "conversation.test_deleted"),
              eq(auditLog.targetId, world.a),
            ),
          ),
      ).toHaveLength(1);
    });
    // Workspace B's test thread is out of reach of a request in A.
    await world.scoped(world.b, world.users.outsider, async (db) => {
      expect(
        await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            eq(conversations.id, ids.foreignTest as TypeId<"conversation">),
          ),
      ).toHaveLength(1);
    });
  });

  it("answers zero and records no event when nothing is left", async () => {
    const res = await world.request(
      world.users.owner,
      "DELETE",
      "/test-conversations",
    );
    expect(res.body).toEqual({ deleted: 0 });
    await world.scoped(world.a, world.users.owner, async (db) => {
      expect(
        await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.type, "conversation.test_deleted")),
      ).toHaveLength(1);
    });
    expect(
      (
        await world.request(
          world.users.outsider,
          "DELETE",
          "/test-conversations",
        )
      ).status,
    ).toBeOneOf([403, 404]);
  });
});
