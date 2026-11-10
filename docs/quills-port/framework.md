# Quills route framework (design)

Status: P0 is implemented in `apps/api/src/quills/framework/`. The code is the source of truth.

Differences between this design and the P0 code:

- The declaration has four more fields: `responseDescription`, `errors`, `allowKeys`, and `load`
  (a platform lookup that runs after the permission checks and before the transaction).
- The fields `status` and `sourcePermission` are not built. Every route returns 200.
- The checks `bounded-inputs` and `deleted-object` are not built. The check `native-permission` is added.
- Fixtures are next to their route modules, for example `links.fixture.ts`.
- `links.ts` is 175 lines after the formatter's line wrap, not about 135.
- Team bind and update now return 403 before the team lookup, return only declared fields,
  and return 400 for a body with no Content-Type.

The framework is one helper and one test suite. Both use the code that exists today:
`withQuillsRequest`, `workspaceAccess`, `requireWorkspacePermission`, `createRoute`,
`recordQuillsChange` and the test harness in `src/database/quills/platform.test.ts`.

## 1. Boundary map

| Item | Value |
|---|---|
| Tables | All in schema `quills`. The helper never touches `public` tables. Platform reads go through named functions in `framework/platform-reads.ts`. |
| Actor and workspace IDs | `c.get("userId")` and `c.get("workspaceId")`, set by the session middleware and `workspaceAccess.fromParam("workspaceId")`. Never from the body or the query. |
| Permissions | `workspace:read` plus one `quills` action per route. Optional native permissions (for example `project:read`). API-key scope uses the same permission map. |
| Persisted relationships | A route that depends on a project declares a `project` resolver. The resolver reads the stored relationship. |
| Transaction | One `withQuillsRequest` call per request. The handler, the response check and the outbox write run inside it. |
| External effects | None in the request. A mutation writes audit, event and job rows. Workers deliver after commit. |

## 2. Files (all fork-owned)

```
apps/api/src/quills/framework/
  define-route.ts          the helper
  registry.ts              the list of declarations (filled when route modules load)
  platform-reads.ts        the only place that reads public tables for Quills routes
  audience.ts              P3: portal, widget, public and signed audiences
  contract.ts              checkRoute(app, declaration, fixture) → Finding[]
  contract.test.ts         runs checkRoute for every registered declaration
  contract.self.test.ts    proves that checkRoute catches broken routes
  boundaries.test.ts       static import rules for src/quills/**
```

## 3. The declaration

One declaration defines one route. The path is relative to `/quills/{workspaceId}`.

```ts
defineQuillsRoute({
  method: "put",
  path: "/boards/{boardId}/projects/{projectId}",
  operationId: "linkQuillsBoardToProject",
  summary: "Link a Quills board to a project",
  action: "update",                       // required: read | create | update | delete | manage_settings
  sourcePermission: "BOARD_MANAGE",       // optional: the Quackback key, kept for the ledger
  native: { project: ["read"] },          // optional: extra Kaneo permissions
  params: boardParams,                    // Zod. The helper adds workspaceId.
  query: undefined,
  body: undefined,
  project: ({ params }) => params.projectId, // optional: persisted project to authorize
  response: changed,                      // Zod. Parsed at run time.
  status: 200,
  event: (input, result) => result.changed && { type: "board.project_linked", ... },
                                          // required when method is not GET; `false` needs a reason
  handler: async ({ db, actor, params, query, body, workspaceId }) => { ... },
  after: undefined,                       // optional: read-only shaping after commit
});
```

The helper returns the tuple `[route, handler]`. A router uses it as
`router.openapi(...declaration)`. This keeps Hono's chained types, so the typed
`@kaneo/libs` client still infers every response.

What the helper does on each request, in this order:

1. `workspaceAccess.fromParam("workspaceId")` (route middleware, as today).
2. `requireWorkspacePermission(native)` when `native` is set (route middleware, as today).
3. Zod validation of params, query and body (the existing `validationHook` returns 400).
4. `project` resolver, when set. It runs after step 5's permission checks (see section 6).
5. `withQuillsRequest(c, { action, projectId })`: workspace access, `workspace:read`,
   the Quills action, API-key scope, project visibility, then the scoped transaction.
