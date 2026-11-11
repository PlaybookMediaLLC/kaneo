import { eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { defineQuillsRoute } from "../framework/define-route";

const params = z.object({ principalId: flexibleToTypeIdSchema("principal") });
const status = z.object({
  principalId: z.string(),
  subscribed: z.boolean(),
  source: z.string().nullable(),
  unsubscribedAt: z.string().nullable(),
});
const errors = { 403: "Insufficient permission", 404: "Person not found" };

const getSubscriber = defineQuillsRoute({
  method: "get",
  path: "/changelog-subscribers/{principalId}",
  operationId: "getQuillsChangelogSubscriber",
  summary: "Get a person's changelog subscription",
  action: "read",
  params,
  response: status,
  responseDescription: "The person's changelog subscription",
  errors,
  handler: async ({ db, params }) => {
    const [row] = await db
      .select({
        id: principal.id,
        source: changelogSubscriptions.source,
        unsubscribedAt: changelogSubscriptions.unsubscribedAt,
      })
      .from(principal)
      .leftJoin(
        changelogSubscriptions,
        eq(changelogSubscriptions.principalId, principal.id),
      )
      .where(eq(principal.id, params.principalId));
    if (!row) throw new HTTPException(404, { message: "Person not found" });
    return {
      principalId: row.id,
      subscribed: row.source !== null && row.unsubscribedAt === null,
      source: row.source,
      unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
    };
  },
});

const setSubscriber = defineQuillsRoute({
  method: "put",
  path: "/changelog-subscribers/{principalId}",
  operationId: "setQuillsChangelogSubscriber",
  summary: "Subscribe or unsubscribe a person from the changelog",
  description:
    "An unsubscribe keeps the row and its source as the record of the opt-out.",
  action: "update",
  params,
  body: z.object({ subscribed: z.boolean() }),
  response: status,
  responseDescription: "The person's changelog subscription",
  errors,
  event: ({ params, body }) => ({
    type: "changelog.subscription_changed",
    entityType: "principal",
    entityId: params.principalId,
    payload: { subscribed: String(body.subscribed) },
  }),
  handler: async ({ db, params, body }) => {
    const [person] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, params.principalId));
    if (!person) throw new HTTPException(404, { message: "Person not found" });
    const unsubscribedAt = body.subscribed ? null : new Date();
    const [row] = await db
      .insert(changelogSubscriptions)
      .values({ principalId: person.id, source: "admin", unsubscribedAt })
      .onConflictDoUpdate({
        target: [
          changelogSubscriptions.workspaceId,
          changelogSubscriptions.principalId,
        ],
        set: { unsubscribedAt },
      })
      .returning({
        source: changelogSubscriptions.source,
        unsubscribedAt: changelogSubscriptions.unsubscribedAt,
      });
    return {
      principalId: person.id,
      subscribed: body.subscribed,
      source: row!.source,
      unsubscribedAt: row!.unsubscribedAt?.toISOString() ?? null,
    };
  },
});

const importSubscribers = defineQuillsRoute({
  method: "post",
  path: "/changelog-subscribers/import",
  operationId: "importQuillsChangelogSubscribers",
  summary: "Subscribe existing people to the changelog by email",
  description:
    "Matches existing customer accounts only and never creates one. A person who unsubscribed stays unsubscribed. The caller confirms consent before the import.",
  action: "manage_settings",
  body: z.object({
    emails: z.array(z.string().max(320)).min(1).max(5000),
  }),
  response: z.object({
    imported: z.number(),
    skipped: z.number(),
    total: z.number(),
  }),
  responseDescription: "Import counts",
  errors: { 403: "Insufficient permission" },
  event: ({ workspaceId }, result) => ({
    type: "changelog.subscribers_imported",
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
    const people = emails.length
      ? await db
          .select({ id: principal.id })
          .from(user)
          .innerJoin(principal, eq(principal.userId, user.id))
          .where(inArray(sql`lower(${user.email})`, emails))
      : [];
    const inserted = people.length
      ? await db
          .insert(changelogSubscriptions)
          .values(
            people.map((person) => ({
              principalId: person.id,
              source: "csv_import" as const,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: changelogSubscriptions.id })
      : [];
    return {
      imported: inserted.length,
      skipped: emails.length - inserted.length,
      total: emails.length,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSubscriber)
  .openapi(...setSubscriber)
  .openapi(...importSubscribers);
