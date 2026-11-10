import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  withQuillsWorkspace,
  type Database,
} from "../../database/quills/client";
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
});
