import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PrincipalId, TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import { principal, user } from "../../../database/quills/schema/auth";
import { statusSubscriptions } from "../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../framework/define-route";
import { conflict, notFound, type Db } from "./shared";

/** The most rows one export or one import handles. */
const BATCH_LIMIT = 5000;

const columns = {
  id: statusSubscriptions.id,
  principalId: statusSubscriptions.principalId,
  displayName: principal.displayName,
  email: user.email,
  scope: statusSubscriptions.scope,
  componentIds: statusSubscriptions.componentIds,
  source: statusSubscriptions.source,
  unsubscribedAt: statusSubscriptions.unsubscribedAt,
  createdAt: statusSubscriptions.createdAt,
};
const subscriber = z.object({
  id: z.string(),
  principalId: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  scope: z.enum(["page", "components"]),
  componentIds: z.array(z.string()),
  source: z.enum(["self_serve", "auto", "admin", "csv_import"]),
  unsubscribedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});
const joined = (db: Db) =>
  db
    .select(columns)
    .from(statusSubscriptions)
    .innerJoin(principal, eq(principal.id, statusSubscriptions.principalId))
    .leftJoin(user, eq(user.id, principal.userId));

const keys = sql`${statusSubscriptions.createdAt}, ${statusSubscriptions.id}`;
/** The rows after the cursor's row in the newest-first order. An unknown cursor matches nothing. */
export const afterCursor = (cursor: TypeId<"status_sub">) =>
  sql`(${keys}) < (select ${keys} from ${statusSubscriptions} where ${eq(statusSubscriptions.id, cursor)})`;

/** Subscribes each person to the whole page. A person who opted out stays out. Returns who is now subscribed. */
async function subscribeAll(
  db: Db,
  principalIds: PrincipalId[],
  source: "admin" | "csv_import",
) {
  if (!principalIds.length) return [];
  const rows = await db
    .insert(statusSubscriptions)
    .values(
      // Sorted, so two overlapping imports take the unique-index locks in one order.
      [...principalIds].sort().map((principalId) => ({
        principalId,
        scope: "page" as const,
        componentIds: [],
        source,
      })),
    )
    .onConflictDoUpdate({
      target: [
        statusSubscriptions.workspaceId,
        statusSubscriptions.principalId,
      ],
      set: { scope: "page", componentIds: [], updatedAt: new Date() },
      setWhere: isNull(statusSubscriptions.unsubscribedAt),
    })
    .returning({ principalId: statusSubscriptions.principalId });
  return rows.map((row) => row.principalId);
}

/** Existing customer accounts with these emails. Never creates one. */
async function peopleByEmail(db: Db, emails: string[]) {
  if (!emails.length) return [];
  const rows = await db
    .select({ id: principal.id })
    .from(user)
    .innerJoin(principal, eq(principal.userId, user.id))
    .where(inArray(sql`lower(${user.email})`, emails));
  return [...new Set(rows.map((row) => row.id))];
}