6. `handler` with the branded `db` and the `actor`. The handler does not receive `c`.
7. `response.parse(result)`. Unknown keys are removed. A wrong shape fails the request.
8. `event(input, result)`, then `recordQuillsChange` in the same transaction.
9. Commit. Then `after`, if set. Then `c.json(result, status)`.

## 4. Rule map: AGENTS.md → mechanism or test

M = the framework makes the unsafe path impossible or fails the build. T = a test fails.

### Hard rejection rules

| # | Rule | Enforced by |
|---|---|---|
| 1 | No retry of a denied operation through a wider path | M: the handler has no global database and no `c`. T: `boundaries.test.ts` fails on an import of `withQuillsSystemWorkspace` or `../database` in a route module. |
| 2 | No own pool, no manual transaction, no `SET ROLE`, no RLS change | M: the handler gets only the branded `Database`. T: `boundaries.test.ts` fails on `pg`, `getDatabasePool`, `SET ROLE`, `set_config`, `row_security` in `src/quills/**` outside `framework/`. |
| 3 | No trust in body or query copies of workspace or actor; no body spread into writes | M: `workspaceId` and `actor` come from the helper. T: contract check `foreign-body-workspace` sends another workspace ID in the body and expects no effect. T: `boundaries.test.ts` fails on `.values({ ...body` and `.set({ ...body`. |
| 4 | Check every supplied relationship | M: the `project` resolver for native links. T: contract check `foreign-ids` replaces each ID param and each ID field with an ID from workspace B and expects 404 or 403 and no change. |
| 5 | No complete rows, credentials or raw errors in responses | M: `response.parse` at run time. T: contract check `strict-response` validates the real response against a strict copy of the schema, and fails on key names that match `secret|token|password|hash|workspaceId` unless the declaration allows them. |
| 6 | No swallowed write; no lazy query; data and outbox in one transaction | M: the helper awaits the handler and writes the event in the same transaction. The scoped client already rejects queries after the transaction ends. T: contract check `rollback` (section 5). |
| 7 | No wider runtime grants; invariants in the database | T: the contract suite runs through `quills_runtime` on real PostgreSQL. A grant change needs a migration, and the migration review rejects it. Feature tests add the concurrency case. |
| 8 | No edit of applied migrations | T: startup hash and manifest checks (exist). The phase checklist allows only `db:generate:quills`. |
| 9 | No external effect before commit; no blind retry | M: the handler has no mail, webhook or WebSocket client. `boundaries.test.ts` fails on those imports in route modules. T: worker tests per handler (phase P4). |
| 10 | No weakened tests | T: the contract suite iterates the registry, so a route cannot leave the suite. `contract.self.test.ts` fails if a check stops reporting. A skipped database run fails CI when `QUILLS_TEST_DATABASE_URL` is unset in the Quills job. |

### Required request and query path

| Item | Enforced by |
|---|---|
| OpenAPI and Zod helpers, bounded inputs | M: the declaration requires `operationId`, `summary`, schemas. T: check `bounded-inputs` fails on a string, array or page-size schema with no maximum. |
| Mounted through `src/quills/index.ts`, with `workspaceAccess.fromParam` | M: the helper adds the middleware and the `{workspaceId}` prefix. T: check `registered` compares the mounted router's routes with the registry; a route with no declaration fails. |
| `withQuillsRequest` with the real action | M: `action` is a required field. T: checks `denied-action` and `api-key-scope`. |
| Branded handle, awaited queries, no global DB | M and T: rules 1, 2 and 6. |
| Ownership, soft-delete, non-disclosing errors | T: checks `foreign-ids` and `deleted-object` (a soft-deleted fixture returns 404). |
| Pagination bounds after filtering | T: check `page-bounds` requests `limit` above the maximum and expects 400. |
| Mismatched ID sources | T: check `foreign-ids` covers path, query and body. |
| All-or-nothing batches | T: feature test per batch endpoint. The declaration field `batch: true` makes the contract suite require that test file. |

### Crossing the schema boundary

