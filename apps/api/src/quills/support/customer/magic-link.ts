import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../../openapi";
import { principal, settings } from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
  requestAccessLinks,
} from "../../../database/quills/schema/conversation";
import { files } from "../../../database/quills/schema/files";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { createDownload } from "../../framework/files";
import {
  hashRequestLinkToken,
  verifyRequestLinkToken,
} from "../../framework/request-magic-link";
import {
  customerVisible,
  messageText,
  preview,
  type ConversationId,
  type PrincipalId,
} from "./model";
import { reopened } from "../conversation-ops";

const invalidLink = () =>
  new HTTPException(404, {
    message: "This request link has expired or been revoked",
  });

const tokenParams = z.object({
  token: z.string().min(20).max(512),
});

const linkFileParams = z.object({
  token: z.string().min(20).max(512),
  fileId: flexibleToTypeIdSchema("file"),
});

async function resolveMagicLinkConversation(
  db: Database,
  workspaceId: string,
  token: string,
  lock = false,
) {
  const claims = verifyRequestLinkToken(token, workspaceId);
  if (!claims || claims.resourceType !== "conversation") {
    throw invalidLink();
  }
  const tokenHash = hashRequestLinkToken(token);
  const linkQuery = db
    .select()
    .from(requestAccessLinks)
    .where(
      and(
        eq(requestAccessLinks.tokenHash, tokenHash),
        eq(requestAccessLinks.resourceType, "conversation"),
        eq(requestAccessLinks.resourceId, claims.resourceId),
        eq(requestAccessLinks.principalId, claims.principalId as PrincipalId),
        isNull(requestAccessLinks.revokedAt),
        gt(requestAccessLinks.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const [link] = await (lock ? linkQuery.for("update") : linkQuery);
  if (!link) throw invalidLink();

  const convQuery = db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, claims.resourceId as ConversationId),
        eq(conversations.visitorPrincipalId, claims.principalId as PrincipalId),
      ),
    )
    .limit(1);
  const [conversation] = await (lock ? convQuery.for("update") : convQuery);
  if (!conversation) throw invalidLink();

  const [visitor] = await db
    .select({ blockedAt: principal.blockedAt })
    .from(principal)
    .where(eq(principal.id, conversation.visitorPrincipalId))
    .limit(1);
  if (!visitor || visitor.blockedAt) throw invalidLink();

  return { link, conversation, claims };
}

const magicLinkMessageSchema = z.object({
  id: z.string(),
  fromVisitor: z.boolean(),
  senderType: z.enum(conversationMessages.senderType.enumValues),
  authorName: z.string().nullable(),
  content: z.string(),
  attachments: z.array(
    z.object({
      fileId: z.string().nullable(),
      name: z.string(),
      contentType: z.string(),
      size: z.number(),
      inline: z.boolean().optional(),
      downloadPath: z.string().nullable(),
    }),
  ),
  createdAt: responseTimestamp,
});

const magicLinkViewSchema = z.object({
  workspaceName: z.string(),
  conversation: z.object({
    id: z.string(),
    subject: z.string().nullable(),
    status: z.enum(conversations.status.enumValues),
    createdAt: responseTimestamp,
    updatedAt: nullableResponseTimestamp,
  }),
  messages: z.array(magicLinkMessageSchema),
});

/**
 * GET /quills-public/{workspace}/request-link/{token}
 * Read-only so email security scanners cannot invalidate or mutate anything.
 * Strictly returns ONLY the single bound conversation and its customer-visible sent messages.
 */
const getByMagicLink = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/request-link/{token}",
  operationId: "getQuillsRequestByMagicLink",
  summary: "Read a single support request via its signed magic link",
  description:
    "Strictly scoped to the single conversation bound to the token. Internal notes, scheduled/recalled drafts, and other customer requests are never exposed. Read-only so email link scanners cannot consume the link.",
  action: "read",
  cacheControl: "no-store",
  rateLimit: { limit: 60, windowSeconds: 60 },
  params: tokenParams,
  response: magicLinkViewSchema,
  responseDescription:
    "The bound conversation and its customer-visible messages",
  errors: { 404: "Invalid, expired, or revoked request link" },
  handler: async ({ db, workspaceId, params }) => {
    const { conversation } = await resolveMagicLinkConversation(
      db,
      workspaceId,
      params.token,
    );
    const [ws] = await db
      .select({ name: settings.name })
      .from(settings)
      .limit(1);
    const rows = await db
      .select({
        id: conversationMessages.id,
        senderType: conversationMessages.senderType,
        content: conversationMessages.content,
        attachments: conversationMessages.attachments,
        createdAt: conversationMessages.createdAt,
        authorName: principal.displayName,
      })
      .from(conversationMessages)
      .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          customerVisible,
        ),
      )
      .orderBy(
        asc(conversationMessages.createdAt),
        asc(conversationMessages.id),
      )
      .limit(200);

    return {
      workspaceName: ws?.name ?? "Support",
      conversation: {
        id: conversation.id,
        subject: conversation.subject,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: rows.map((row) => ({
        id: row.id,
        fromVisitor: row.senderType === "visitor",
        senderType: row.senderType,
        authorName: row.authorName ?? null,
        content: row.content,
        attachments: (row.attachments ?? []).map((att) => ({
          fileId: att.fileId ?? null,
          name: att.name,
          contentType: att.contentType,
          size: att.size,
          inline: att.inline,
          downloadPath: att.fileId
            ? `/api/quills-public/${encodeURIComponent(workspaceId)}/request-link/${encodeURIComponent(params.token)}/files/${encodeURIComponent(att.fileId)}`
            : null,
        })),
        createdAt: row.createdAt,
      })),
    };
  },
});

