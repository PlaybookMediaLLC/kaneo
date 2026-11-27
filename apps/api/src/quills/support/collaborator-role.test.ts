import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { defaultRolePayloads } from "@kaneo/permissions";
import * as kaneo from "../../database/schema";
import { countWorkspaceSeats } from "../../billing/controllers/billable-seats";
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
import { side as seedFeedbackSide } from "../feedback/seed.fixture";

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
  "Free collaborator seats & internal-only enforcement (#328)",
  () => {
    let collaboratorUserId: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
      const env = contractEnv();

      // Seed workspace_role row for collaborator in workspace A (mirrors seedDefaultWorkspaceRoles).
      await env.db.insert(kaneo.workspaceRoleTable).values({
        workspaceId: env.a,
        role: "collaborator",
        permission: JSON.stringify(defaultRolePayloads.collaborator),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      collaboratorUserId = env.id("collab");
      await env.db.insert(kaneo.userTable).values({
        id: collaboratorUserId,
        name: "Eng Collaborator",
        email: `${collaboratorUserId}@example.test`,
        emailVerified: true,
      });
      await env.db.insert(kaneo.workspaceUserTable).values({
        id: env.id("collab_member"),
        workspaceId: env.a,
        userId: collaboratorUserId,
        role: "collaborator",
        joinedAt: new Date(),
      });
    }, 120000);
    afterAll(() => stopContract());

    it("excludes 50 added collaborators and viewers from billable seat counts", async () => {
      const env = contractEnv();
      const before = await countWorkspaceSeats(env.a, env.db);

      const now = new Date();
      const users = Array.from({ length: 50 }, (_, index) => {
        const uid = env.id(`collab_bulk_${index}`);
        return {
          id: uid,
          name: `Collaborator ${index}`,
          email: `${uid}@example.test`,
          emailVerified: true,
        };
      });
      await env.db.insert(kaneo.userTable).values(users);
      await env.db.insert(kaneo.workspaceUserTable).values(
        users.map((u, index) => ({
          id: env.id(`collab_bulk_m_${index}`),
          workspaceId: env.a,
          userId: u.id,
          role: index < 45 ? "collaborator" : "viewer",
          joinedAt: now,
        })),
      );

      const after = await countWorkspaceSeats(env.a, env.db);
      expect(after.billableSeats).toBe(before.billableSeats);
      expect(after.freeSeats).toBe(before.freeSeats + 50);
    });

    it("allows collaborators to post internal notes and blocks all customer-visible replies and comments", async () => {
      const env = contractEnv();
      const convIds = await seedConversation(env);
      const ticketIds = await seedTicketSide(env, env.a, env.owner);
      const feedbackIds = await seedFeedbackSide(env, env.a);

      // Collaborator CAN add internal note on conversation.
      const convNote = await send(
        "POST",
        `/quills/${env.a}/conversations/${convIds.a.conversationId}/note`,
        {
          user: collaboratorUserId,
          body: { content: "Engineering root cause note" },
        },
      );
      expect(convNote.status).toBe(200);
      expect(convNote.body.message.isInternal).toBe(true);

      // Collaborator CANNOT reply to customer on conversation.
      const convReply = await send(
        "POST",
        `/quills/${env.a}/conversations/${convIds.a.conversationId}/reply`,
        {
          user: collaboratorUserId,
          body: { content: "Should be blocked" },
        },
      );
      expect(convReply.status).toBe(403);

      // Collaborator CAN add internal note on ticket.
      const ticketNote = await send(
        "POST",
        `/quills/${env.a}/tickets/${ticketIds.ticketId}/note`,
        {
          user: collaboratorUserId,
          body: { content: "Internal ticket investigation" },
        },
      );
      expect(ticketNote.status).toBe(200);
      expect(ticketNote.body.isInternal).toBe(true);

      // Collaborator CANNOT reply to customer on ticket.
      const ticketReply = await send(
        "POST",
        `/quills/${env.a}/tickets/${ticketIds.ticketId}/reply`,
        {
          user: collaboratorUserId,
          body: { content: "Should be blocked" },
        },
      );
      expect(ticketReply.status).toBe(403);

      // Collaborator CAN post a private internal comment on a feedback post.
      const privateComment = await send(
        "POST",
        `/quills/${env.a}/posts/${feedbackIds.postId}/comments`,
        {
          user: collaboratorUserId,
          body: { content: "Internal feedback note", isPrivate: true },
        },
      );
      expect(privateComment.status).toBe(200);
      expect(privateComment.body.isPrivate).toBe(true);

      // Collaborator CANNOT post a customer-visible feedback comment (REST or MCP quills_add_comment).
      const publicComment = await send(
        "POST",
        `/quills/${env.a}/posts/${feedbackIds.postId}/comments`,
        {
          user: collaboratorUserId,
          body: { content: "Public leak attempt", isPrivate: false },
        },
      );
      expect(publicComment.status).toBe(403);
    });

    it("enforces team-scoped collaborator isolation across conversations, paired tickets, and search", async () => {
      const env = contractEnv();
      const { withQuillsSystemWorkspace } =
        await import("../../database/quills/client");
      const { teams, teamMembers } =
        await import("../../database/quills/schema/teams");
      const { conversations } =
        await import("../../database/quills/schema/conversation");
      const { principal } = await import("../../database/quills/schema/auth");
      const { eq } = await import("drizzle-orm");

      // Create two teams and assign the collaborator to Team A only.
      const convIds = await seedConversation(env);
      let teamBId!: string;
      await withQuillsSystemWorkspace(env.a, async (db) => {
        const [teamA] = await db
          .insert(teams)
          .values({ name: "Team Alpha", slug: `alpha-${Date.now()}` })
          .returning({ id: teams.id });
        const [teamB] = await db
          .insert(teams)
          .values({ name: "Team Beta", slug: `beta-${Date.now()}` })
          .returning({ id: teams.id });
        teamBId = teamB!.id;
        const [collabPrincipal] = await db
          .select({ id: principal.id })
          .from(principal)
          .where(eq(principal.kaneoUserId, collaboratorUserId))
          .limit(1);
        await db.insert(teamMembers).values({
          teamId: teamA!.id,
          principalId: collabPrincipal!.id,
        });
        await db
          .update(conversations)
          .set({
            assignedTeamId: teamBId,
            subject: "SecretBetaConversationUniqueToken",
          })
          .where(eq(conversations.id, convIds.a.conversationId as never));
      });

      // Team-A collaborator cannot read Team-B conversation or its paired ticket link.
      const convGet = await send(
        "GET",
        `/quills/${env.a}/conversations/${convIds.a.conversationId}`,
        { user: collaboratorUserId },
      );
      expect(convGet.status).toBe(404);

      const ticketLinkGet = await send(
        "GET",
        `/quills/${env.a}/conversations/${convIds.a.conversationId}/ticket`,
        { user: collaboratorUserId },
      );
      expect(ticketLinkGet.status).toBe(404);

      // Team-A collaborator cannot find Team-B conversation via global search.
      const searchRes = await send(
        "GET",
        `/quills/${env.a}/search?q=SecretBetaConversationUniqueToken&kind=conversation`,
        { user: collaboratorUserId },
      );
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.results).toEqual([]);
    });
  },
);