| Item | Enforced by |
|---|---|
| Platform read needs a workspace predicate and native permission | M: only `framework/platform-reads.ts` may import the platform database. Each function there takes `workspaceId` and filters on it. T: `boundaries.test.ts`. |
| Persisted links decide project access | M: the `project` resolver. T: check `private-project` uses a private project that the caller cannot open. |
| Reuse `board_projects`, `post_tasks`, `teams.kaneo_team_id` | T: `boundaries.test.ts` fails on a new table whose name ends in `_projects` or `_tasks`. Review item at phase kickoff. |
| A platform call inside the callback is not atomic | M: the handler cannot reach the platform database. A two-schema write needs an explicit design; the declaration has no field for it. |

### Mutations, jobs, files and clients

| Item | Enforced by |
|---|---|
| `recordQuillsChange` in the same transaction; extend the Zod catalogue | M: the `event` field. Its type is the catalogue's union, so a new event needs a catalogue change. T: check `outbox`. |
| Workers: validated handler, retry, idempotency | T: one worker test file per registered job type. `jobs/worker.test.ts` fails on a job type with no handler test. |
| Storage lifecycle | M: file-bearing routes use `framework/files.ts` (P2), which registers keys and queues cleanup. T: storage tests per object-bearing field. |
| Typed client, cache scope | T: `@kaneo/libs` typecheck. Web tests are per phase. |

### Schema and migration rules

| Item | Enforced by |
|---|---|
| Tenancy helpers, workspace FK, forced RLS | T: `schema.test.ts` (exists) checks every table. |
| `db:generate:quills` only; manifest capture | T: startup manifest check (exists). Phase checklist. |
| Privileged functions | Review item. The plan adds none. |
| No destructive migration | Review item. The plan adds none. |
| `CATALOGUE_VERSION`, transfer, retention, deletion | Phase checklist item for each new table or object-bearing field. |

### Evidence table

| Changed boundary | Contract check or test |
|---|---|
| Authenticated endpoint | `no-session`, `denied-action`, `api-key-scope`, `authorized`, `instance-admin` |
| Tenant or object access | `other-workspace`, `foreign-ids`, `foreign-body-workspace`, `removed-member`, `archived-workspace` |
| Native resource link | `private-project`, `native-permission` (only for declarations with `project` or `native`) |
| Mutation or batch | `rollback`, `outbox`; batch feature test |
| Read, search, export | `strict-response`, `page-bounds`, `other-workspace` (expects no rows from B) |
| Schema or ownership constraint | existing `integration.test.ts` and `completion.test.ts`; new constraint tests per migration |
| Worker or storage lifecycle | worker and storage test files, required by job type and by file field |
| Migration | existing migration tests; rerun per phase that adds a migration |
| Client, cache, realtime | web tests per phase; `outbox` proves the invalidation event |

## 5. The contract test

`checkRoute(app, declaration, fixture)` returns a list of findings. `contract.test.ts`
runs it for every declaration in the registry and expects an empty list.

The harness is the one in `platform.test.ts`: a Hono app, real PostgreSQL through
`QUILLS_TEST_DATABASE_URL`, two workspaces (A and B), and identity set from test headers.

Each route module has a sibling fixture, `<name>.fixture.ts`:

```ts
export const linkQuillsBoardToProject = fixture({
  seed: async (a, b) => ({ boardId, projectId, foreign: { boardId: b.boardId } }),
  valid: (ids) => ({ params: { boardId: ids.boardId, projectId: ids.projectId } }),
});
```

A declaration with no fixture is a finding (`no-fixture`). The checks:

| Check | Request | Expected |
|---|---|---|
| `registered` | none | Every route on the mounted router has a declaration. |
| `no-session` | valid input, no user | 401 |
| `other-workspace` | member of B calls the A path | 403 or 404; body has no A data |
| `removed-member` | user removed from A | 403 or 404 |
| `archived-workspace` | A archived | 403 |
| `denied-action` | role that lacks the declared action | 403. Viewer for create and update. Member for delete and manage_settings. A custom role with no `quills:read` for read. |
| `api-key-scope` | API key whose scope lacks the action | 403 with code `API_KEY_SCOPE` |
| `authorized` | role and key that hold exactly the action | declared 2xx |
| `instance-admin` | instance administrator, not a member | declared 2xx (existing semantics) |
| `schema-400` | bad TypeID, missing body, over-long string, `limit` above the maximum | 400 for each |
| `foreign-ids` | each ID replaced by workspace B's ID | 404 or 403; row counts in A and B unchanged |
| `foreign-body-workspace` | body carries `workspaceId: B` | no row in B; response unchanged |
| `strict-response` | the `authorized` response | matches the strict schema; no forbidden key names |
| `outbox` | after `authorized` on a mutation | one `events` row with the declared type, one `audit_log` row with the actor's principal, one job row. For GET: none. |
| `rollback` | mutation with a failure injected after the handler | no data change, no audit, event or job row |
| `private-project` | declaration has `project`; caller cannot open it | 403 or 404 |
| `bounded-inputs` | none (static) | every string, array and page size in the schemas has a maximum |

