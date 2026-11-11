import { resolve } from "node:path";
import { inArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";
import {
  withQuillsAudience,
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../../database/quills/client";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { runQuillsMigrations } from "../../database/quills/migrate";
import * as kaneo from "../../database/schema";
import { httpExceptionResponse } from "../../errors/http-exception-response";
import type { BaseVariables } from "../../openapi";
import { mintWidgetSession, resolveCaller, widgetEnabled } from "./audience";
import { registry } from "./registry";

// The contract test world: real PostgreSQL, workspaces A and B, identity from test headers.
// The checks are in contract-checks.ts; contract.ts exports both.

export type Finding = { check: string; detail: string };
export type ContractInput = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Widget routes: the widget session token of the valid caller. */
  bearer?: string;
  /** Signed and internal routes: the exact body bytes, sent instead of `body`. */
  raw?: string;
  /** Signed and internal routes: signature, delivery or token headers. */
  headers?: Record<string, string>;
};
type WidgetVisitor = {
  token: string;
  principalId: string;
  customerId: string;
};
export type ContractEnv = {
  a: string;
  b: string;
  /** The owner of A. */
  owner: string;
  /** Kaneo accounts with no membership: portal customers A (the valid caller) and B. */
  customerA: string;
  customerB: string;
  db: NodePgDatabase<typeof kaneo>;
  /** A unique ID for seeded rows. */
  id: (label: string) => string;
  /** A scoped transaction in A or B as that workspace's owner, or as `userId` (a member or an instance administrator). */
  scoped: <T>(
    workspaceId: string,
    work: (db: Database, actor: QuillsActor) => Promise<T>,
    userId?: string,
  ) => Promise<T>;
  /** The portal customer profile of a Kaneo account, created through the portal resolver. */
  portalCustomer: (
    workspaceId: string,
    userId: string,
  ) => Promise<{ principalId: string; customerId: string }>;
  /** A new identified widget visitor and its session token. */
  widgetVisitor: (
    workspaceId: string,
    options?: { expired?: boolean },
  ) => Promise<WidgetVisitor>;
};
export type Fixture<T = any> = {
  /** Fresh rows for one request. Called once per stateful check, with the user who sends that check's main request. */
  seed: (env: ContractEnv, caller: string) => Promise<T>;
  /** A request in workspace A that succeeds for an authorized caller. */
  valid: (ids: T) => ContractInput;
  /** Workspace B values, keyed by the param, query or body field they replace. */
  foreign?: (ids: T) => Record<string, string>;
  /** Non-teammate: values that no response may contain (private, secret or workspace B data). */
  hidden?: (ids: T) => string[];
  /** Portal: values that belong to customer A; customer B and a teammate must not read them. */
  own?: (ids: T) => string[];
  /** Portal: a snapshot of customer A's records; another caller's request must not change it. */
  probe?: (env: ContractEnv, ids: T) => Promise<unknown>;
  /**
   * Widget: requests with a forged credential, for example a wrong HMAC. Each is rejected.
   * Signed: a bad or missing signature, a stale timestamp. Each is 401 and changes nothing.
   */
  forged?: (ids: T) => ContractInput[];
  /**
   * Signed: requests that workspace B's credential signs, aimed at A's credential and at B's own.
   * None may change a row in A or return A's data.
   */
  crossed?: (ids: T) => ContractInput[];
  /** Signed: correctly signed requests whose body the schema rejects. Each is 400 and changes nothing. */
  invalid?: (ids: T) => ContractInput[];
  /** The principal that the audit row of the authorized request names, when the audience default does not apply. */
  actor?: (env: ContractEnv, ids: T, body: any) => Promise<string | null>;
  /** The target is soft-deletable: soft-delete the target of `valid(ids)` in A. The request must then return 404. */
  softDelete?: (env: ContractEnv, ids: T) => Promise<unknown>;
};
export const fixture = <T>(f: Fixture<T>) => f;
export const empty = fixture({ seed: async () => ({}), valid: () => ({}) });

export type App = Hono<any, any, any>;

// Shared with contract-checks.ts and contract-probe.ts; contract.ts does not export them.
export const prefix = `contract_${Date.now().toString(36)}`;
export const users = {
  owner: `${prefix}_owner`,
  outsider: `${prefix}_outsider`,
  removed: `${prefix}_removed`,
  limited: `${prefix}_limited`,
  admin: `${prefix}_admin`,
  customerA: `${prefix}_customer_a`,
  customerB: `${prefix}_customer_b`,
};
export const role = `${prefix}_role`;
export let pool: Pool;
export let env: ContractEnv;
export let fingerprintSql: { all: string; domain: string };

/** Seeds workspaces A and B, the test users and their API keys. Use a disposable local quills_ database. */
export async function startContract(testPool: Pool, url: string) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/quills_")
  )
    throw new Error("Use a disposable local quills_ database");
  pool = testPool;
  const db = drizzle(pool, { schema: kaneo });
  await migrate(drizzle(pool), { migrationsFolder: resolve("drizzle") });
  await runQuillsMigrations(url, resolve("drizzle/quills"));
  const a = `${prefix}_a`,
    b = `${prefix}_b`;
  await db.insert(kaneo.userTable).values(
    Object.values(users).map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      role: id === users.admin ? "admin" : null,
    })),
  );
  await db
    .insert(kaneo.workspaceTable)
    .values(
      [a, b].map((id) => ({ id, name: id, slug: id, createdAt: new Date() })),
    );
  await db
    .insert(kaneo.workspaceRoleTable)
    .values({ workspaceId: a, role, permission: "{}", createdAt: new Date() });
  await db.insert(kaneo.workspaceUserTable).values(
    (
      [
        [a, users.owner, "owner"],
        [b, users.outsider, "owner"],
        [a, users.removed, "member"],
        [a, users.limited, role],
      ] as const
    ).map(([workspaceId, userId, memberRole]) => ({
      workspaceId,
      userId,
      role: memberRole,
      joinedAt: new Date(),
    })),
  );
  await db.insert(kaneo.apikeyTable).values(
    [users.owner, users.limited].map((id) => ({
      id: `${id}_key`,
      key: `${id}_key`,
      name: "Contract",
      referenceId: id,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  // Actors exist before the checks, so a request never changes the fingerprint by provisioning one.
  for (const [workspaceId, userId] of [
    [a, users.owner],
    [a, users.limited],
    [a, users.removed],
    [b, users.outsider],
  ] as const)
    await withQuillsWorkspace({ workspaceId, userId }, async () => {});
  await pool.query(
    "DELETE FROM public.workspace_member WHERE workspace_id=$1 AND user_id=$2",
    [a, users.removed],
  );
  const tables: string[] = (
    await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attribute t ON t.attrelid=c.oid AND t.attname='workspace_id' AND NOT t.attisdropped
       WHERE n.nspname='quills' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1`,
    )
  ).rows.map((row) => row.relname);
  const hash = (list: string[]) =>
    `SELECT ${list
      .map(
        (table) =>
          `(SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM quills."${table}" x WHERE x.workspace_id=$1)`,
      )
      .join(" || ")} AS h`;
  fingerprintSql = {
    // Rate-limit counters commit on purpose before a request fails; they are not request data.
    all: hash(tables.filter((t) => t !== "rate_bucket")),
    domain: hash(
      tables.filter(
        (t) => !["audit_log", "events", "job_queue", "rate_bucket"].includes(t),
      ),
    ),
  };
  let count = 0;
  env = {
    a,
    b,
    owner: users.owner,
    db,
    id: (label) => `${prefix}_${label}_${++count}`,
    scoped: (workspaceId, work, userId) =>
      withQuillsWorkspace(
        {
          workspaceId,
          userId: userId ?? (workspaceId === a ? users.owner : users.outsider),
        },
        work,
      ),
    customerA: users.customerA,
    customerB: users.customerB,
    portalCustomer: async (workspaceId, userId) => {
      const session = await contractSession(
        new Headers({ "x-test-user": userId }),
      );
      // The team grant is not part of profile creation.
      const account = { ...session!.user, member: false };
      return withQuillsAudience(
        { workspace: workspaceId, kaneoUserId: userId },
        async (db) => {
          const caller = await resolveCaller(
            db,
            "portal",
            { account, tokenHash: null },
            { signIn: true, ensureCustomer: true },
          );
          return {
            principalId: caller.principalId!,
            customerId: caller.customerId!,
          };
        },
      );
    },
    widgetVisitor: (workspaceId, options = {}) =>
      withQuillsAudience({ workspace: workspaceId }, async (db) => {
        const label = env.id("visitor");
        const [identity] = await db
          .insert(customer)
          .values({
            name: label,
            email: `${label}@example.test`,
            externalId: label,
          })
          .returning({ id: customer.id });
        const [person] = await db
          .insert(principal)
          .values({
            userId: identity!.id,
            role: "user",
            type: "user",
            displayName: label,
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        // A session needs the widget on and a signing secret; keep a secret that a fixture set.
        const [config] = await db
          .select({
            widgetConfig: settings.widgetConfig,
            widgetSecret: settings.widgetSecret,
          })
          .from(settings);
        const secret = config?.widgetSecret ?? `wgt_${label}`;
        if (!config?.widgetSecret || !widgetEnabled(config.widgetConfig))
          await db.update(settings).set({
            widgetConfig: JSON.stringify({ enabled: true }),
            widgetSecret: secret,
          });
        const owner = { principalId: person!.id, customerId: identity!.id };
        const { token } = await mintWidgetSession(
          db,
          owner,
          secret,
          options.expired ? new Date(Date.now() - 1000) : undefined,
        );
        return { token, ...owner };
      }),
  };
  return env;
}

/** The Kaneo session for the x-test-user header. Tests mock getUserSession with it. */
export async function contractSession(headers: Headers) {
  const id = headers.get("x-test-user");
  if (!id) return null;
  const {
    rows: [user],
  } = await pool.query(
    `SELECT id, name, email, email_verified AS "emailVerified", image FROM public."user" WHERE id=$1`,
    [id],
  );
  return user ? { user, session: { id: `${id}_session` } } : null;
}

export async function stopContract() {
  if (!pool) return;
  await pool.query("DELETE FROM public.workspace WHERE id = ANY($1::text[])", [
    [env.a, env.b],
  ]);
  await env.db
    .delete(kaneo.userTable)
    .where(inArray(kaneo.userTable.id, Object.values(users)));
  await pool.end();
}

/** The seeded workspaces and helpers, for feature tests that run after startContract. */
export const contractEnv = () => env;

/**
 * The Quills router behind header identity and the API's error responses, and the
 * /quills-public router, whose portal routes read the mocked Kaneo session instead.
 */
export function contractApp(router: App, publicRouter?: App) {
  const app = new Hono<{
    Variables: BaseVariables & { workspaceId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user") ?? "");
    c.set("user", null);
    const scope = c.req.header("x-test-scope");
    if (scope)
      c.set("apiKey", {
        id: `${c.get("userId")}_key`,
        userId: c.get("userId"),
        enabled: true,
        permissions: JSON.parse(scope),
      });
    await next();
  });
  app.onError((error) =>
    error instanceof HTTPException
      ? httpExceptionResponse(error)
      : Response.json({ message: String(error) }, { status: 500 }),
  );
  app.route("/quills", router);
  if (publicRouter) app.route("/quills-public", publicRouter);
  return app;
}

/** Routes under /quills and /quills-public that were not mounted through defineQuillsRoute. */
export function unregisteredRoutes(app: App) {
  const handlers = new Set(registry.values());
  const routes = new Map<string, boolean>();
  for (const route of app.routes)
    if (
      route.method !== "ALL" &&
      (route.path.startsWith("/quills/") ||
        route.path.startsWith("/quills-public/"))
    ) {
      const key = `${route.method} ${route.path}`;
      routes.set(key, routes.get(key) || handlers.has(route.handler));
    }
  return [...routes]
    .filter(([, registered]) => !registered)
    .map(([key]) => key);
}
