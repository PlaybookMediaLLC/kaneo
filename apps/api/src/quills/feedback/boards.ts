import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import type { TypeId } from "@kaneo/ids";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { segments } from "../../database/quills/schema/segments";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  boardVisible,
  findBoard,
  loadProjects,
  notTestPrincipal,
} from "./visibility";

const tiers = ["anonymous", "authenticated", "segments", "team"] as const;
const rank = { anonymous: 0, authenticated: 1, segments: 2, team: 3 };
const actions = ["view", "vote", "comment", "submit"] as const;
const tier = z.enum(tiers);
const rule = z.enum(["inherit", "on", "off"]);
const replyPolicy = z.enum(["anyone", "author-only"]).optional();

const accessShape = <S extends z.ZodType>(segmentIds: S) =>
  z.object({
    view: tier,
    vote: tier,
    comment: tier,
    submit: tier,
    segments: z.object({
      view: segmentIds,
      vote: segmentIds,
      comment: segmentIds,
      submit: segmentIds,
    }),
    moderation: z.object({
      anonPosts: rule,
      signedPosts: rule,
      comments: rule,
    }),
    replyPolicy,
  });

// The source's invariants: no action is more open than view, and a segments tier names a segment.
const accessInput = accessShape(
  z.array(flexibleToTypeIdSchema("segment")).max(50),
).superRefine((access, ctx) => {
  for (const action of actions) {
    if (rank[access[action]] < rank[access.view])
      ctx.addIssue({
        code: "custom",
        path: [action],
        message: `The ${action} tier cannot be more open than view`,
      });
    if (access[action] === "segments" && !access.segments[action].length)
      ctx.addIssue({
        code: "custom",
        path: ["segments", action],
        message: `Pick at least one segment for ${action}`,
      });
  }
});

const board = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  access: accessShape(z.array(z.string())),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  postCount: z.number().optional(),
});
const columns = {
  id: boards.id,
  name: boards.name,
  slug: boards.slug,
  description: boards.description,
  access: boards.access,
  createdAt: boards.createdAt,
  updatedAt: boards.updatedAt,
};
type Access = Partial<z.output<typeof board>["access"]> | null;
const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T) =>
  schema.safeParse(value).data ?? fallback;
const idsOf = (value: unknown) =>
  Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
/**
 * The source's read normalization: rows older than vote, comment and moderation get
 * their defaults. An imported value outside the enums gets the default too, so one
 * old row cannot fail a whole list.
 */
const view = <R extends { access: Access }>(row: R) => {
  const a = row.access ?? {};
  const view = pick(tier, a.view, "team");
  const submit = pick(tier, a.submit, view);
  const reply = pick(replyPolicy, a.replyPolicy, undefined);
  return {
    ...row,
    access: {
      view,
      vote: pick(tier, a.vote, submit),
      comment: pick(tier, a.comment, submit),
      submit,
      segments: {
        view: idsOf(a.segments?.view),
        vote: idsOf(a.segments?.vote),
        comment: idsOf(a.segments?.comment),
        submit: idsOf(a.segments?.submit),
      },
      moderation: {
        anonPosts: pick(rule, a.moderation?.anonPosts, "inherit"),
        signedPosts: pick(rule, a.moderation?.signedPosts, "inherit"),
        comments: pick(rule, a.moderation?.comments, "inherit"),
      },
      ...(reply && { replyPolicy: reply }),
    },
  };
};
const boardParams = z.object({ boardId: flexibleToTypeIdSchema("board") });
const name = z.string().trim().min(1).max(100);
const slug = z
  .string()
  .max(100)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and single hyphens",
  );
const description = z.string().trim().max(500);
const errors = { 404: "Board or segment not found", 409: "Slug already taken" };

/** ASCII slug of a name. Non-Latin names fall back to "board"; the source transliterates them. */
const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "") || "board";

const slugTaken = async (
  db: Database,
  value: string,
  except?: TypeId<"board">,
) =>
  (
    await db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.slug, value), except && ne(boards.id, except)))
      .limit(1)
  ).length > 0;

/** A slug taken between the check and the write is the declared 409, not a 500. */
const slugConflict = (error: unknown): never => {
  const failure = error as { code?: string; cause?: { code?: string } };
  if ((failure.cause?.code ?? failure.code) === "23505")
    throw new HTTPException(409, { message: "Board slug is taken" });
  throw error;
};

/** The base slug, or the first free `base-n`. Soft-deleted boards keep their slugs. */
async function freeSlug(db: Database, base: string) {
  for (let n = 0; n < 50; n++) {
    const candidate = n ? `${base.slice(0, 95).replace(/-+$/, "")}-${n}` : base;
    if (!(await slugTaken(db, candidate))) return candidate;
  }
  throw new HTTPException(409, { message: "Board slug is taken" });
}

/** Every segment of an access matrix exists in this workspace. */
async function checkSegments(
  db: Database,
  access?: z.output<typeof accessInput>,
) {
  const ids = [
    ...new Set(actions.flatMap((action) => access?.segments[action] ?? [])),
  ];
  if (!ids.length) return;
  const found = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(inArray(segments.id, ids), isNull(segments.deletedAt)));
  if (found.length !== ids.length)
    throw new HTTPException(404, { message: "Segment not found" });
}

