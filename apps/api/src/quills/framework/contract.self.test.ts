import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
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
  z,
  type BaseVariables,
} from "../../openapi";
import { workspaceAccess } from "../../utils/workspace-access-middleware";
import {
  checkRoute,
  contractApp,
  contractSession,
  empty,
  fixture,
  startContract,
  stopContract,
  unregisteredRoutes,
} from "./contract";
import { defineQuillsRoute, type AnyQuillsRoute } from "./define-route";
import { registry } from "./registry";

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

const app = contractApp(
  apiRouter<BaseVariables & { workspaceId: string }>()
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
    .openapi(...noEvent),
  apiRouter()
    .openapi(...publicLeak)
    .openapi(...noOwnership)
    .openapi(...teammateData)
    .openapi(...anyToken),
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
    expect(unregisteredRoutes(app)).toEqual([
      "PUT /quills/:workspaceId/broken/no-permission",
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
});
