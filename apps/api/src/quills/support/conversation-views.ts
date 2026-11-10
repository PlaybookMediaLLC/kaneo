import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversationTags } from "../../database/quills/schema/conversation";
import {
  conversationViewPins,
  conversationViews,
} from "../../database/quills/schema/conversation-views";
import { teams } from "../../database/quills/schema/teams";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import { errors, notFound, priorities, statuses } from "./conversation-model";

// Saved inbox views: workspace-shared by default, or private to their creator. Pins are personal.

const viewParams = z.object({
  viewId: flexibleToTypeIdSchema("conversation_view"),
});
const id = z.string().min(1).max(64);
const rule = z.discriminatedUnion("field", [
  z.object({ field: z.literal("status"), value: z.enum(statuses) }),
  z.object({ field: z.literal("priority"), value: z.enum(priorities) }),
  z.object({ field: z.literal("assignee"), value: id }),
  z.object({ field: z.literal("team"), value: id }),
  z.object({ field: z.literal("tag"), value: id }),
  z.object({ field: z.literal("source"), value: z.string().min(1).max(32) }),
  z.object({ field: z.literal("waiting"), value: z.literal(true) }),
  z.object({
    field: z.literal("kind"),
    value: z.enum(["conversation", "ticket"]),
  }),
  z.object({
    field: z.literal("ticket_type"),
    value: z.enum(["customer", "back_office", "tracker"]),
  }),
  z.object({
    field: z.literal("ticket_status_category"),
    value: z.enum(["open", "pending", "closed"]),
  }),
  z.object({
    field: z.literal("ticket_stage"),
    value: z.string().min(1).max(64),
  }),
  z.object({
    field: z.literal("attribute"),
    key: z.string().trim().min(1).max(100),
    operator: z.enum([
      "eq",
      "neq",
      "contains",
      "not_contains",
      "gt",
      "gte",
      "lt",
      "lte",
      "includes_any",
      "excludes_all",
      "is_set",
      "is_empty",
    ]),
    value: z
      .union([
        z.string().max(500),
        z.number(),
        z.boolean(),
        z.array(z.string().max(200)).max(50),
      ])
      .optional(),
  }),
]);
const filters = z.object({ rules: z.array(rule).max(15) });
// A view saves a filter set, not a search term; the sorts are the list's own.
const sort = z.enum(["recent", "oldest", "created", "waiting", "priority"]);
/** The stored rules as one closed shape: `key` and `operator` only on attribute rules. */
const ruleOut = z.object({
  field: z.string(),
  key: z.string().optional(),
  operator: z.string().optional(),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .optional(),
});
const view = z.object({
  id: z.string(),
  name: z.string(),
  filters: z.object({ rules: z.array(ruleOut) }),
  sort: sort.nullable(),
  isShared: z.boolean(),
  isPinned: z.boolean(),
  createdByPrincipalId: z.string().nullable(),
});

/** Shared views and the caller's own private ones. */
const visible = (actor: QuillsActor) =>
  and(
    isNull(conversationViews.deletedAt),
    or(
      eq(conversationViews.isShared, true),
      eq(conversationViews.createdByPrincipalId, actor.principalId),
    ),
  );

async function loadViews(
  db: Database,
  actor: QuillsActor,
  viewId?: TypeId<"conversation_view">,
) {
  const rows = await db
    .select({
      id: conversationViews.id,
      name: conversationViews.name,
      filters: conversationViews.filters,
      sort: conversationViews.sort,
      isShared: conversationViews.isShared,
      createdByPrincipalId: conversationViews.createdByPrincipalId,
      isPinned: sql<boolean>`(${conversationViewPins.viewId} is not null)`,
    })
    .from(conversationViews)
    .leftJoin(
      conversationViewPins,
      and(
        eq(conversationViewPins.viewId, conversationViews.id),
        eq(conversationViewPins.principalId, actor.principalId),
      ),
    )
    .where(and(visible(actor), viewId && eq(conversationViews.id, viewId)))
    .orderBy(
      desc(sql`(${conversationViewPins.viewId} is not null)`),
      asc(conversationViews.name),
    )
    .limit(500);
  // Rows written before this API may not fit the rule schema: they read with no rules.
  return rows.map((row) => ({
    ...row,
    filters: filters.safeParse(row.filters).data ?? { rules: [] },
    sort: sort.safeParse(row.sort).data ?? null,
  }));
}

async function findView(
  db: Database,
  actor: QuillsActor,
  viewId: TypeId<"conversation_view">,
) {
  const [row] = await loadViews(db, actor, viewId);
  if (!row) throw notFound("View");
  return row;
}

/** Tag, team and assignee rule values must name records of this workspace. */
async function checkRules(db: Database, input: z.output<typeof filters>) {
  const values = (field: string) =>
    input.rules.flatMap((r) => (r.field === field ? [r.value as string] : []));
  const parsed = <P extends "conversation_tag" | "team" | "principal">(
    prefix: P,
    list: string[],
  ) =>
    list.map((value) => {
      const result = flexibleToTypeIdSchema(prefix).safeParse(value);
      if (!result.success) throw notFound("Rule value");
      return result.data;
    });
  const tagIds = parsed("conversation_tag", values("tag"));
  const teamIds = parsed("team", values("team"));
  const people = parsed(
    "principal",
    values("assignee").filter((v) => v !== "me" && v !== "unassigned"),
  );
  const count = async (found: { id: string }[], wanted: string[]) => {
    if (new Set(found.map((row) => row.id)).size !== new Set(wanted).size)
      throw notFound("Rule value");
  };
  if (tagIds.length)
    await count(
      await db
        .select({ id: conversationTags.id })
        .from(conversationTags)
        .where(
          and(
            inArray(conversationTags.id, tagIds),
            isNull(conversationTags.deletedAt),
          ),
        ),
      tagIds,
    );
  if (teamIds.length)
    await count(
      await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, teamIds), isNull(teams.deletedAt))),
      teamIds,
    );
  if (people.length)
    await count(
      await db
        .select({ id: principal.id })
        .from(principal)
        .where(
          and(inArray(principal.id, people), isNotNull(principal.kaneoUserId)),
        ),
      people,
    );
}

