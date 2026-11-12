import { asc } from "drizzle-orm";
import { apiRouter, pagingNumber, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { defineQuillsRoute } from "../framework/define-route";
import { boardVisible, loadProjects } from "../feedback/visibility";

const listBoards = defineQuillsRoute({
  audience: "app",
  capability: "read:feedback",
  method: "get",
  path: "/boards",
  operationId: "listQuillsAppBoards",
  summary: "List the boards that a sidebar app can file posts on",
  description: "Live boards that the key's owner can see, by name.",
  action: "read",
  query: z.object({
    offset: pagingNumber(0, 1000000, 0),
    limit: pagingNumber(1, 100, 100),
  }),
  response: z.object({
    items: z.array(
      z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of boards",
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => {
    const rows = await db
      .select({ id: boards.id, name: boards.name, slug: boards.slug })
      .from(boards)
      .where(boardVisible(projects))
      .orderBy(asc(boards.name), asc(boards.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...listBoards,
);