### The suite must fail a broken route

`contract.self.test.ts` builds three broken routes in a test-only router and expects
findings. It does not expect a pass.

| Broken route | How it is broken | Findings that must appear |
|---|---|---|
| `noPermission` | Raw `createRoute` plus `withQuillsWorkspace`. It skips the action check. | `registered`, `denied-action`, `api-key-scope` |
| `rawRow` | Returns `select()` rows with a loose response schema | `strict-response` |
| `noEvent` | Mutation that does not record a change | `outbox` |

If a later change makes `checkRoute` blind to one of these, this file fails.
This is the proof that a missing permission check cannot pass the suite.

## 6. Proof: `links.ts` on the helper

Today `apps/api/src/quills/links.ts` has 294 lines. The same five routes on the helper:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../openapi";
import { boards } from "../database/quills/schema/boards";
import { boardProjects, postTasks } from "../database/quills/schema/platform-links";
import { posts } from "../database/quills/schema/posts";
import { defineQuillsRoute } from "./framework/define-route";
import { taskProjectId, visibleLinks } from "./framework/platform-reads";

const boardParams = z.object({
  boardId: flexibleToTypeIdSchema("board"),
  projectId: z.string().min(1).max(200),
});
const postParams = z.object({
  postId: flexibleToTypeIdSchema("post"),
  taskId: z.string().min(1).max(200),
});
const changed = z.object({ changed: z.boolean() });
const native = { project: ["read"] } as const;

const boardLink = (add: boolean) =>
  defineQuillsRoute({
    method: add ? "put" : "delete",
    path: "/boards/{boardId}/projects/{projectId}",
    operationId: add ? "linkQuillsBoardToProject" : "unlinkQuillsBoardFromProject",
    summary: add ? "Link a Quills board to a project" : "Unlink a Quills board from a project",
    action: "update",
    native,
    params: boardParams,
    project: ({ params }) => params.projectId,
    response: changed,
    event: ({ params }, result) =>
      result.changed && {
        type: add ? "board.project_linked" : "board.project_unlinked",
        entityType: "board",
        entityId: params.boardId,
        payload: { projectId: params.projectId },
      },
    handler: async ({ db, params }) => {
      const [board] = await db
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, params.boardId), isNull(boards.deletedAt)))
        .limit(1);
      if (!board) throw new HTTPException(404, { message: "Board not found" });
      const key = { boardId: params.boardId, projectId: params.projectId };
      const rows = add
        ? await db.insert(boardProjects).values(key).onConflictDoNothing().returning({ id: boardProjects.boardId })
        : await db
            .delete(boardProjects)
            .where(and(eq(boardProjects.boardId, key.boardId), eq(boardProjects.projectId, key.projectId)))
            .returning({ id: boardProjects.boardId });
      return { changed: rows.length > 0 };
    },
  });

