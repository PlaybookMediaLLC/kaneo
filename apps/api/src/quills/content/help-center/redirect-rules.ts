import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { KbArticleId, KbCategoryId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  helpCenterArticles,
  helpCenterCategories,
  helpCenterRedirectRules,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";
import { page, pageQuery } from "../../feedback/schemas";
import { conflict, notFound, type Db } from "./shared";

const rule = z
  .object({
    id: z.string(),
    path: z.string(),
    targetType: z.enum(["article", "category"]),
    targetId: z.string(),
    targetLabel: z.string().nullable().openapi({
      description: "The target's title or name; null when the target is gone",
    }),
    createdAt: responseTimestamp,
  })
  .openapi("QuillsHelpCenterRedirectRule");
const columns = {
  id: helpCenterRedirectRules.id,
  path: helpCenterRedirectRules.path,
  targetType: helpCenterRedirectRules.targetType,
  targetId: helpCenterRedirectRules.targetId,
  createdAt: helpCenterRedirectRules.createdAt,
};
const path = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => value.startsWith("/"), "Path must start with /");

/** `/foo//bar/` and `/foo/bar` are the same rule. */
const normalize = (value: string) => {
  const collapsed = value.replace(/\/+/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
};

/** Titles and names of the rules' targets in this workspace. */
async function labels(
  db: Db,
  rows: { targetType: string; targetId: string }[],
) {
  const ids = (type: string) =>
    rows.filter((row) => row.targetType === type).map((row) => row.targetId);
  const articleIds = ids("article") as KbArticleId[];
  const categoryIds = ids("category") as KbCategoryId[];
  const found = [
    ...(articleIds.length
      ? await db
          .select({
            id: helpCenterArticles.id,
            label: helpCenterArticles.title,
          })
          .from(helpCenterArticles)
          .where(inArray(helpCenterArticles.id, articleIds))
      : []),
    ...(categoryIds.length
      ? await db
          .select({
            id: helpCenterCategories.id,
            label: helpCenterCategories.name,
          })
          .from(helpCenterCategories)
          .where(inArray(helpCenterCategories.id, categoryIds))
      : []),
  ];
  return new Map(found.map((row) => [String(row.id), row.label]));
}

const listRules = defineQuillsRoute({
  method: "get",
  path: "/help-center/redirect-rules",
  operationId: "listQuillsHelpCenterRedirectRules",
  summary: "List help-center redirect rules",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({
    rules: z.array(rule),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Rules, newest first",
  handler: async ({ db, query }) => {
    const { items, nextOffset } = page(
      await db
        .select(columns)
        .from(helpCenterRedirectRules)
        .orderBy(
          desc(helpCenterRedirectRules.createdAt),
          desc(helpCenterRedirectRules.id),
        )
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    const names = await labels(db, items);
    return {
      rules: items.map((row) => ({
        ...row,
        targetLabel: names.get(row.targetId) ?? null,
      })),
      nextOffset,
    };
  },
});

const createRule = defineQuillsRoute({
  method: "post",
  path: "/help-center/redirect-rules",
  operationId: "createQuillsHelpCenterRedirectRule",
  summary:
    "Redirect a help-center path to a published article or public category",
  action: "manage_settings",
  body: z.discriminatedUnion("targetType", [
    z.object({
      path,
      targetType: z.literal("article"),
      targetId: flexibleToTypeIdSchema("article"),
    }),
    z.object({
      path,
      targetType: z.literal("category"),
      targetId: flexibleToTypeIdSchema("kb_category"),
    }),
  ]),
  response: rule,
  responseDescription: "The created rule",
  errors: {
    404: "Article or category not found",
    409: "The path has a rule, or the target is not published",
  },
  event: (_input, result) => ({
    type: "help_center.redirect_rule_created",
    entityType: "redirect_rule",
    entityId: result.id,
    payload: { targetType: result.targetType, targetId: result.targetId },
  }),
  handler: async ({ db, body }) => {
    let label: string;
    if (body.targetType === "article") {
      const [target] = await db
        .select({
          title: helpCenterArticles.title,
          publishedAt: helpCenterArticles.publishedAt,
        })
        .from(helpCenterArticles)
        .where(
          and(
            eq(helpCenterArticles.id, body.targetId),
            isNull(helpCenterArticles.deletedAt),
          ),
        );
      if (!target) throw notFound("Article");
      if (!target.publishedAt)
        throw conflict("Redirect target must be a published article");
      label = target.title;
    } else {
      const [target] = await db
        .select({
          name: helpCenterCategories.name,
          isPublic: helpCenterCategories.isPublic,
        })
        .from(helpCenterCategories)
        .where(
          and(
            eq(helpCenterCategories.id, body.targetId),
            isNull(helpCenterCategories.deletedAt),
          ),
        );
      if (!target) throw notFound("Category");
      if (!target.isPublic)
        throw conflict("Redirect target must be a public category");
      label = target.name;
    }
    const value = normalize(body.path);
    const [row] = await db
      .insert(helpCenterRedirectRules)
      .values({
        path: value,
        targetType: body.targetType,
        targetId: body.targetId,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row) throw conflict(`A redirect rule for "${value}" already exists`);
    return { ...row, targetLabel: label };
  },
});

const deleteRule = defineQuillsRoute({
  method: "delete",
  path: "/help-center/redirect-rules/{ruleId}",
  operationId: "deleteQuillsHelpCenterRedirectRule",
  summary: "Delete a help-center redirect rule",
  action: "manage_settings",
  params: z.object({ ruleId: flexibleToTypeIdSchema("hc_redirect_rule") }),
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted rule",
  errors: { 404: "Redirect rule not found" },
  event: ({ params }) => ({
    type: "help_center.redirect_rule_deleted",
    entityType: "redirect_rule",
    entityId: params.ruleId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .delete(helpCenterRedirectRules)
      .where(eq(helpCenterRedirectRules.id, params.ruleId))
      .returning({ id: helpCenterRedirectRules.id });
    if (!row) throw notFound("Redirect rule");
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listRules)
  .openapi(...createRule)
  .openapi(...deleteRule);