const viewEvent =
  (type: "conversation_view.updated" | "conversation_view.deleted") =>
  ({ params }: { params: { viewId: string } }) => ({
    type,
    entityType: "conversation_view" as const,
    entityId: params.viewId,
  });

const listViews = defineQuillsRoute({
  method: "get",
  path: "/conversation-views",
  operationId: "listQuillsConversationViews",
  summary: "List saved inbox views",
  description:
    "Shared views and your own private ones, pinned first, then by name.",
  action: "read",
  response: z.object({ items: z.array(view) }),
  responseDescription: "Views",
  errors,
  handler: async ({ db, actor }) => ({ items: await loadViews(db, actor) }),
});

const createView = defineQuillsRoute({
  method: "post",
  path: "/conversation-views",
  operationId: "createQuillsConversationView",
  summary: "Save an inbox view",
  description:
    "At most 15 rules. Tag, team and teammate rule values must exist in this workspace (404 otherwise). Shared unless isShared is false.",
  action: "create",
  body: z.object({
    name: z.string().trim().min(1).max(80),
    filters,
    sort: sort.nullable().default(null),
    isShared: z.boolean().default(true),
  }),
  response: view,
  responseDescription: "View",
  errors,
  event: (_input, result) => ({
    type: "conversation_view.created",
    entityType: "conversation_view",
    entityId: result.id,
  }),
  handler: async ({ db, actor, body }) => {
    await checkRules(db, body.filters);
    const [row] = await db
      .insert(conversationViews)
      .values({
        name: body.name,
        filters: body.filters,
        sort: body.sort,
        isShared: body.isShared,
        createdByPrincipalId: actor.principalId,
      })
      .returning({ id: conversationViews.id });
    return findView(db, actor, row!.id);
  },
});

const updateView = defineQuillsRoute({
  method: "patch",
  path: "/conversation-views/{viewId}",
  operationId: "updateQuillsConversationView",
  summary: "Change a saved inbox view",
  description:
    "A private view is visible to, and changed by, its creator only.",
  action: "update",
  params: viewParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      filters: filters.optional(),
      sort: sort.nullable().optional(),
      isShared: z.boolean().optional(),
    })
    .refine((b) => Object.values(b).some((v) => v !== undefined), {
      message: "Provide at least one field",
    }),
  response: view,
  responseDescription: "View",
  errors,
  event: viewEvent("conversation_view.updated"),
  handler: async ({ db, actor, params, body }) => {
    const current = await findView(db, actor, params.viewId);
    if (body.filters) await checkRules(db, body.filters);
    await db
      .update(conversationViews)
      .set({
        name: body.name,
        filters: body.filters,
        sort: body.sort,
        isShared: body.isShared,
      })
      .where(eq(conversationViews.id, current.id));
    return findView(db, actor, current.id);
  },
});

const deleteView = defineQuillsRoute({
  method: "delete",
  path: "/conversation-views/{viewId}",
  operationId: "deleteQuillsConversationView",
  summary: "Delete a saved inbox view",
  description: "Soft delete; every teammate's pin of it is removed.",
  action: "delete",
  params: viewParams,
  response: z.object({ id: z.string() }),
  responseDescription: "Deleted view",
  errors,
  event: viewEvent("conversation_view.deleted"),
  handler: async ({ db, actor, params }) => {
    const current = await findView(db, actor, params.viewId);
    await db
      .update(conversationViews)
      .set({ deletedAt: new Date() })
      .where(eq(conversationViews.id, current.id));
    await db
      .delete(conversationViewPins)
      .where(eq(conversationViewPins.viewId, current.id));
    return { id: current.id };
  },
});

const pin = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    method,
    path: "/conversation-views/{viewId}/pin",
    operationId:
      method === "put"
        ? "pinQuillsConversationView"
        : "unpinQuillsConversationView",
    summary: method === "put" ? "Pin a saved view" : "Unpin a saved view",
    description: "Pins are personal to the caller. Idempotent.",
    action: "update",
    params: viewParams,
    response: view,
    responseDescription: "View",
    errors,
    event: {
      none: "A personal pin: no other teammate's view or data changes.",
    },
    handler: async ({ db, actor, params }) => {
      const current = await findView(db, actor, params.viewId);
      if (method === "put")
        await db
          .insert(conversationViewPins)
          .values({ principalId: actor.principalId, viewId: current.id })
          .onConflictDoNothing();
      else
        await db
          .delete(conversationViewPins)
          .where(
            and(
              eq(conversationViewPins.principalId, actor.principalId),
              eq(conversationViewPins.viewId, current.id),
            ),
          );
      return findView(db, actor, current.id);
    },
  });

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listViews)
  .openapi(...createView)
  .openapi(...updateView)
  .openapi(...deleteView)
  .openapi(...pin("put"))
  .openapi(...pin("delete"));
