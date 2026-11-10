import { and, asc, eq, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { postViews } from "../../database/quills/schema/post-views";
import { defineQuillsRoute } from "../framework/define-route";
import { page, pageQuery } from "./schemas";

// A saved view stores inbox filters; running it goes through the post list, which authorizes every post.
const SORTS = ["newest", "oldest", "votes", "priority"] as const;
const values = z.array(z.string().min(1).max(100)).max(50).optional();
const date = z.string().min(1).max(40).optional();
const filtersInput = z
  .object({
    status: values,
    board: values,
    tags: values,
    segmentIds: values,
    owner: z.string().min(1).max(64).optional(),
    responded: z.enum(["responded", "unresponded"]).optional(),
    minVotes: z.number().int().min(0).max(1000000).optional(),
    minComments: z.number().int().min(0).max(1000000).optional(),
    hasDuplicates: z.literal(true).optional(),
    showDeleted: z.literal(true).optional(),
    sort: z.enum(SORTS).optional(),
    dateFrom: date,
    dateTo: date,
    updatedBefore: date,
  })
  .strict();
const strings = z.array(z.string()).optional();
const view = z
  .object({
    id: z.string(),
    name: z.string(),
    isShared: z.boolean(),
    mine: z.boolean(),
    filters: z.object({
      status: strings,
      board: strings,
      tags: strings,
      segmentIds: strings,
      owner: z.string().optional(),
      responded: z.enum(["responded", "unresponded"]).optional(),
      minVotes: z.number().optional(),
      minComments: z.number().optional(),
      hasDuplicates: z.boolean().optional(),
      showDeleted: z.boolean().optional(),
      sort: z.enum(SORTS).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      updatedBefore: z.string().optional(),
    }),
  })
  .openapi("QuillsPostView");
const columns = {
  id: postViews.id,
  name: postViews.name,
  isShared: postViews.isShared,
  filters: postViews.filters,
  createdBy: postViews.createdByPrincipalId,
};
/** Shared views and the caller's own private views. */
const visibleTo = (principalId: PrincipalId) =>
  and(
    isNull(postViews.deletedAt),
    or(
      eq(postViews.isShared, true),
      eq(postViews.createdByPrincipalId, principalId),
    ),
  );
const toView = (
  {
    createdBy,
    ...row
  }: { createdBy: string | null } & Omit<z.input<typeof view>, "mine">,
  principalId: string,
) => ({ ...row, mine: createdBy === principalId });

const listViews = defineQuillsRoute({
  method: "get",
  path: "/post-views",
  operationId: "listQuillsPostViews",
  summary: "List saved post views",
  description: "Shared views and the caller's own private views, by name.",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({
    views: z.array(view),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of saved views",
  handler: async ({ db, actor, query }) => {
    const { items, nextOffset } = page(
      await db
        .select(columns)
        .from(postViews)
        .where(visibleTo(actor.principalId))
        .orderBy(asc(postViews.name), asc(postViews.id))
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    return {
      views: items.map((row) => toView(row, actor.principalId)),
      nextOffset,
    };
  },
});

const createView = defineQuillsRoute({
  method: "post",
  path: "/post-views",
  operationId: "createQuillsPostView",
  summary: "Save a post view",
  action: "create",
  body: z.object({
    name: z.string().trim().min(1).max(80),
    filters: filtersInput,
    isShared: z.boolean().optional(),
  }),
  response: view,
  responseDescription: "The saved view",
  event: (_input, result) => ({
    type: "post_view.created",
    entityType: "post_view",
    entityId: result.id,
  }),
  handler: async ({ db, actor, body }) => {
    const [row] = await db
      .insert(postViews)
      .values({
        name: body.name,
        filters: body.filters,
        isShared: body.isShared ?? true,
        createdByPrincipalId: actor.principalId,
      })
      .returning(columns);
    return toView(row!, actor.principalId);
  },
});

// Soft delete, so a removed view keeps its history. Another teammate's private view is not found.
const deleteView = defineQuillsRoute({
  method: "delete",
  path: "/post-views/{viewId}",
  operationId: "deleteQuillsPostView",
  summary: "Delete a saved post view",
  action: "delete",
  params: z.object({ viewId: flexibleToTypeIdSchema("post_view") }),
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted view",
  errors: { 404: "View not found" },
  event: ({ params }) => ({
    type: "post_view.deleted",
    entityType: "post_view",
    entityId: params.viewId,
  }),
  handler: async ({ db, actor, params }) => {
    const [row] = await db
      .update(postViews)
      .set({ deletedAt: new Date() })
      .where(and(eq(postViews.id, params.viewId), visibleTo(actor.principalId)))
      .returning({ id: postViews.id });
    if (!row) throw new HTTPException(404, { message: "View not found" });
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listViews)
  .openapi(...createView)
  .openapi(...deleteView);
