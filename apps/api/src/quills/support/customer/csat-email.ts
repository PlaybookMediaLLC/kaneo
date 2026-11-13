import { and, eq, gt, sql } from "drizzle-orm";
import { typeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../openapi";
import { conversations } from "../../../database/quills/schema/conversation";
import { kvStore } from "../../../database/quills/schema/kv";
import { hashToken } from "../../framework/audience";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { recordCsat, type ConversationId, type PrincipalId } from "./model";
import { portalPaths } from "../../portal/paths";

// CSAT over email (public, the token is the credential). The token format is the one of
// portal/unsubscribe-token.ts: 32 random bytes, only the SHA-256 hash stored, 30 days. A GET only
// checks the token, because mail scanners open every link; the rating needs a POST, which spends it.
// Like the unsubscribe preview, the GET carries the token in its query, so access logs can hold a
// token that can still rate until it is spent or expires.

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const keyOf = (token: string) => `support:csat-token:${hashToken(token)}`;
const claims = z.object({
  conversationId: typeIdSchema("conversation"),
  principalId: typeIdSchema("principal"),
});

/** Stores the hash of a new single-use rating token for the conversation's visitor, and returns the token. */
export async function mintCsatToken(
  db: Database,
  conversationId: ConversationId,
  principalId: PrincipalId,
) {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  await db.insert(kvStore).values({
    workspaceKey: "_",
    key: keyOf(token),
    value: { conversationId, principalId },
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

/**
 * The five rating links of a CSAT mail (rating 1 to 5), on the portal's rating page, as in the
 * source (`/csat?token=&rating=`). They share one token; the page checks it and POSTs the rating,
 * which spends it. Opening a link changes nothing, because mail scanners open every link.
 */
export const csatRatingUrls = (workspaceId: string, token: string) =>
  [1, 2, 3, 4, 5].map((rating) =>
    portalPaths.csat(workspaceId, token, rating),
  ) as [string, string, string, string, string];

/** The live token's conversation, still owned by the token's visitor, or undefined. */
async function liveClaims(db: Database, token: string, lock = false) {
  const query = db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, keyOf(token)),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  const parsed = claims.safeParse(row?.value);
  if (!parsed.success) return undefined;
  const conversationQuery = db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, parsed.data.conversationId),
        eq(conversations.visitorPrincipalId, parsed.data.principalId),
      ),
    )
    .limit(1);
  const [conversation] = await (lock
    ? conversationQuery.for("update")
    : conversationQuery);
  return conversation;
}

const token = z.string().min(20).max(200);

const validate = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/support/csat-email",
  operationId: "validateQuillsCsatEmailToken",
  summary: "Check a CSAT email link",
  description:
    "Read-only, so a mail scanner that opens the link cannot rate. valid is false for an unknown, used or expired token.",
  action: "read",
  query: z.object({ token }),
  response: z.object({ valid: z.boolean() }),
  responseDescription: "Whether the link can still rate",
  handler: async ({ db, query }) => ({
    valid: Boolean(await liveClaims(db, query.token)),
  }),
});

const record = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/support/csat-email",
  operationId: "recordQuillsCsatViaToken",
  summary: "Rate a conversation from a CSAT email link",
  description:
    "Spends the token. As in the widget, the first rating stays and a comment can be added once. recorded is false for an unknown, used or expired token.",
  action: "update",
  rateLimit: { limit: 20, windowSeconds: 600 },
  body: z.object({
    token,
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).optional(),
  }),
  response: z.object({
    recorded: z.boolean(),
    /** The token holder's own conversation; null when nothing was recorded. */
    conversationId: z.string().nullable(),
    rating: z.number().nullable(),
    changed: z.boolean(),
  }),
  responseDescription: "The outcome",
  event: (_input, result) =>
    result.changed &&
    result.conversationId !== null && {
      type: "conversation.csat_submitted",
      entityType: "conversation",
      entityId: result.conversationId,
      payload: { rating: String(result.rating), via: "email" },
    },
  handler: async ({ db, body }) => {
    const conversation = await liveClaims(db, body.token, true);
    if (!conversation)
      return {
        recorded: false,
        conversationId: null,
        rating: null,
        changed: false,
      };
    await db
      .delete(kvStore)
      .where(
        and(eq(kvStore.workspaceKey, "_"), eq(kvStore.key, keyOf(body.token))),
      );
    const result = await recordCsat(
      db,
      conversation,
      body.rating,
      body.comment,
    );
    return { recorded: true, ...result, conversationId: conversation.id };
  },
});

export default apiRouter()
  .openapi(...validate)
  .openapi(...record);
