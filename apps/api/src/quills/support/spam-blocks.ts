import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  SPAM_BLOCK_KINDS,
  spamBlocks,
} from "../../database/quills/schema/spam-blocks";
import { normalizeCidr, normalizeEmailDomain } from "../framework/anti-spam";
import { defineQuillsRoute } from "../framework/define-route";

// Workspace-scoped spam blocklist CRUD (#320): block IPv4/IPv6 CIDR ranges, email domains,
// or individual visitor principals from writing to widget/portal/email surfaces.

const spamBlockSchema = z.object({
  id: z.string(),
  kind: z.enum(SPAM_BLOCK_KINDS),
  value: z.string(),
  reason: z.string().nullable(),
  createdByPrincipalId: z.string().nullable(),
  expiresAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});

const listBlocks = defineQuillsRoute({
  method: "get",
  path: "/support/spam-blocks",
  operationId: "listQuillsSpamBlocks",
  summary: "List active workspace spam blocks",
  action: "read",
  query: z.object({
    kind: z.enum(SPAM_BLOCK_KINDS).optional(),
  }),
  response: z.object({
    items: z.array(spamBlockSchema),
  }),
  responseDescription:
    "Active spam blocks (CIDR ranges, email domains, visitors)",
  handler: async ({ db, query }) => {
    const live = or(
      isNull(spamBlocks.expiresAt),
      gt(spamBlocks.expiresAt, sql`now()`),
    );
    const rows = await db
      .select({
        id: spamBlocks.id,
        kind: spamBlocks.kind,
        value: spamBlocks.value,
        reason: spamBlocks.reason,
        createdByPrincipalId: spamBlocks.createdByPrincipalId,
        expiresAt: spamBlocks.expiresAt,
        createdAt: spamBlocks.createdAt,
      })
      .from(spamBlocks)
      .where(
        and(live, query.kind ? eq(spamBlocks.kind, query.kind) : undefined),
      )
      .orderBy(desc(spamBlocks.createdAt))
      .limit(500);
    return { items: rows };
  },
});

const createBlock = defineQuillsRoute({
  method: "post",
  path: "/support/spam-blocks",
  operationId: "createQuillsSpamBlock",
  summary: "Create or update a workspace spam block",
  description:
    "Blocks an IPv4/IPv6 CIDR range (e.g. 203.0.113.0/24), an email domain (e.g. spammer.example), or a visitor principal.",
  action: "update",
  body: z.object({
    kind: z.enum(SPAM_BLOCK_KINDS),
    value: z.string().trim().min(1).max(255),
    reason: z.string().trim().max(500).nullable().optional(),
    expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  }),
  response: spamBlockSchema,
  responseDescription: "The created or updated spam block",
  errors: {
    400: "Invalid CIDR, email domain, or visitor principal",
    404: "Visitor principal not found",
  },
  event: (_input, result) => ({
    type: "spam_block.created",
    entityType: "spam_block",
    entityId: result.id,
    payload: { kind: result.kind, value: result.value },
  }),
  handler: async ({ db, actor, body }) => {
    let normalized: string | null = null;
    if (body.kind === "ip_cidr") {
      normalized = normalizeCidr(body.value);
      if (!normalized) {
        throw new HTTPException(400, {
          message: "Invalid IP address or CIDR range",
        });
      }
    } else if (body.kind === "email_domain") {
      normalized = normalizeEmailDomain(body.value);
      if (!normalized) {
        throw new HTTPException(400, {
          message: "Invalid email domain",
        });
      }
    } else {
      const parsedId = flexibleToTypeIdSchema("principal").safeParse(
        body.value,
      );
      if (!parsedId.success) {
        throw new HTTPException(400, {
          message: "Invalid visitor principal ID",
        });
      }
      const [visitor] = await db
        .select({ id: principal.id })
        .from(principal)
        .where(
          and(eq(principal.id, parsedId.data), isNull(principal.kaneoUserId)),
        )
        .limit(1);
      if (!visitor) {
        throw new HTTPException(404, {
          message: "Visitor principal not found",
        });
      }
      normalized = visitor.id;
    }

    const expiresAt =
      body.expiresInDays === null
        ? null
        : new Date(
            Date.now() + (body.expiresInDays ?? 30) * 24 * 60 * 60 * 1000,
          );

    const [row] = await db
      .insert(spamBlocks)
      .values({
        kind: body.kind,
        value: normalized,
        reason: body.reason ?? null,
        createdByPrincipalId: actor.principalId,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [spamBlocks.workspaceId, spamBlocks.kind, spamBlocks.value],
        set: {
          reason: body.reason ?? null,
          expiresAt,
          createdByPrincipalId: actor.principalId,
        },
      })
      .returning({
        id: spamBlocks.id,
        kind: spamBlocks.kind,
        value: spamBlocks.value,
        reason: spamBlocks.reason,
        createdByPrincipalId: spamBlocks.createdByPrincipalId,
        expiresAt: spamBlocks.expiresAt,
        createdAt: spamBlocks.createdAt,
      });

    return row!;
  },
});

const deleteBlock = defineQuillsRoute({
  method: "delete",
  path: "/support/spam-blocks/{blockId}",
  operationId: "deleteQuillsSpamBlock",
  summary: "Remove a workspace spam block",
  action: "update",
  params: z.object({
    blockId: z.string().uuid(),
  }),
  response: z.object({ deleted: z.literal(true), id: z.string() }),
  responseDescription: "The removed spam block",
  errors: { 404: "Spam block not found" },
  event: ({ params }) => ({
    type: "spam_block.deleted",
    entityType: "spam_block",
    entityId: params.blockId,
  }),
  handler: async ({ db, params }) => {
    const [deleted] = await db
      .delete(spamBlocks)
      .where(eq(spamBlocks.id, params.blockId))
      .returning({ id: spamBlocks.id });
    if (!deleted) {
      throw new HTTPException(404, { message: "Spam block not found" });
    }
    return { deleted: true as const, id: deleted.id };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listBlocks)
  .openapi(...createBlock)
  .openapi(...deleteBlock);
