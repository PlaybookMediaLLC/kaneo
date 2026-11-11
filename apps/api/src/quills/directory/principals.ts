import { and, asc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { workspaceMembers } from "../framework/platform-reads";
import { isCustomer } from "./customer";

// Teammates are Quills actors of current Kaneo members. Kaneo owns the roster and
// roles; these routes only read them. Removed members keep their actor for history.

const teammate = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  createdAt: responseTimestamp,
});
const teammateFields = {
  id: principal.id,
  userId: principal.kaneoUserId,
  name: principal.displayName,
  avatarUrl: principal.avatarUrl,
  createdAt: principal.createdAt,
};
const roster = ({ workspaceId }: { workspaceId: string }) =>
  workspaceMembers(workspaceId);
type Roster = Awaited<ReturnType<typeof roster>>;
const current = (members: Roster) =>
  and(
    isNotNull(principal.kaneoUserId),
    // A workspace with no members cannot be reached here; `inArray` needs one value.
    inArray(principal.kaneoUserId, members.map((m) => m.userId).concat("")),
  );
const withRole = (members: Roster) => {
  const roles = new Map(members.map((m) => [m.userId, m.role]));
  return <T extends { userId: string | null }>(row: T) => ({
    ...row,
    userId: row.userId!,
    role: roles.get(row.userId!)!,
  });
};

const listPrincipals = defineQuillsRoute({
  method: "get",
  path: "/principals",
  operationId: "listQuillsPrincipals",
  summary: "List teammates",
  description:
    "The Quills actors of current workspace members, with their workspace role. Manage the roster in the workspace member settings.",
  action: "read",
  query: z.object({
    search: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  }),
  load: roster,
  response: z.object({
    items: z.array(teammate),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of teammates",
  handler: async ({ db, query, loaded }) => {
    const rows = await db
      .select(teammateFields)
      .from(principal)
      .where(
        and(
          current(loaded),
          query.search
            ? ilike(principal.displayName, `%${query.search}%`)
            : undefined,
        ),
      )
      .orderBy(asc(principal.displayName), asc(principal.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit).map(withRole(loaded)),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const getPrincipal = defineQuillsRoute({
  method: "get",
  path: "/principals/{principalId}",
  operationId: "getQuillsPrincipal",
  summary: "Get a teammate",
  action: "read",
  params: z.object({ principalId: flexibleToTypeIdSchema("principal") }),
  load: roster,
  response: teammate,
  responseDescription: "The teammate",
  errors: { 404: "Teammate not found" },
  handler: async ({ db, params, loaded }) => {
    const [row] = await db
      .select(teammateFields)
      .from(principal)
      .where(and(eq(principal.id, params.principalId), current(loaded)))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Teammate not found" });
    return withRole(loaded)(row);
  },
});

const suggestMentions = defineQuillsRoute({
  method: "get",
  path: "/mentions/suggest",
  operationId: "listQuillsMentionSuggestions",
  summary: "Suggest people to @-mention",
  description:
    "Prefix match on the display name; email is never searched or returned. `scope=team` returns teammates only.",
  action: "read",
  query: z.object({
    q: z.string().trim().max(100).default(""),
    scope: z.enum(["all", "team"]).default("all"),
  }),
  load: roster,
  response: z.object({
    items: z.array(
      z.object({
        principalId: z.string(),
        displayName: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        teammate: z.boolean(),
      }),
    ),
  }),
  responseDescription: "Up to 10 people",
  handler: async ({ db, query, loaded }) => {
    const name = sql`coalesce(${principal.displayName}, ${user.name})`;
    const rows = await db
      .select({
        principalId: principal.id,
        displayName: name,
        avatarUrl: principal.avatarUrl,
        teammate: sql<boolean>`${principal.kaneoUserId} is not null`,
      })
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          query.scope === "team"
            ? current(loaded)
            : or(current(loaded), and(isCustomer, eq(principal.type, "user"))),
          query.q
            ? sql`lower(${name}) like ${`${query.q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`}`
            : undefined,
        ),
      )
      .orderBy(sql`lower(${name})`, asc(principal.id))
      .limit(10);
    return {
      items: rows.map((row) => ({
        ...row,
        displayName: row.displayName as string | null,
      })),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listPrincipals)
  .openapi(...getPrincipal)
  .openapi(...suggestMentions);
