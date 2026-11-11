import { and, desc, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { toUuid } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { auditLog } from "../../database/quills/schema/audit-log";
import { defineQuillsRoute } from "../framework/define-route";

// Metadata, before/after values, IP and user agent are never returned: imported
// rows may hold values that were not allowlisted when they were written.

const eventType = z.string().trim().min(1).max(100);

const listAuditEvents = defineQuillsRoute({
  method: "get",
  path: "/audit-events",
  operationId: "listQuillsAuditEvents",
  summary: "List Quills audit events, newest first",
  action: "manage_settings",
  query: z.object({
    eventType: eventType.optional(),
    exclude: z
      .string()
      .max(2000)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(eventType).max(20))
      .optional(),
    actorPrincipalId: flexibleToTypeIdSchema("principal").optional(),
    from: z.iso.datetime({ offset: true }).max(64).optional(),
    to: z.iso.datetime({ offset: true }).max(64).optional(),
    before: flexibleToTypeIdSchema("audit").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    events: z.array(
      z.object({
        id: z.string(),
        occurredAt: responseTimestamp,
        eventType: z.string(),
        eventOutcome: z.string(),
        actorPrincipalId: z.string().nullable(),
        actorType: z.string().nullable(),
        targetType: z.string().nullable(),
        targetId: z.string().nullable(),
        channel: z.string().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  responseDescription: "One page of audit events",
  errors: { 404: "Cursor not found" },
  handler: async ({ db, query }) => {
    if (query.before) {
      const [row] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.id, query.before))
        .limit(1);
      if (!row) throw new HTTPException(404, { message: "Cursor not found" });
    }
    const rows = await db
      .select({
        id: auditLog.id,
        occurredAt: auditLog.occurredAt,
        eventType: auditLog.eventType,
        eventOutcome: auditLog.eventOutcome,
        actorPrincipalId: auditLog.actorPrincipalId,
        actorType: auditLog.actorType,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        channel: auditLog.channel,
      })
      .from(auditLog)
      .where(
        and(
          query.eventType ? eq(auditLog.eventType, query.eventType) : undefined,
          query.exclude?.length
            ? notInArray(auditLog.eventType, query.exclude)
            : undefined,
          query.actorPrincipalId
            ? eq(auditLog.actorPrincipalId, query.actorPrincipalId)
            : undefined,
          query.from
            ? gte(auditLog.occurredAt, new Date(query.from))
            : undefined,
          query.to ? lte(auditLog.occurredAt, new Date(query.to)) : undefined,
          // Compared in SQL: a JavaScript Date would drop the microseconds.
          query.before
            ? sql`(${auditLog.occurredAt}, ${auditLog.id}) < (select c.occurred_at, c.id from ${auditLog} c where c.id = ${toUuid(query.before)}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(query.limit + 1);
    return {
      events: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...listAuditEvents,
);