const listSubscribers = defineQuillsRoute({
  method: "get",
  path: "/status/subscribers",
  operationId: "listQuillsStatusSubscribers",
  summary: "List status subscribers with counts",
  description:
    "Newest first, unsubscribed people included. `search` matches the name or email.",
  action: "manage_settings",
  query: z.object({
    search: z.string().trim().min(1).max(200).optional(),
    cursor: flexibleToTypeIdSchema("status_sub").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  response: z.object({
    subscribers: z.array(subscriber),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    counts: z.object({
      total: z.number(),
      active: z.number(),
      unsubscribed: z.number(),
    }),
  }),
  responseDescription: "One page of subscribers",
  handler: async ({ db, query }) => {
    const conditions: (SQL | undefined)[] = [];
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(ilike(user.email, pattern), ilike(principal.displayName, pattern)),
      );
    }
    // A row comparison, so every page reads status_subscriptions_workspace_created_idx.
    if (query.cursor) conditions.push(afterCursor(query.cursor));
    const rows = await joined(db)
      .where(and(...conditions))
      .orderBy(
        desc(statusSubscriptions.createdAt),
        desc(statusSubscriptions.id),
      )
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${statusSubscriptions.unsubscribedAt} is null))::int`,
      })
      .from(statusSubscriptions);
    return {
      subscribers: items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      hasMore,
      counts: {
        total: counts!.total,
        active: counts!.active,
        unsubscribed: counts!.total - counts!.active,
      },
    };
  },
});

const exportSubscribers = defineQuillsRoute({
  method: "get",
  path: "/status/subscribers/export",
  operationId: "exportQuillsStatusSubscribers",
  summary: "Export every status subscriber for a CSV file",
  description: `Up to ${BATCH_LIMIT} rows. A larger list returns 409; page through the list route instead.`,
  action: "manage_settings",
  response: z.object({
    subscribers: z.array(
      z.object({
        displayName: z.string().nullable(),
        email: z.string().nullable(),
        scope: z.enum(["page", "components"]),
        componentCount: z.number(),
        source: z.enum(["self_serve", "auto", "admin", "csv_import"]),
        unsubscribedAt: nullableResponseTimestamp,
        createdAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "All subscribers, newest first",
  errors: { 409: `More than ${BATCH_LIMIT} subscribers` },
  handler: async ({ db }) => {
    const [total] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(statusSubscriptions);
    if (total!.n > BATCH_LIMIT)
      throw conflict(
        `More than ${BATCH_LIMIT} subscribers; page through the list instead`,
      );
    const rows = await joined(db)
      .orderBy(
        desc(statusSubscriptions.createdAt),
        desc(statusSubscriptions.id),
      )
      .limit(BATCH_LIMIT);
    return {
      subscribers: rows.map((row) => ({
        displayName: row.displayName,
        email: row.email,
        scope: row.scope,
        componentCount: row.componentIds.length,
        source: row.source,
        unsubscribedAt: row.unsubscribedAt,
        createdAt: row.createdAt,
      })),
    };
  },
});

const addSubscriber = defineQuillsRoute({
  method: "post",
  path: "/status/subscribers",
  operationId: "addQuillsStatusSubscriber",
  summary: "Subscribe an existing customer to the status page by email",
  description:
    "Never creates an account. `subscribed: false` means the person opted out and stays out.",
  action: "manage_settings",
  body: z.object({ email: z.email().max(320) }),
  response: z.object({ principalId: z.string(), subscribed: z.boolean() }),
  responseDescription: "The person and whether they are subscribed",
  errors: { 404: "No customer has that email" },
  event: (_input, result) => ({
    type: "status.subscriber_added",
    entityType: "principal",
    entityId: result.principalId,
    payload: { subscribed: String(result.subscribed) },
  }),
  handler: async ({ db, body }) => {
    const [person] = await peopleByEmail(db, [body.email.trim().toLowerCase()]);
    if (!person) throw notFound("Customer");
    const subscribed = await subscribeAll(db, [person], "admin");
    return { principalId: person, subscribed: subscribed.length > 0 };
  },
});

const importSubscribers = defineQuillsRoute({
  method: "post",
  path: "/status/subscribers/import",
  operationId: "importQuillsStatusSubscribers",
  summary: "Subscribe existing customers to the status page by email",
  description: `Up to ${BATCH_LIMIT} emails; a larger file is rejected whole. Matches existing customer accounts only. People who opted out stay out. The caller confirms consent first.`,
  action: "manage_settings",
  body: z.object({
    emails: z.array(z.string().max(320)).min(1).max(BATCH_LIMIT),
  }),
  response: z.object({
    imported: z.number(),
    skipped: z.number(),
    optedOut: z.number(),
    total: z.number(),
  }),
  responseDescription: "Import counts",
  event: ({ workspaceId }, result) => ({
    type: "status.subscribers_imported",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { imported: String(result.imported) },
  }),
  handler: async ({ db, body }) => {
    const emails = [
      ...new Set(
        body.emails.map((email) => email.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    const people = await peopleByEmail(db, emails);
    const imported = (await subscribeAll(db, people, "csv_import")).length;
    const optedOut = people.length - imported;
    return {
      imported,
      skipped: emails.length - imported - optedOut,
      optedOut,
      total: emails.length,
    };
  },
});

const removeSubscriber = defineQuillsRoute({
  method: "delete",
  path: "/status/subscribers/{principalId}",
  operationId: "removeQuillsStatusSubscriber",
  summary: "Unsubscribe a person from the status page",
  description:
    "Keeps the row as the record of the opt-out. `removed: false` means the person was not subscribed.",
  action: "manage_settings",
  params: z.object({ principalId: flexibleToTypeIdSchema("principal") }),
  response: z.object({ principalId: z.string(), removed: z.boolean() }),
  responseDescription: "Whether the request unsubscribed the person",
  errors: { 404: "Person not found" },
  event: (_input, result) => ({
    type: "status.subscriber_removed",
    entityType: "principal",
    entityId: result.principalId,
    payload: { removed: String(result.removed) },
  }),
  handler: async ({ db, params }) => {
    const [person] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, params.principalId));
    if (!person) throw notFound("Person");
    const rows = await db
      .update(statusSubscriptions)
      .set({ unsubscribedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(statusSubscriptions.principalId, person.id),
          isNull(statusSubscriptions.unsubscribedAt),
        ),
      )
      .returning({ id: statusSubscriptions.id });
    return { principalId: person.id, removed: rows.length > 0 };
  },
});

// Static /status/subscribers/export mounts before the parameter route.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...exportSubscribers)
  .openapi(...listSubscribers)
  .openapi(...addSubscriber)
  .openapi(...importSubscribers)
  .openapi(...removeSubscriber);
