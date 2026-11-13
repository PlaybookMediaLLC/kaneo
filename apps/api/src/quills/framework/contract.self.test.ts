import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { HTTPException } from "hono/http-exception";
import type { BoardId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { Pool } from "pg";
import {
  withQuillsWorkspace,
  type Database,
} from "../../database/quills/client";
import { principal, user as customer } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
import {
  apiRouter,
  createRoute,
  jsonResponse,
  pagingNumber,
  z,
  type BaseVariables,
} from "../../openapi";
import { workspaceAccess } from "../../utils/workspace-access-middleware";
import { unbounded } from "./bounded-inputs";
import {
  checkRoute,
  contractApp,
  contractEnv,
  contractSession,
  empty,
  fixture,
  startContract,
  stopContract,
  unregisteredRoutes,
} from "./contract";
import {
  buildQuillsRoute,
  defineQuillsRoute,
  htmlHeaders,
  type AnyQuillsRoute,
} from "./define-route";
import { registry } from "./registry";
import type { SignedVerifier } from "./signed";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const insertBoard = async (db: Database) =>
  (
    await db
      .insert(boards)
      .values({ name: "Broken", slug: `broken-${crypto.randomUUID()}` })
      .returning({ id: boards.id })
  )[0]!.id;
const changed = z.object({ changed: z.boolean() });

// Broken on purpose: a raw route that opens the scoped transaction without the action or API-key checks.
const noPermission: AnyQuillsRoute = {
  method: "put",
  path: "/broken/no-permission",
  operationId: "brokenNoPermission",
  summary: "Broken route without a permission check",
  action: "update",
  response: changed,
  responseDescription: "Changed",
  event: () => ({
    type: "board.project_linked",
    entityType: "board",
    entityId: "broken",
  }),
  handler: async ({ db }) => {
    await insertBoard(db);
    return { changed: true };
  },
};
// Broken on purpose: an app route mounted by hand, with no app gate and no permission check.
const brokenAppNoGate: AnyQuillsRoute = {
  ...noPermission,
  audience: "app",
  capability: "write:feedback",
  path: "/broken/no-gate",
  operationId: "brokenAppNoGate",
  summary: "Broken app route without the app gate",
};
// Broken on purpose: an app route that links any post, also one on a board the caller cannot see.
const brokenAppHiddenTarget = defineQuillsRoute({
  audience: "app",
  capability: "write:feedback",
  method: "put",
  path: "/broken/links",
  operationId: "brokenAppHiddenTarget",
  summary: "Broken app route without the board visibility check",
  action: "update",
  body: z.object({ postId: flexibleToTypeIdSchema("post") }),
  response: changed,
  responseDescription: "Changed",
  errors: { 404: "Post not found" },
  event: ({ body }) => ({
    type: "app.post_linked",
    entityType: "post",
    entityId: body.postId,
  }),
  handler: async ({ db, body }) => {
    await db.insert(postExternalLinks).values({
      postId: body.postId,
      integrationType: "broken",
      externalId: crypto.randomUUID(),
    });
    return { changed: true };
  },
});
// Broken on purpose: an app read that hides everything, so the leak checks pass for no reason.
const brokenAppEmptyRead = defineQuillsRoute({
  audience: "app",
  capability: "read:feedback",
  method: "get",
  path: "/broken/empty",
  operationId: "brokenAppEmptyRead",
  summary: "Broken app read that returns nothing",
  action: "read",
  response: z.object({ items: z.array(z.string()) }),
  responseDescription: "Nothing",
  handler: async () => ({ items: [] }),
});
// Broken on purpose: complete rows behind a loose response schema.
const rawRow = defineQuillsRoute({
  method: "get",
  path: "/broken/raw-row",
  operationId: "brokenRawRow",
  summary: "Broken route that returns complete rows",
  action: "read",
  response: z.object({
    boards: z.array(z.record(z.string(), z.unknown())),
  }),
  responseDescription: "Rows",
  handler: async ({ db }) => ({
    boards: await db.select().from(boards).limit(5),
  }),
});
// Broken on purpose: a public route that returns every board, private ones included.
const publicLeak = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/broken/public-boards",
  operationId: "brokenPublicLeak",
  summary: "Broken public route that leaks private rows",
  action: "read",
  response: z.object({ names: z.array(z.string()) }),
  responseDescription: "Board names",
  handler: async ({ db }) => ({
    names: (await db.select({ name: boards.name }).from(boards)).map(
      (board) => board.name,
    ),
  }),
});
// Broken on purpose: a portal route that renames the customer in the path, not the caller.
const noOwnership = defineQuillsRoute({
  audience: "portal",
  method: "put",
  path: "/broken/customers/{customerId}/name",
  operationId: "brokenNoOwnership",
  summary: "Broken portal route without an ownership check",
  action: "update",
  params: z.object({ customerId: flexibleToTypeIdSchema("user") }),
  body: z.object({ name: z.string().max(100) }),
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Changed",
  event: ({ params }) => ({
    type: "customer.profile_updated",
    entityType: "principal",
    entityId: params.customerId,
  }),
  handler: async ({ db, params, body }) => ({
    changed:
      (
        await db
          .update(customer)
          .set({ name: body.name })
          .where(eq(customer.id, params.customerId))
          .returning({ id: customer.id })
      ).length > 0,
  }),
});
// Broken on purpose: a portal route that returns teammate principals.
const teammateData = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/broken/teammates",
  operationId: "brokenTeammateData",
  summary: "Broken portal route that returns teammate data",
  action: "read",
  response: z.object({ ids: z.array(z.string()) }),
  responseDescription: "Teammate principals",
  handler: async ({ db }) => ({
    ids: (
      await db
        .select({ id: principal.id })
        .from(principal)
        .where(isNotNull(principal.kaneoUserId))
    ).map((row) => row.id),
  }),
});
// Broken on purpose: a widget identify that never checks the token's signature.
const anyToken = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  method: "post",
  path: "/broken/identify",
  operationId: "brokenAnyToken",
  summary: "Broken widget identify without a signature check",
  action: "create",
  body: z.object({ ssoToken: z.string().max(8192) }),
  response: z.object({ id: z.string() }),
  responseDescription: "The customer",
  event: { none: "Broken on purpose" },
  handler: async ({ db, body }) => {
    const [row] = await db
      .insert(customer)
      .values({ name: body.ssoToken.slice(0, 40) })
      .returning({ id: customer.id });
    return { id: row!.id };
  },
});
// Broken on purpose: a mutation whose event never fires.
const noEvent = defineQuillsRoute({
  method: "post",
  path: "/broken/no-event",
  operationId: "brokenNoEvent",
  summary: "Broken mutation without an outbox event",
  action: "create",
  response: z.object({ id: z.string() }),
  responseDescription: "Created",
  event: () => false,
  handler: async ({ db }) => ({ id: await insertBoard(db) }),
});

