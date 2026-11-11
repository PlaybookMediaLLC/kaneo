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
import { defineQuillsRoute, type AnyQuillsRoute } from "./define-route";
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

const app = contractApp(
  apiRouter<BaseVariables & { workspaceId: string }>()
    .openapi(...teammateMeta)
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
    .openapi(...deletedBoard),
  apiRouter()
    .openapi(...publicLeak)
    .openapi(...noOwnership)
    .openapi(...teammateData)
    .openapi(...anyToken)
    .openapi(...unboundedPortal)
    .openapi(...publicDeletedBoard)
    .openapi(...unverified)
    .openapi(...publicMeta)
    .openapi(...signedMeta)
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
    // The second one is the broken internal route below.
    expect(unregisteredRoutes(app)).toEqual([
      "PUT /quills/:workspaceId/broken/no-permission",
      "POST /quills-public/internal/broken/wake",
    ]);
    const found = await checks(noPermission);
    for (const check of ["registered", "denied-action", "api-key-scope"])
      expect(found).toContainEqual(expect.stringMatching(`^${check}: `));
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