const listBoards = defineQuillsRoute({
  method: "get",
  path: "/boards",
  operationId: "listQuillsBoards",
  summary: "List the visible feedback boards",
  description:
    "With counts=true, each board has the number of its active posts, without merged posts and test-customer posts.",
  action: "read",
  query: z.object({
    counts: z.enum(["true", "false"]).default("false"),
    offset: pagingNumber(0, 1000000, 0),
    limit: pagingNumber(1, 100, 100),
  }),
  response: z.object({
    items: z.array(board),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Boards",
  errors,
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => {
    const rows = await db
      .select(columns)
      .from(boards)
      .where(boardVisible(projects))
      .orderBy(asc(boards.name), asc(boards.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const counts =
      query.counts === "true" && page.length
        ? await db
            .select({ boardId: posts.boardId, count: count() })
            .from(posts)
            .where(
              and(
                inArray(
                  posts.boardId,
                  page.map((row) => row.id),
                ),
                isNull(posts.deletedAt),
                isNull(posts.canonicalPostId),
                notTestPrincipal(db, posts.principalId),
              ),
            )
            .groupBy(posts.boardId)
        : undefined;
    return {
      items: page.map((row) => ({
        ...view(row),
        postCount:
          counts && (counts.find((c) => c.boardId === row.id)?.count ?? 0),
      })),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const getBoard = defineQuillsRoute({
  method: "get",
  path: "/boards/{boardId}",
  operationId: "getQuillsBoard",
  summary: "Get a feedback board",
  action: "read",
  params: boardParams,
  response: board,
  responseDescription: "Board",
  errors,
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    await findBoard(db, params.boardId, projects);
    const [row] = await db
      .select(columns)
      .from(boards)
      .where(eq(boards.id, params.boardId));
    return view(row!);
  },
});

const createBoard = defineQuillsRoute({
  method: "post",
  path: "/boards",
  operationId: "createQuillsBoard",
  summary: "Create a feedback board",
  description: "Without a slug, the board gets a free slug made from its name.",
  action: "manage_settings",
  body: z.object({
    name,
    slug: slug.optional(),
    description: description.optional(),
    access: accessInput.optional(),
  }),
  response: board,
  responseDescription: "Created board",
  errors,
  event: (_input, result) => ({
    type: "board.created",
    entityType: "board",
    entityId: result.id,
    payload: { slug: result.slug },
  }),
  handler: async ({ db, body }) => {
    await checkSegments(db, body.access);
    // The unique (workspace, slug) key turns a taken slug into no row, then 409.
    const [row] = await db
      .insert(boards)
      .values({
        name: body.name,
        slug: body.slug ?? (await freeSlug(db, slugify(body.name))),
        description: body.description || null,
        ...(body.access && { access: body.access }),
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row) throw new HTTPException(409, { message: "Board slug is taken" });
    return view(row);
  },
});

const updateBoard = defineQuillsRoute({
  method: "patch",
  path: "/boards/{boardId}",
  operationId: "updateQuillsBoard",
  summary: "Update a feedback board, including its access settings",
  description:
    "A new name without a slug also moves the slug to the new name when that slug is free.",
  action: "manage_settings",
  params: boardParams,
  body: z
    .object({
      name: name.optional(),
      slug: slug.optional(),
      description: description.nullable().optional(),
      access: accessInput.optional(),
    })
    .refine((fields) => Object.values(fields).some((v) => v !== undefined), {
      message: "Provide at least one field",
    }),
  response: board,
  responseDescription: "Updated board",
  errors,
  event: ({ params }, result) => ({
    type: "board.updated",
    entityType: "board",
    entityId: params.boardId,
    payload: { slug: result.slug },
  }),
  load: loadProjects,
  handler: async ({ db, params, body, loaded: projects }) => {
    const current = await findBoard(db, params.boardId, projects);
    await checkSegments(db, body.access);
    let nextSlug: string | undefined;
    if (body.slug !== undefined && body.slug !== current.slug) {
      if (await slugTaken(db, body.slug, current.id))
        throw new HTTPException(409, { message: "Board slug is taken" });
      nextSlug = body.slug;
    } else if (body.slug === undefined && body.name !== undefined) {
      const derived = slugify(body.name);
      if (
        derived !== current.slug &&
        !(await slugTaken(db, derived, current.id))
      )
        nextSlug = derived;
    }
    const [row] = await db
      .update(boards)
      .set({
        name: body.name,
        slug: nextSlug,
        description:
          body.description === undefined ? undefined : body.description || null,
        access: body.access,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, current.id))
      .returning(columns)
      .catch(slugConflict);
    return view(row!);
  },
});

const deleteBoard = defineQuillsRoute({
  method: "delete",
  path: "/boards/{boardId}",
  operationId: "deleteQuillsBoard",
  summary: "Delete a feedback board",
  description:
    "Soft delete. Its posts leave every list. Its project links are removed, because no route can read or unlink a deleted board.",
  action: "manage_settings",
  params: boardParams,
  response: z.object({ id: z.string(), deletedAt: responseTimestamp }),
  responseDescription: "Deleted board",
  errors,
  event: ({ params }) => ({
    type: "board.deleted",
    entityType: "board",
    entityId: params.boardId,
  }),
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    await findBoard(db, params.boardId, projects);
    const [row] = await db
      .update(boards)
      .set({ deletedAt: new Date() })
      .where(and(eq(boards.id, params.boardId), isNull(boards.deletedAt)))
      .returning({ id: boards.id, deletedAt: boards.deletedAt });
    if (!row) throw new HTTPException(404, { message: "Board not found" });
    await db.delete(boardProjects).where(eq(boardProjects.boardId, row.id));
    return { id: row.id, deletedAt: row.deletedAt! };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listBoards)
  .openapi(...getBoard)
  .openapi(...createBoard)
  .openapi(...updateBoard)
  .openapi(...deleteBoard);