// Broken on purpose: a query string with no maximum.
const unboundedQuery = defineQuillsRoute({
  method: "get",
  path: "/broken/unbounded",
  operationId: "brokenUnboundedQuery",
  summary: "Broken route with an unbounded query string",
  action: "read",
  query: z.object({ q: z.string().optional() }),
  response: z.object({ length: z.number() }),
  responseDescription: "Length",
  handler: async ({ query }) => ({ length: query.q?.length ?? 0 }),
});
// Broken on purpose: a portal body array with no maximum.
const unboundedPortal = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "post",
  path: "/broken/unbounded-ids",
  operationId: "brokenUnboundedPortal",
  summary: "Broken portal route with an unbounded array",
  action: "create",
  body: z.object({ ids: z.array(z.string().max(10)) }),
  response: z.object({ count: z.number() }),
  responseDescription: "Count",
  event: { none: "Broken on purpose" },
  handler: async ({ body }) => ({ count: body.ids.length }),
});
/** A board by ID, deleted or not: the deleted check is missing on purpose. */
const anyBoard = async (db: Database, id: BoardId) => {
  const [board] = await db
    .select({ name: boards.name })
    .from(boards)
    .where(eq(boards.id, id));
  if (!board) throw new HTTPException(404, { message: "Board not found" });
  return board;
};
const boardParams = z.object({ boardId: flexibleToTypeIdSchema("board") });
// Broken on purpose: a teammate route and a public route that serve a soft-deleted board.
const deletedBoard = defineQuillsRoute({
  method: "get",
  path: "/broken/boards/{boardId}",
  operationId: "brokenDeletedBoard",
  summary: "Broken route that returns a deleted board",
  action: "read",
  params: boardParams,
  response: z.object({ name: z.string() }),
  responseDescription: "Board",
  errors: { 404: "Board not found" },
  handler: ({ db, params }) => anyBoard(db, params.boardId),
});
const publicDeletedBoard = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/broken/public-boards/{boardId}",
  operationId: "brokenPublicDeletedBoard",
  summary: "Broken public route that returns a deleted board",
  action: "read",
  params: boardParams,
  response: z.object({ name: z.string() }),
  responseDescription: "Board",
  errors: { 404: "Board not found" },
  handler: ({ db, params }) => anyBoard(db, params.boardId),
});

// Broken on purpose: a signed route whose verifier skips verification. It takes the workspace from
// the path and accepts any signature, so a forged or crossed request creates boards.
const skipsVerification: SignedVerifier = {
  name: "broken-skips-verification",
  locate: ({ params, headers }) => ({
    scope: { workspace: params.workspace ?? "" },
    deliveryId: headers.get("x-delivery") ?? crypto.randomUUID(),
  }),
};
const unverified = defineQuillsRoute({
  audience: "signed",
  verifier: skipsVerification,
  method: "post",
  path: "/broken/{workspace}/boards",
  operationId: "brokenUnverifiedSigned",
  summary: "Broken signed route without a signature check",
  action: "create",
  params: z.object({ workspace: z.string().max(200) }),
  body: z.object({ name: z.string().max(100) }),
  response: z.object({ created: z.boolean() }),
  responseDescription: "Created",
  replay: { created: false },
  event: { none: "Broken on purpose" },
  handler: async ({ db, body }) => {
    await db
      .insert(boards)
      .values({ name: body.name, slug: `broken-${crypto.randomUUID()}` });
    return { created: true };
  },
});
// Broken on purpose: an internal route mounted by hand, without the token check.
const brokenInternal: AnyQuillsRoute = {
  audience: "internal",
  method: "post",
  path: "/broken/wake",
  operationId: "brokenInternalNoToken",
  summary: "Broken internal route without a token check",
  action: "manage_settings",
  response: z.object({ ran: z.boolean() }),
  responseDescription: "Ran",
  event: { none: "Broken on purpose" },
  handler: async () => ({ ran: true }),
};
// A signed probe: a signed handler gets request metadata too.
const signedMeta = defineQuillsRoute({
  audience: "signed",
  verifier: skipsVerification,
  method: "get",
  path: "/probe/{workspace}/request-meta",
  operationId: "probeSignedRequestMeta",
  summary: "Reports whether a signed handler gets request metadata",
  action: "read",
  params: z.object({ workspace: z.string().max(200) }),
  response: z.object({ present: z.boolean() }),
  responseDescription: "Metadata",
  replay: { present: false },
  redirect: {
    success: (result) =>
      `https://web.example.test/result?present=${String(result.present)}`,
    failure: (status) => `https://web.example.test/result?status=${status}`,
  },
  event: { none: "A probe" },
  handler: async (input) => ({ present: Object.isFrozen(input.request) }),
});
// Request metadata probes: a public route reports it, a teammate route has none.
const publicMeta = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/probe/request-meta",
  operationId: "probePublicRequestMeta",
  summary: "Reports the request metadata a public handler gets",
  action: "read",
  response: z.object({
    present: z.boolean(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    country: z.string().nullable(),
    doNotTrack: z.boolean(),
    keys: z.array(z.string()),
  }),
  responseDescription: "Metadata",
  handler: async (input) => {
    const { request } = input;
    return {
      present: Object.isFrozen(request),
      ...request,
      keys: Object.keys(request).sort(),
    };
  },
});
const teammateMeta = defineQuillsRoute({
  method: "get",
  path: "/probe/request-meta",
  operationId: "probeTeammateRequestMeta",
  summary: "Reports whether a teammate handler gets request metadata",
  action: "read",
  response: z.object({ present: z.boolean() }),
  responseDescription: "Metadata",
  handler: async (input) => ({ present: "request" in input }),
});
// Event probes: the handler returns a key that the response schema leaves out; the event reads it.
const eventRaw = { changed: true, receipt: "before:after" };
const eventFromRaw =
  (entityId: string) => (_input: unknown, _result: unknown, raw: unknown) => ({
    type: "board.project_linked" as const,
    entityType: "board" as const,
    entityId,
    payload: { receipt: (raw as typeof eventRaw).receipt },
  });