const replyByMagicLink = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/request-link/{token}/reply",
  operationId: "replyQuillsRequestByMagicLink",
  summary: "Reply to a single support request via its signed magic link",
  description:
    "Appends a customer reply to the single conversation bound to the token without requiring a portal password. Rate-limited per IP.",
  action: "create",
  rateLimit: { limit: 20, windowSeconds: 600 },
  params: tokenParams,
  body: z.object({ content: messageText }),
  response: z.object({
    message: magicLinkMessageSchema,
  }),
  responseDescription: "The created customer reply",
  errors: {
    404: "Invalid, expired, or revoked request link",
    429: "Too many replies; try again shortly",
  },
  event: (_input, result, raw) => ({
    type: "message.created",
    entityType: "conversation_message",
    entityId: result.message.id,
    payload: {
      conversationId:
        (raw as { conversationId?: string } | null)?.conversationId ?? "",
    },
  }),
  handler: async ({ db, workspaceId, params, body }) => {
    const { link, conversation } = await resolveMagicLinkConversation(
      db,
      workspaceId,
      params.token,
      true,
    );
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        principalId: conversation.visitorPrincipalId,
        senderType: "visitor",
        content: body.content,
        metadata: { source: "magic_link" },
      })
      .returning({
        id: conversationMessages.id,
        senderType: conversationMessages.senderType,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      });

    const reopen =
      conversation.status !== "open" && conversation.endReason !== "spam";
    const status = reopen ? ("open" as const) : conversation.status;
    await db
      .update(conversations)
      .set({
        ...(reopen && {
          status: "open" as const,
          snoozedUntil: null,
          resolvedAt: null,
          ...reopened(conversation, status),
        }),
        lastMessageAt: message!.createdAt,
        lastMessagePreview: preview(body.content),
        waitingSince: conversation.waitingSince ?? message!.createdAt,
        archivedAt: null,
        solutionOfferedAt: null,
        autoCloseAt: null,
        closeReminderSentAt: null,
        updatedAt: message!.createdAt,
      })
      .where(eq(conversations.id, conversation.id));

    await db
      .update(requestAccessLinks)
      .set({ lastOpenedAt: new Date() })
      .where(eq(requestAccessLinks.id, link.id));

    const [visitor] = await db
      .select({ displayName: principal.displayName })
      .from(principal)
      .where(eq(principal.id, conversation.visitorPrincipalId))
      .limit(1);

    return {
      conversationId: conversation.id,
      message: {
        id: message!.id,
        fromVisitor: true,
        senderType: message!.senderType,
        authorName: visitor?.displayName ?? null,
        content: message!.content,
        attachments: [],
        createdAt: message!.createdAt,
      },
    };
  },
});

const downloadMagicLinkFile = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/request-link/{token}/files/{fileId}",
  operationId: "downloadQuillsRequestLinkFile",
  summary: "Download an attachment from a magic-link request",
  description:
    "Strictly scoped to live, customer-visible, sent messages on the single conversation bound to the token.",
  action: "read",
  rateLimit: { limit: 60, windowSeconds: 60 },
  params: linkFileParams,
  response: z.object({
    storageKey: z.string(),
    name: z.string(),
    contentType: z.string(),
  }),
  responseDescription: "Redirect to a short-lived signed download URL",
  errors: { 404: "File or request link not found" },
  handler: async ({ db, workspaceId, params }) => {
    const { conversation } = await resolveMagicLinkConversation(
      db,
      workspaceId,
      params.token,
    );
    const [row] = await db
      .select({
        storageKey: files.storageKey,
        name: files.name,
        contentType: files.contentType,
      })
      .from(files)
      .innerJoin(
        conversationMessages,
        eq(conversationMessages.id, files.messageId),
      )
      .where(
        and(
          eq(files.id, params.fileId as TypeId<"file">),
          isNull(files.deletedAt),
          eq(conversationMessages.conversationId, conversation.id),
          customerVisible,
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "File not found" });
    return row;
  },
  location: async (file) => {
    const dl = await createDownload(file);
    return { url: dl.downloadUrl, maxAge: 0 };
  },
});

export default apiRouter()
  .openapi(...getByMagicLink)
  .openapi(...replyByMagicLink)
  .openapi(...downloadMagicLinkFile);
