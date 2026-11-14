import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import * as kaneo from "../../database/schema";
import { startFeature } from "../feedback/harness.fixture";
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

/** A conversation in a workspace, and optionally a ticket linked to it as `link`. */
const threadIn = (
  workspaceId: string,
  link?: { type: "customer" | "back_office"; deleted?: boolean },
) =>
  world.scoped(
    workspaceId,
    workspaceId === world.a ? world.users.owner : world.users.outsider,
    async (db, actor) => {
      const visitor = await customer(
        db,
        `ticket-link-${crypto.randomUUID()}@example.test`,
      );
      const { conversationId } = await conversation(
        db,
        actor.principalId,
        visitor,
      );
      if (!link) return { conversationId, ticket: null };
      const [status] = await db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.isDefault, true));
      const [ticket] = await db
        .insert(tickets)
        .values({
          title: "Refund order 7",
          statusId: status!.id,
          type: link.type,
          requesterPrincipalId: visitor as never,
          deletedAt: link.deleted ? new Date() : null,
        })
        .returning({ id: tickets.id, number: tickets.number });
      await db.insert(ticketConversations).values({
        ticketId: ticket!.id,
        conversationId,
        ticketType: link.type,
      });
      return { conversationId, ticket: ticket! };
    },
  );

const get = (conversationId: string) =>
  world.request(
    world.users.owner,
    "GET",
    `/conversations/${conversationId}/ticket`,
  );

describe.skipIf(!url)("The customer ticket of a conversation", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 10 });
    world = await startFeature(pool, url!, "conversation-ticket");
    // Provisions B's actor and default ticket statuses.
    await world.scoped(world.b, world.users.outsider, async () => {});
  }, 120000);
  afterAll(() => world?.stop());

  it("returns the paired customer ticket with its status", async () => {
    const { conversationId, ticket } = await threadIn(world.a, {
      type: "customer",
    });
    const response = await get(conversationId);
    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({
      id: ticket!.id,
      number: ticket!.number,
      reference: `#${ticket!.number}`,
      title: "Refund order 7",
      status: { category: "open" },
    });
  });

  it("returns null without a pair, for a ticket opened from the thread and for a deleted ticket", async () => {
    for (const link of [
      undefined,
      { type: "back_office" as const },
      { type: "customer" as const, deleted: true },
    ]) {
      const { conversationId } = await threadIn(world.a, link);
      const response = await get(conversationId);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ticket: null });
    }
  });

  it("does not read a conversation of another workspace", async () => {
    const { conversationId } = await threadIn(world.b, { type: "customer" });
    const response = await get(conversationId);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("Refund order 7");
  });
});