const teammateEventRaw = defineQuillsRoute({
  method: "put",
  path: "/probe/event-raw",
  operationId: "probeTeammateEventRaw",
  summary: "Records a key that the response leaves out",
  action: "update",
  response: changed,
  responseDescription: "Changed",
  event: eventFromRaw("probe-event-raw-teammate"),
  handler: async () => eventRaw,
});
const publicEventRaw = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/probe/event-raw",
  operationId: "probePublicEventRaw",
  summary: "Records a key that the response leaves out",
  action: "create",
  response: changed,
  responseDescription: "Changed",
  event: eventFromRaw("probe-event-raw-public"),
  handler: async () => eventRaw,
});

// Broken on purpose: a route declared raw, mounted by hand, that answers JSON with a private value.
const rawAsJson: AnyQuillsRoute = {
  audience: "public",
  method: "get",
  path: "/broken/feed.xml",
  operationId: "brokenRawAsJson",
  summary: "Broken raw route that answers JSON",
  action: "read",
  raw: "application/rss+xml",
  response: z.string(),
  responseDescription: "Feed",
  handler: async () => "",
};
// Broken on purpose: a route declared JSON, mounted by hand, that answers XML.
const jsonAsXml: AnyQuillsRoute = {
  audience: "public",
  method: "get",
  path: "/broken/feed.json",
  operationId: "brokenJsonAsXml",
  summary: "Broken JSON route that answers XML",
  action: "read",
  response: z.object({ items: z.array(z.string()) }),
  responseDescription: "Feed",
  handler: async () => ({ items: [] }),
};
// Broken on purpose: a raw XML route that lists every board, private ones included.
const rawLeak = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/broken/boards.xml",
  operationId: "brokenRawLeak",
  summary: "Broken raw route that leaks private rows",
  action: "read",
  raw: "application/xml",
  response: z.string(),
  responseDescription: "Board names",
  handler: async ({ db }) =>
    `<boards>${(await db.select({ name: boards.name }).from(boards))
      .map((board) => `<name>${board.name}</name>`)
      .join("")}</boards>`,
});
// A text body probe: a textBody route reads text/plain as JSON; another route answers it with 415.
const textBody = z.object({ n: z.number().max(10) });
const textProbe = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/probe/text-body",
  operationId: "probeTextBody",
  summary: "Echoes a body that may come as text/plain",
  action: "create",
  textBody: true,
  body: textBody,
  response: z.object({ n: z.number() }),
  responseDescription: "The body",
  event: { none: "A probe" },
  handler: async ({ body }) => ({ n: body.n }),
});
const jsonProbe = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/probe/json-body",
  operationId: "probeJsonBody",
  summary: "Echoes a JSON body",
  action: "create",
  body: textBody,
  response: z.object({ n: z.number() }),
  responseDescription: "The body",
  event: { none: "A probe" },
  handler: async ({ body }) => ({ n: body.n }),
});
// A prepare and call probe for a portal route. `between` runs in `call`, with no transaction open.
let between: (() => Promise<unknown>) | undefined;
const preparedProbe = defineQuillsRoute({
  audience: "portal",
  method: "post",
  path: "/probe/prepared",
  operationId: "probePortalPrepared",
  summary: "Reports what prepare, call and the handler saw",
  action: "update",
  response: z.object({
    called: z.string(),
    caller: z.string().nullable(),
    workspaceId: z.string(),
  }),
  responseDescription: "What each step saw",
  event: { none: "A probe" },
  prepare: async ({ caller, workspaceId }) =>
    `${workspaceId}:${caller.principalId}`,
  call: async (prepared) => {
    await between?.();
    return `called ${prepared}`;
  },
  handler: async ({ caller, called, workspaceId }) => ({
    called,
    caller: caller.principalId,
    workspaceId,
  }),
});
// Broken on purpose: a widget route that writes for any visitor's input, not the session's own record.
const anyVisitor = defineQuillsRoute({
  audience: "widget",
  method: "post",
  path: "/broken/claim",
  operationId: "brokenWidgetClaim",
  summary: "Broken widget route without an ownership check",
  action: "create",
  body: z.object({ label: z.string().max(100) }),
  response: z.object({ claimed: z.boolean() }),
  responseDescription: "Claimed",
  event: { none: "Broken on purpose" },
  handler: async ({ db, body }) => {
    await db
      .insert(boards)
      .values({ name: body.label, slug: `claim-${crypto.randomUUID()}` });
    return { claimed: true };
  },
});