const postLink = (add: boolean) =>
  defineQuillsRoute({
    method: add ? "put" : "delete",
    path: "/posts/{postId}/tasks/{taskId}",
    operationId: add ? "linkQuillsPostToTask" : "unlinkQuillsPostFromTask",
    summary: add ? "Link a Quills post to a task" : "Unlink a Quills post from a task",
    action: "update",
    native,
    params: postParams,
    // The task's stored project, never a project ID from the caller. 404 when the task is not in this workspace.
    project: ({ params, workspaceId }) => taskProjectId(workspaceId, params.taskId),
    response: changed,
    event: ({ params }, result) =>
      result.changed && {
        type: add ? "post.task_linked" : "post.task_unlinked",
        entityType: "post",
        entityId: params.postId,
        payload: { taskId: params.taskId },
      },
    handler: async ({ db, params }) => {
      const [post] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, params.postId), isNull(posts.deletedAt)))
        .limit(1);
      if (!post) throw new HTTPException(404, { message: "Post not found" });
      const key = { postId: params.postId, taskId: params.taskId };
      const rows = add
        ? await db.insert(postTasks).values(key).onConflictDoNothing().returning({ id: postTasks.postId })
        : await db
            .delete(postTasks)
            .where(and(eq(postTasks.postId, key.postId), eq(postTasks.taskId, key.taskId)))
            .returning({ id: postTasks.postId });
      return { changed: rows.length > 0 };
    },
  });

const listLinks = defineQuillsRoute({
  method: "get",
  path: "/links",
  operationId: "listQuillsLinks",
  summary: "List visible Quills board and post links",
  action: "read",
  native,
  query: z.object({
    offset: z.coerce.number().int().min(0).max(10000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  }),
  response: z.object({
    nextOffset: z.number().nullable(),
    boards: z.array(z.object({ boardId: z.string(), projectId: z.string() })),
    posts: z.array(z.object({ postId: z.string(), taskId: z.string() })),
  }),
  handler: async ({ db, query: { offset, limit } }) => ({
    nextOffset: null,
    boards: await db
      .select({ boardId: boardProjects.boardId, projectId: boardProjects.projectId })
      .from(boardProjects)
      .orderBy(boardProjects.boardId, boardProjects.projectId)
      .offset(offset)
      .limit(limit + 1),
    posts: await db
      .select({ postId: postTasks.postId, taskId: postTasks.taskId })
      .from(postTasks)
      .orderBy(postTasks.postId, postTasks.taskId)
      .offset(offset)
      .limit(limit + 1),
  }),
  // Private-project filtering reads public tables, so it runs after the scoped transaction.
  after: (page, { query, workspaceId, userId }) => visibleLinks(page, query, workspaceId, userId),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...boardLink(true))
  .openapi(...boardLink(false))
  .openapi(...postLink(true))
  .openapi(...postLink(false))
  .openapi(...listLinks);
```

| Measure | Today | On the helper |
|---|---|---|
| `links.ts` | 294 lines | about 135 lines |
| Shared code that moves out | 0 | about 50 lines in `platform-reads.ts` (`taskProjectId`, `visibleLinks`), reused by later post and task routes |
| `createRoute`, `middleware`, error responses, `c.json` calls | 5 of each | 0 |
| Calls to `withQuillsRequest` and `recordQuillsChange` | 3 and 2, by hand | 0 in the module |

Behavior:

- The paths, methods, operation IDs, schemas, status codes and events are the same.
  `pnpm openapi:check` must show no change for these five operations. This is the P0 acceptance check.
- One difference, on purpose. Today `changePost` reads the task before the Quills action check.
  A caller with `project:read` but no `quills:update` gets 404 for an unknown task and 403 for a known one.
  On the helper the action check runs first, so that caller always gets 403. Authorized callers see no change.
- The insert and delete now return one column, not the full row. The response does not change.

Risk to close in P0: `router.openapi(...tuple)` must keep the response types for the typed client.
The check is that `apps/web/src/fetchers/quills/platform.ts` compiles with no edit.
If the spread loses inference, the fallback is `mountQuillsRoute(router, declaration)`, which returns the typed router.

## 7. Audiences other than teammates (P3)

`withQuillsRequest` is a teammate helper. The contract says that it does not authorize
portal, widget or public callers. The declaration gets one more field in P3:

```ts
audience: "teammate" | "portal" | "widget" | "public" | "signed"   // default "teammate"
```

Each non-teammate audience has its own resolver in `framework/audience.ts`. A resolver returns
the workspace, a customer principal (or none) and the ownership rules. It then opens the scoped
transaction through a new trusted entry point next to `withQuillsRequest`. The contract suite
gets one check table per audience. The ledger marks 316 of the 940 ported capabilities as not
teammate, so this is the highest authorization risk in the plan. Decision D1 in the README
fixes the customer sign-in model before P3 starts.
