import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { conversationMessageMentions } from "../../database/quills/schema/conversation";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { seed as seedConversation } from "./conversation-seed.fixture";
import { side as seedTicketSide } from "./seed.fixture";

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
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

async function send(
  method: string,
  path: string,
  options: { user?: string; body?: unknown } = {},
) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe.skipIf(!url)(
  "Quills thread presence & ticket note mentions (#324)",
  () => {
    let teammateUserId: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
      const env = contractEnv();
      teammateUserId = env.id("teammate");
      await env.db.insert(kaneo.userTable).values({
        id: teammateUserId,
        name: "Alice Teammate",
        email: `${teammateUserId}@example.test`,
        emailVerified: true,
      });
      await env.db.insert(kaneo.workspaceUserTable).values({
        id: env.id("member"),
        workspaceId: env.a,
        userId: teammateUserId,
        role: "member",
        joinedAt: new Date(),
      });
    }, 120000);
    afterAll(() => stopContract());

    it("reports another teammate replying on a conversation while hiding the caller and isolating workspaces", async () => {
      const env = contractEnv();
      const ids = await seedConversation(env);

      // Owner marks replying on workspace A's conversation.
      const put = await send(
        "PUT",
        `/quills/${env.a}/conversations/${ids.a.conversationId}/presence`,
        { user: env.owner, body: { state: "replying" } },
      );
      expect(put).toEqual({ status: 200, body: { ok: true } });

      // Owner does not see themselves.
      const selfList = await send(
        "GET",
        `/quills/${env.a}/conversations/${ids.a.conversationId}/presence`,
        { user: env.owner },
      );
      expect(selfList.status).toBe(200);
      expect(selfList.body.viewers).toEqual([]);

      // Second teammate sees owner replying.
      const memberList = await send(
        "GET",
        `/quills/${env.a}/conversations/${ids.a.conversationId}/presence`,
        { user: teammateUserId },
      );
      expect(memberList.status).toBe(200);
      expect(memberList.body.viewers).toHaveLength(1);
      expect(memberList.body.viewers[0]).toMatchObject({
        state: "replying",
      });

      // Foreign conversation in workspace B is denied with 404.
      const foreign = await send(
        "GET",
        `/quills/${env.a}/conversations/${ids.b.conversationId}/presence`,
        { user: teammateUserId },
      );
      expect(foreign.status).toBe(404);
    });

    it("reports another teammate replying on a ticket and persists ticket note mentions", async () => {
      const env = contractEnv();
      const a = await seedTicketSide(env, env.a, teammateUserId);
      const b = await seedTicketSide(env, env.b, env.outsider);

      const put = await send(
        "PUT",
        `/quills/${env.a}/tickets/${a.ticketId}/presence`,
        { user: env.owner, body: { state: "replying" } },
      );
      expect(put).toEqual({ status: 200, body: { ok: true } });

      const list = await send(
        "GET",
        `/quills/${env.a}/tickets/${a.ticketId}/presence`,
        { user: teammateUserId },
      );
      expect(list.status).toBe(200);
      expect(list.body.viewers).toHaveLength(1);
      expect(list.body.viewers[0]).toMatchObject({ state: "replying" });

      // Ticket note accepts mentionPrincipalIds for a workspace teammate and rejects foreign principals.
      const okNote = await send(
        "POST",
        `/quills/${env.a}/tickets/${a.ticketId}/note`,
        {
          user: env.owner,
          body: {
            content: "Looping in @alice to inspect logs",
            mentionPrincipalIds: [a.teammateId],
          },
        },
      );
      expect(okNote.status).toBe(200);
      const mentions = await env.scoped(env.a, (db) =>
        db
          .select({ principalId: conversationMessageMentions.principalId })
          .from(conversationMessageMentions)
          .where(
            eq(
              conversationMessageMentions.conversationMessageId,
              okNote.body.id,
            ),
          ),
      );
      expect(mentions).toEqual([{ principalId: a.teammateId }]);

      const foreignMention = await send(
        "POST",
        `/quills/${env.a}/tickets/${a.ticketId}/note`,
        {
          user: env.owner,
          body: {
            content: "Trying foreign mention",
            mentionPrincipalIds: [b.teammateId],
          },
        },
      );
      expect(foreignMention.status).toBe(404);
    });
  },
);