const app = contractApp(
  apiRouter<BaseVariables & { workspaceId: string }>()
    .openapi(...teammateMeta)
    .openapi(...teammateEventRaw)
    .openapi(
      createRoute({
        method: "put",
        path: "/{workspaceId}/broken/no-permission",
        middleware: [workspaceAccess.fromParam("workspaceId")],
        request: { params: z.object({ workspaceId: z.string() }) },
        responses: { 200: jsonResponse("Changed", changed) },
      }),
      async (c) => {
        await withQuillsWorkspace(
          { workspaceId: c.get("workspaceId"), userId: c.get("userId") },
          insertBoard,
        );
        return c.json({ changed: true }, 200);
      },
    )
    .openapi(...rawRow)
    .openapi(...noEvent)
    .openapi(...unboundedQuery)
    .openapi(...deletedBoard)
    .openapi(
      createRoute({
        method: "put",
        path: "/{workspaceId}/apps/broken/no-gate",
        middleware: [workspaceAccess.fromParam("workspaceId")],
        request: { params: z.object({ workspaceId: z.string() }) },
        responses: { 200: jsonResponse("Changed", changed) },
      }),
      async (c) => {
        await withQuillsWorkspace(
          { workspaceId: c.get("workspaceId"), userId: c.get("userId") },
          insertBoard,
        );
        return c.json({ changed: true }, 200);
      },
    )
    .openapi(...brokenAppHiddenTarget)
    .openapi(...brokenAppEmptyRead),
  apiRouter()
    .openapi(...publicLeak)
    .openapi(...noOwnership)
    .openapi(...teammateData)
    .openapi(...anyToken)
    .openapi(...unboundedPortal)
    .openapi(...publicDeletedBoard)
    .openapi(...unverified)
    .openapi(...publicMeta)
    .openapi(...publicEventRaw)
    .openapi(...signedMeta)
    .openapi(...rawLeak)
    .openapi(...textProbe)
    .openapi(...jsonProbe)
    .openapi(...preparedProbe)
    .openapi(...anyVisitor)
    .openapi(
      createRoute({
        method: "get",
        path: "/{workspace}/broken/feed.xml",
        request: { params: z.object({ workspace: z.string() }) },
        responses: { 200: jsonResponse("Feed", z.object({ x: z.string() })) },
      }),
      (c) => c.json({ x: "raw-private-value" }, 200),
    )
    .openapi(
      createRoute({
        method: "get",
        path: "/{workspace}/broken/feed.json",
        request: { params: z.object({ workspace: z.string() }) },
        responses: { 200: jsonResponse("Feed", z.object({ x: z.string() })) },
      }),
      (c) =>
        c.body("<items/>", 200, {
          "content-type": "application/xml",
        }) as never,
    )
    .openapi(
      createRoute({
        method: "post",
        path: "/internal/broken/wake",
        responses: { 200: jsonResponse("Ran", z.object({ ran: z.boolean() })) },
      }),
      (c) => c.json({ ran: true }, 200),
    ),
);
const declared = (operationId: string) =>
  [...registry.keys()].find((d) => d.operationId === operationId)!;
const checks = async (
  d: AnyQuillsRoute,
  f: Parameters<typeof checkRoute>[2] = empty,
) =>
  (await checkRoute(app, d, f)).map(
    (finding) => `${finding.check}: ${finding.detail}`,
  );

