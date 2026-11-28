import { and, desc, eq, isNull } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { requestAccessLinks } from "../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../framework/define-route";
import { mintRequestLinkToken } from "../framework/request-magic-link";
import { portalPaths } from "../portal/paths";
import {
  conversationParams,
  errors,
  findConversation,
  notFound,
} from "./conversation-model";
import { assertTeamVisible, resolveAllowedTeamIds } from "./team-scope";

const accessLinkItem = z.object({
  id: z.string(),
  resourceType: z.enum(["conversation", "ticket"]),
  resourceId: z.string(),
  expiresAt: responseTimestamp,
  revokedAt: nullableResponseTimestamp,
  lastOpenedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});

const linkParams = z.object({
  linkId: flexibleToTypeIdSchema("request_link"),
});

const listAccessLinks = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/access-links",
  operationId: "listQuillsConversationAccessLinks",
  summary: "List signed magic links issued for a conversation",
  action: "read",
  callerActions: true,
  params: conversationParams,
  response: z.object({ items: z.array(accessLinkItem) }),
  responseDescription: "Magic links for this conversation",
  errors,
  handler: async ({ db, workspaceId, actor, actions, params }) => {
    const allowedTeams = await resolveAllowedTeamIds(
      db,
      workspaceId,
      actor,
      actions,
    );
    const conversation = await findConversation(db, params.conversationId);
    assertTeamVisible(
      allowedTeams,
      conversation.assignedTeamId,
      "Conversation",
    );
    const items = await db
      .select({
        id: requestAccessLinks.id,
        resourceType: requestAccessLinks.resourceType,
        resourceId: requestAccessLinks.resourceId,
        expiresAt: requestAccessLinks.expiresAt,
        revokedAt: requestAccessLinks.revokedAt,
        lastOpenedAt: requestAccessLinks.lastOpenedAt,
        createdAt: requestAccessLinks.createdAt,
      })
      .from(requestAccessLinks)
      .where(
        and(
          eq(requestAccessLinks.resourceType, "conversation"),
          eq(requestAccessLinks.resourceId, conversation.id),
        ),
      )
      .orderBy(desc(requestAccessLinks.createdAt))
      .limit(50);
    return { items };
  },
});

const createAccessLink = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/access-links",
  operationId: "createQuillsConversationAccessLink",
  summary: "Mint a signed magic link for a conversation's requester",
  description:
    "Creates a single-conversation signed magic link valid for up to 90 days (default 30 days) that can be revoked immediately.",
  action: "update",
  params: conversationParams,
  body: z
    .object({
      ttlDays: z.number().int().min(1).max(90).default(30),
    })
    .default({ ttlDays: 30 }),
  response: z.object({
    link: accessLinkItem,
    token: z.string(),
    url: z.string(),
  }),
  responseDescription: "The newly minted magic link (token is returned once)",
  errors,
  event: {
    none: "Ephemeral magic-link token creation; revocations emit request_link.revoked",
  },
  handler: async ({ db, workspaceId, params, body }) => {
    const conversation = await findConversation(db, params.conversationId);
    const minted = mintRequestLinkToken({
      workspaceId,
      resourceType: "conversation",
      resourceId: conversation.id,
      principalId: conversation.visitorPrincipalId,
      ttlDays: body.ttlDays,
    });
    const [row] = await db
      .insert(requestAccessLinks)
      .values({
        tokenHash: minted.tokenHash,
        resourceType: "conversation",
        resourceId: conversation.id,
        principalId: conversation.visitorPrincipalId,
        expiresAt: minted.expiresAt,
      })
      .returning({
        id: requestAccessLinks.id,
        resourceType: requestAccessLinks.resourceType,
        resourceId: requestAccessLinks.resourceId,
        expiresAt: requestAccessLinks.expiresAt,
        revokedAt: requestAccessLinks.revokedAt,
        lastOpenedAt: requestAccessLinks.lastOpenedAt,
        createdAt: requestAccessLinks.createdAt,
      });
    return {
      link: row!,
      token: minted.token,
      url: portalPaths.requestLink(workspaceId, minted.token),
    };
  },
});

const revokeAccessLink = defineQuillsRoute({
  method: "post",
  path: "/access-links/{linkId}/revoke",
  operationId: "revokeQuillsAccessLink",
  summary: "Revoke a single magic link immediately",
  action: "update",
  params: linkParams,
  response: z.object({
    id: z.string(),
    conversationId: z.string(),
    revoked: z.literal(true),
    changed: z.boolean(),
  }),
  responseDescription: "Revocation result",
  errors,
  event: (_input, result) =>
    result.changed && {
      type: "request_link.revoked",
      entityType: "conversation",
      entityId: result.conversationId,
      payload: { linkId: result.id },
    },
  handler: async ({ db, params }) => {
    const [existing] = await db
      .select({
        id: requestAccessLinks.id,
        resourceId: requestAccessLinks.resourceId,
        revokedAt: requestAccessLinks.revokedAt,
      })
      .from(requestAccessLinks)
      .where(eq(requestAccessLinks.id, params.linkId))
      .limit(1);
    if (!existing) throw notFound("Access link");
    if (existing.revokedAt) {
      return {
        id: existing.id,
        conversationId: existing.resourceId,
        revoked: true as const,
        changed: false,
      };
    }
    await db
      .update(requestAccessLinks)
      .set({ revokedAt: new Date() })
      .where(eq(requestAccessLinks.id, existing.id));
    return {
      id: existing.id,
      conversationId: existing.resourceId,
      revoked: true as const,
      changed: true,
    };
  },
});

const revokeAllConversationAccessLinks = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/access-links/revoke-all",
  operationId: "revokeAllQuillsConversationAccessLinks",
  summary: "Revoke every active magic link for a conversation immediately",
  action: "update",
  params: conversationParams,
  response: z.object({
    conversationId: z.string(),
    revokedCount: z.number().int().min(0),
  }),
  responseDescription: "Number of links revoked",
  errors,
  event: ({ params }, result) =>
    result.revokedCount > 0 && {
      type: "request_link.revoked",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { revokedCount: String(result.revokedCount) },
    },
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    const updated = await db
      .update(requestAccessLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(requestAccessLinks.resourceType, "conversation"),
          eq(requestAccessLinks.resourceId, conversation.id),
          isNull(requestAccessLinks.revokedAt),
        ),
      )
      .returning({ id: requestAccessLinks.id });
    return {
      conversationId: conversation.id,
      revokedCount: updated.length,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listAccessLinks)
  .openapi(...createAccessLink)
  .openapi(...revokeAccessLink)
  .openapi(...revokeAllConversationAccessLinks);