describe.skipIf(!url)("Quills route contract self-test", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("reports a route without a permission check", async () => {
    // The others are the broken raw-response routes and the broken internal route below.
    expect(unregisteredRoutes(app)).toEqual([
      "PUT /quills/:workspaceId/broken/no-permission",
      "PUT /quills/:workspaceId/apps/broken/no-gate",
      "GET /quills-public/:workspace/broken/feed.xml",
      "GET /quills-public/:workspace/broken/feed.json",
      "POST /quills-public/internal/broken/wake",
    ]);
    const found = await checks(noPermission);
    for (const check of ["registered", "denied-action", "api-key-scope"])
      expect(found).toContainEqual(expect.stringMatching(`^${check}: `));
  });
  it("reports a teammate route that serves a key that an app holds", async () => {
    expect(await checks(noPermission)).toContainEqual(
      expect.stringMatching(/^app-key-confined: got 200/),
    );
  });
  it("reports a session-only route that serves an API key", async () => {
    expect(await checks({ ...noPermission, sessionOnly: true })).toContainEqual(
      expect.stringMatching(/^session-required: got 200/),
    );
  });
  it("reports an app route without the app gate", async () => {
    const found = await checks(brokenAppNoGate);
    for (const check of [
      "registered",
      "app-session",
      "app-unscoped-key",
      "app-unbound",
      "app-disabled",
      "app-other-workspace",
      "app-capability",
      "app-actor",
    ])
      expect(found).toContainEqual(expect.stringMatching(`^${check}: `));
    // The viewer role cannot write, but the hand-made route lets it.
    expect(found).toContainEqual(
      expect.stringMatching(/^app-member-key: viewer role: got 200/),
    );
  });
  it("reports an app read that hides the rows its fixture marks visible", async () => {
    expect(
      await checks(
        declared("brokenAppEmptyRead"),
        fixture({
          seed: async () => ({}),
          valid: () => ({}),
          visible: () => ["must-be-listed"],
        }),
      ),
    ).toContain("app-actor: the response does not contain must-be-listed");
  });
  it("reports an app route that links a post on a board the caller cannot see", async () => {
    const found = await checks(
      declared("brokenAppHiddenTarget"),
      fixture({
        seed: async (env) => {
          const projectId = env.id("project");
          await env.db.insert(kaneo.projectTable).values({
            id: projectId,
            workspaceId: env.a,
            name: projectId,
            slug: projectId,
          });
          const post = async (workspaceId: string) =>
            env.scoped(workspaceId, async (db, actor) => {
              const boardId = await insertBoard(db);
              if (workspaceId === env.a)
                await db.insert(boardProjects).values({ boardId, projectId });
              const [row] = await db
                .insert(posts)
                .values({
                  title: "Hidden",
                  content: "Hidden",
                  boardId,
                  principalId: actor.principalId,
                })
                .returning({ id: posts.id });
              return row!.id;
            });
          return { a: await post(env.a), b: await post(env.b) };
        },
        valid: (ids) => ({ body: { postId: ids.a } }),
        foreign: (ids) => ({ postId: ids.b }),
      }),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/^private-project: expected 403 or 404, got 200/),
    );
    expect(found).toContain("private-project: rows changed");
    // With the app key, workspace B's post reaches the insert: the composite foreign key fails it.
    expect(found).toContainEqual(
      expect.stringMatching(/^foreign-ids: postId: got 500/),
    );
  });
  it("reports complete rows behind a loose response schema", async () => {
    const seeded = fixture({
      seed: (env) => env.scoped(env.a, insertBoard),
      valid: () => ({}),
    });
    const found = await checks(declared("brokenRawRow"), seeded);
    expect(found).toContainEqual(
      expect.stringMatching(
        /^strict-response: .* is not a closed object schema$/,
      ),
    );
    expect(found).toContain(
      "strict-response: the response has a key named workspaceId",
    );
  });
  it("reports a mutation without an outbox event", async () => {
    expect(await checks(declared("brokenNoEvent"))).toContain(
      "outbox: the authorized mutation recorded no change event",
    );
  });
  it("reports a public route that leaks a private row", async () => {
    const found = await checks(
      declared("brokenPublicLeak"),
      fixture({
        seed: async (env) => {
          const name = env.id("private-board");
          await env.scoped(env.a, (db) =>
            db.insert(boards).values({ name, slug: name }),
          );
          return { name };
        },
        valid: () => ({}),
        hidden: (ids) => [ids.name],
      }),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/^hidden: the response contains .*private-board/),
    );
  });
  it("reports a portal route that skips the ownership check", async () => {
    const found = await checks(
      declared("brokenNoOwnership"),
      fixture({
        seed: async (env) => {
          const ids = await env.portalCustomer(env.a, env.customerA);
          const [foreign] = await env.scoped(env.b, (db) =>
            db
              .insert(customer)
              .values({ name: env.id("foreign") })
              .returning({ id: customer.id }),
          );
          return { ...ids, foreign: foreign!.id };
        },
        valid: (ids) => ({
          params: { customerId: ids.customerId },
          body: { name: "Taken over" },
        }),
        foreign: (ids) => ({ customerId: ids.foreign }),
        probe: (env, ids) =>
          env.scoped(env.a, (db) =>
            db
              .select({ name: customer.name })
              .from(customer)
              .where(
                eq(
                  customer.id,
                  ids.customerId as typeof customer.$inferSelect.id,
                ),
              ),
          ),
      }),
    );
    expect(found).toContain(
      "customer-ownership: customer B changed customer A's records",
    );
  });
  it("reports a portal route that gives a teammate teammate data", async () => {
    const found = await checks(
      declared("brokenTeammateData"),
      fixture({ seed: async () => ({}), valid: () => ({}), own: () => [] }),
    );
    expect(found).toContain(
      "teammate-as-customer: the response names the teammate principal",
    );
  });
  it("reports a widget route that accepts a forged credential", async () => {
    const found = await checks(
      declared("brokenAnyToken"),
      fixture({
        seed: async () => ({}),
        valid: () => ({ body: { ssoToken: "signed" } }),
        forged: () => [{ body: { ssoToken: "forged" } }],
      }),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/^widget-credential: expected 401 or 403, got 200/),
    );
    expect(found).toContain(
      "widget-credential: a forged credential changed rows",
    );
  });
  it("reports a string or an array with no maximum, for a teammate and a portal route", async () => {
    expect(await checks(declared("brokenUnboundedQuery"))).toContain(
      "bounded-inputs: query.q accepts a string of 100001 characters",
    );
    const found = await checks(
      declared("brokenUnboundedPortal"),
      fixture({
        seed: async () => ({}),
        valid: () => ({ body: { ids: ["a"] } }),
        own: () => [],
      }),
    );
    expect(found).toContain("bounded-inputs: body.ids has no maximum length");
  });
  it("reports a teammate and a public route that serve a soft-deleted target", async () => {
    const onBoard = fixture({
      seed: async (env) => ({
        a: await env.scoped(env.a, insertBoard),
        b: await env.scoped(env.b, insertBoard),
      }),
      valid: (ids) => ({ params: { boardId: ids.a } }),
      foreign: (ids) => ({ boardId: ids.b }),
      hidden: () => [],
      softDelete: (env, ids) =>
        env.scoped(env.a, (db) =>
          db
            .update(boards)
            .set({ deletedAt: new Date() })
            .where(eq(boards.id, ids.a)),
        ),
    });
    for (const operationId of [
      "brokenDeletedBoard",
      "brokenPublicDeletedBoard",
    ])
      expect(await checks(declared(operationId), onBoard)).toContainEqual(
        expect.stringMatching(/^deleted-object: expected 404, got 200/),
      );
  });
  it("reports a signed route that skips verification", async () => {
    const raw = JSON.stringify({ name: "Forged" });
    const found = await checks(
      declared("brokenUnverifiedSigned"),
      fixture({
        seed: async (env) => ({ a: env.a, b: env.b }),
        valid: (ids) => ({
          params: { workspace: ids.a },
          raw,
          headers: { "x-signature": "good" },
        }),
        forged: (ids) => [
          {
            params: { workspace: ids.a },
            raw,
            headers: { "x-signature": "forged" },
          },
        ],
        // Signed for B, aimed at A.
        crossed: (ids) => [
          {
            params: { workspace: ids.a },
            raw,
            headers: { "x-signature": "signed-by-b" },
          },
        ],
        hidden: () => ["good"],
      }),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/^bad-signature: expected 401, got 200/),
    );
    expect(found).toContain("bad-signature: a forged request changed rows");
    expect(found).toContain(
      "cross-workspace: workspace B's credential changed a row in A",
    );
  });
  it("reports a signed fixture without forged, crossed or secret values", async () => {
    const found = await checks(
      declared("brokenUnverifiedSigned"),
      fixture({
        seed: async (env) => ({ a: env.a }),
        valid: (ids) => ({
          params: { workspace: ids.a },
          raw: JSON.stringify({ name: "x" }),
        }),
      }),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "hidden: a signed fixture declares no secret values",
        "bad-signature: the fixture declares no forged requests",
        "cross-workspace: the fixture declares no workspace B requests",
      ]),
    );
  });
  it("gives an event the handler's raw result, and the caller only the parsed response", async () => {
    const env = contractEnv();
    for (const [method, path, headers, target] of [
      [
        "PUT",
        `/quills/${env.a}/probe/event-raw`,
        { "x-test-user": env.owner },
        "probe-event-raw-teammate",
      ],
      [
        "POST",
        `/quills-public/${env.a}/probe/event-raw`,
        {},
        "probe-event-raw-public",
      ],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(await res.json()).toEqual({ changed: true });
      const { rows } = await pool.query(
        "SELECT metadata->>'receipt' AS receipt FROM quills.audit_log WHERE workspace_id=$1 AND target_id=$2",
        [env.a, target],
      );
      expect(rows).toEqual([{ receipt: "before:after" }]);
    }
  });
  it("gives public and signed handlers request metadata, and teammates none", async () => {
    const env = contractEnv();
    const meta = await app.request(
      `/quills-public/${env.a}/probe/request-meta`,
      {
        headers: {
          "user-agent": "x".repeat(600),
          "cf-ipcountry": "de",
          dnt: "1",
          "x-kaneo-client-ip": "203.0.113.9",
          cookie: "secret=1",
        },
      },
    );
    expect(await meta.json()).toEqual({
      present: true,
      ip: "203.0.113.9",
      userAgent: "x".repeat(512),
      country: "DE",
      doNotTrack: true,
      keys: ["country", "doNotTrack", "ip", "userAgent"],
    });
    const unknown = await app.request(
      `/quills-public/${env.a}/probe/request-meta`,
      { headers: { "cf-ipcountry": "XX", "sec-gpc": "1" } },
    );
    expect(await unknown.json()).toMatchObject({
      country: null,
      doNotTrack: true,
      userAgent: null,
    });
    const teammate = await app.request(`/quills/${env.a}/probe/request-meta`, {
      headers: { "x-test-user": env.owner },
    });
    expect(await teammate.json()).toEqual({ present: false });
    const signed = await app.request(
      `/quills-public/signed/probe/${env.a}/request-meta`,
      { headers: { "x-delivery": crypto.randomUUID() } },
    );
    expect(await signed.json()).toEqual({ present: true });
    const redirected = await app.request(
      `/quills-public/signed/probe/${env.a}/request-meta`,
      {
        headers: {
          "x-delivery": crypto.randomUUID(),
          "sec-fetch-mode": "navigate",
        },
      },
    );
    expect([redirected.status, redirected.headers.get("location")]).toEqual([
      303,
      "https://web.example.test/result?present=true",
    ]);
  });
  it("reports an internal route without the token check", async () => {
    const previous = process.env.QUILLS_INTERNAL_TOKEN;
    process.env.QUILLS_INTERNAL_TOKEN = "self-test-token";
    try {
      const found = await checks(
        brokenInternal,
        fixture({
          seed: async () => ({}),
          valid: () => ({
            headers: { authorization: "Bearer self-test-token" },
          }),
        }),
      );
      expect(found).toContain(
        "registered: the route is not mounted through defineQuillsRoute",
      );
      expect(found).toContain(
        "internal-disabled: expected 404 without the variable, got 200",
      );
      expect(found).toContainEqual(
        expect.stringMatching(
          /^internal-token: expected 401 for no token, got 200/,
        ),
      );
    } finally {
      if (previous === undefined) delete process.env.QUILLS_INTERNAL_TOKEN;
      else process.env.QUILLS_INTERNAL_TOKEN = previous;
    }
  });
  it("skips strict-response only for a raw route, and still checks its content type and leaks", async () => {
    const leaky = fixture({
      seed: async () => ({}),
      valid: () => ({}),
      hidden: () => ["raw-private-value"],
    });
    const asJson = await checks(rawAsJson, leaky);
    expect(asJson).toContain(
      "raw-response: expected a application/rss+xml document, got application/json",
    );
    expect(asJson).toContainEqual(
      expect.stringMatching(/^hidden: the response contains raw-private-value/),
    );
    expect(await checks(jsonAsXml, leaky)).toContain(
      "strict-response: expected application/json, got application/xml",
    );
    const found = await checks(
      declared("brokenRawLeak"),
      fixture({
        seed: async (env) => {
          const name = env.id("private-board");
          await env.scoped(env.a, (db) =>
            db.insert(boards).values({ name, slug: name }),
          );
          return { name };
        },
        valid: () => ({}),
        hidden: (ids) => [ids.name],
      }),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/^hidden: the response contains .*private-board/),
    );
    expect(found.filter((f) => /^(strict|raw)-response/.test(f))).toEqual([]);
  });
  it("reads a text/plain body as JSON only on a textBody route", async () => {
    const env = contractEnv();
    const post = (path: string, body: string) =>
      app.request(`/quills-public/${env.a}/probe/${path}`, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body,
      });
    const ok = await post("text-body", JSON.stringify({ n: 3 }));
    expect([ok.status, await ok.json()]).toEqual([200, { n: 3 }]);
    expect((await post("text-body", JSON.stringify({ n: 11 }))).status).toBe(
      400,
    );
    expect((await post("text-body", "not json")).status).toBe(400);
    // The body bound of a textBody route: 8 KiB, read before any parser.
    const large = JSON.stringify({ n: 3, pad: "x".repeat(9000) });
    expect((await post("text-body", large)).status).toBe(413);
    expect((await post("json-body", JSON.stringify({ n: 3 }))).status).toBe(
      415,
    );
  });
  it("runs a portal route's call between two transactions that see the same caller", async () => {
    const env = contractEnv();
    const { principalId } = await env.portalCustomer(env.a, env.customerA);
    const send = () =>
      app.request(`/quills-public/${env.a}/probe/prepared`, {
        method: "POST",
        headers: { "x-test-user": env.customerA },
      });
    const ok = await send();
    expect(await ok.json()).toEqual({
      called: `called ${env.a}:${principalId}`,
      caller: principalId,
      workspaceId: env.a,
    });
    // The account loses its profile link while the call runs: the handler must not act for it.
    between = () =>
      pool.query(
        "UPDATE quills.customer_identity SET kaneo_user_id=NULL WHERE workspace_id=$1 AND kaneo_user_id=$2",
        [env.a, env.customerA],
      );
    try {
      const changed = await send();
      expect(changed.status).toBe(409);
    } finally {
      between = undefined;
    }
  });
  it("reports a widget route that lets another visitor change the visitor's records", async () => {
    const found = await checks(
      declared("brokenWidgetClaim"),
      fixture({
        seed: async (env) => ({
          ...(await env.widgetVisitor(env.a)),
          label: env.id("claim"),
        }),
        valid: (ids) => ({ bearer: ids.token, body: { label: ids.label } }),
        probe: (env, ids) =>
          env.scoped(env.a, (db) =>
            db
              .select({ id: boards.id })
              .from(boards)
              .where(eq(boards.name, ids.label)),
          ),
      }),
    );
    expect(found).toContain(
      "customer-ownership: another widget visitor changed the visitor's records",
    );
  });
});

// The declaration rules of the raw, textBody and non-teammate prepare options, without a database.
describe("raw, textBody and prepare declaration rules", () => {
  const base = {
    method: "get" as const,
    path: "/rules",
    operationId: "rules",
    summary: "Rules",
    action: "read" as const,
    responseDescription: "Rules",
  };
  it("takes a raw response only on a non-teammate read with a string response", () => {
    const raw = { ...base, raw: "application/xml" as const };
    expect(() =>
      buildQuillsRoute({
        ...raw,
        audience: "public",
        response: z.string(),
        handler: async () => "",
      }),
    ).not.toThrow();
    expect(() =>
      buildQuillsRoute({
        ...raw,
        response: z.string(),
        handler: async () => "",
      }),
    ).toThrow(/raw response/);
    expect(() =>
      buildQuillsRoute({
        ...raw,
        audience: "public",
        response: z.object({}),
        handler: async () => ({}),
      }),
    ).toThrow(/raw response/);
    expect(() =>
      buildQuillsRoute({
        ...raw,
        audience: "public",
        method: "post",
        response: z.string(),
        event: { none: "Rules" },
        handler: async () => "",
      }),
    ).toThrow(/raw response/);
  });
  it("takes an HTML response only on a signed read, and RSS or XML never there", () => {
    const signed = {
      ...base,
      audience: "signed" as const,
      verifier: {
        name: "rules",
        locate: () => ({ scope: { workspace: "rules" }, deliveryId: "rules" }),
      },
      replay: "",
      event: { none: "Rules" },
      response: z.string(),
      handler: async () => "",
    };
    expect(() =>
      buildQuillsRoute({ ...signed, raw: "text/html" }),
    ).not.toThrow();
    expect(() =>
      buildQuillsRoute({ ...signed, raw: "application/xml" }),
    ).toThrow(/raw response/);
    expect(() =>
      buildQuillsRoute({
        ...signed,
        raw: "text/html",
        method: "post",
      }),
    ).toThrow(/raw response/);
    for (const audience of ["public", "portal", "widget"] as const)
      expect(() =>
        buildQuillsRoute({
          ...base,
          audience,
          raw: "text/html",
          response: z.string(),
          handler: async () => "",
        }),
      ).toThrow(/raw response/);
  });
  it("takes a browser result only on a signed JSON route", () => {
    const route = {
      ...base,
      audience: "signed" as const,
      verifier: {
        name: "redirect-rules",
        locate: () => ({
          scope: { workspace: "rules" },
          deliveryId: "rules",
        }),
      },
      response: z.object({ ok: z.boolean() }),
      replay: { ok: false },
      redirect: {
        success: () => "https://web.example.test/result",
        failure: () => "https://web.example.test/result?outcome=failed",
      },
      event: { none: "Rules" },
      handler: async () => ({ ok: true }),
    };
    expect(() => buildQuillsRoute(route)).not.toThrow();
    expect(() =>
      buildQuillsRoute({
        ...route,
        method: "post",
      }),
    ).not.toThrow();
    expect(() =>
      buildQuillsRoute({
        ...base,
        response: z.object({ ok: z.boolean() }),
        redirect: route.redirect,
        handler: async () => ({ ok: true }),
      }),
    ).toThrow(/browser redirect/);
    expect(() =>
      buildQuillsRoute({
        ...route,
        raw: "text/html",
        response: z.string(),
        replay: "",
        handler: async () => "",
      }),
    ).toThrow(/browser redirect/);
  });
  it("lets an HTML page run only the scripts that its route declares", () => {
    const policy = (scripts?: string[]) =>
      htmlHeaders(scripts)["content-security-policy"];
    const hash = (script: string) =>
      `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
    expect(policy(["go()", "stop()"])).toContain(
      `script-src ${hash("go()")} ${hash("stop()")}; connect-src 'self';`,
    );
    expect(policy()).toContain("script-src 'none';");
    expect(htmlHeaders()).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    expect(policy()).toContain("frame-ancestors 'none'");
    expect(() =>
      buildQuillsRoute({
        ...base,
        audience: "public",
        raw: "application/xml",
        scripts: ["go()"],
        response: z.string(),
        handler: async () => "",
      }),
    ).toThrow(/scripts are for an HTML page/);
  });
  it("takes textBody only on a public route with a body", () => {
    const route = {
      ...base,
      method: "post" as const,
      event: { none: "Rules" },
      body: z.object({ n: z.number().max(1) }),
      response: z.object({}),
      textBody: true as const,
      handler: async () => ({}),
    };
    expect(() =>
      buildQuillsRoute({ ...route, audience: "public" }),
    ).not.toThrow();
    expect(() => buildQuillsRoute({ ...route, audience: "portal" })).toThrow(
      /textBody/,
    );
    expect(() => buildQuillsRoute({ ...route, audience: "widget" })).toThrow(
      /textBody/,
    );
  });
  it("takes prepare on a portal or widget route, not with ensureCustomer and not on a public route", () => {
    const route = {
      ...base,
      response: z.object({}),
      prepare: async () => null,
      call: async () => null,
      handler: async () => ({}),
    };
    expect(() =>
      buildQuillsRoute({ ...route, audience: "widget" }),
    ).not.toThrow();
    expect(() =>
      buildQuillsRoute({
        ...route,
        audience: "portal",
        method: "post",
        event: { none: "Rules" },
        ensureCustomer: true,
      }),
    ).toThrow(/without ensureCustomer/);
    expect(() => buildQuillsRoute({ ...route, audience: "public" })).toThrow(
      /prepare and call/,
    );
  });
  it("takes a capability on an app route only, revert only with call, sessionOnly only on a teammate route", () => {
    const route = {
      ...base,
      response: z.object({}),
      handler: async () => ({}),
    };
    expect(() =>
      buildQuillsRoute({
        ...route,
        audience: "app",
        capability: "read:feedback",
      }),
    ).not.toThrow();
    expect(() => buildQuillsRoute({ ...route, audience: "app" })).toThrow(
      /names its capability/,
    );
    expect(() =>
      buildQuillsRoute({ ...route, capability: "read:feedback" }),
    ).toThrow(/names its capability/);
    expect(() =>
      buildQuillsRoute({ ...route, revert: async () => {} }),
    ).toThrow(/revert/);
    expect(() =>
      buildQuillsRoute({
        ...route,
        audience: "app",
        capability: "read:feedback",
        sessionOnly: true,
      }),
    ).toThrow(/sessionOnly/);
  });
});

// The bounded-inputs rules, without a database.
describe("bounded-inputs schema rules", () => {
  it("accepts TypeIDs, paging numbers, bounded strings, arrays and refined records", () => {
    const bounded = z.object({
      id: flexibleToTypeIdSchema("board"),
      owner: z.union([z.literal("none"), flexibleToTypeIdSchema("principal")]),
      limit: pagingNumber(1, 100, 20),
      when: z.iso.date().optional(),
      at: z.iso.datetime({ offset: true }).max(64).optional(),
      tags: z.array(z.string().max(20)).max(10),
      attributes: z
        .record(z.string().max(64), z.string().max(100).nullable())
        .refine((value) => Object.keys(value).length <= 50),
      kind: z.enum(["a", "b"]),
    });
    expect(unbounded(bounded, "body")).toEqual([]);
  });
  it("reports each unbounded string, array, record and page size", () => {
    const loose = z.object({
      name: z.string().min(1),
      email: z.email(),
      slug: z.string().regex(/^[a-z]+$/),
      at: z.iso.datetime({ offset: true }),
      ids: z.array(flexibleToTypeIdSchema("board")),
      attributes: z.record(z.string().max(64), z.boolean()),
      limit: z.coerce.number().int().min(1),
      extra: z.unknown(),
      meta: z.looseObject({ kind: z.string().max(10) }),
    });
    expect(unbounded(loose, "body")).toEqual([
      "body.name accepts a string of 100001 characters",
      "body.email accepts a string of 100001 characters",
      "body.slug accepts a string of 100001 characters",
      "body.at accepts a string of 100001 characters",
      "body.ids has no maximum length",
      "body.attributes accepts 10001 entries",
      "body.limit has no maximum",
      "body.extra (unknown) has no maximum",
      "body.meta.* (unknown) has no maximum",
    ]);
  });
});
