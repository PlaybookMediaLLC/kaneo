import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";
import { fromUuid, toUuid } from "@kaneo/ids";
import { statement } from "@kaneo/permissions";
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
import { apiRouter, z, type BaseVariables } from "../../openapi";
import type { PermissionMap } from "../../utils/role-permissions";
import {
  hashToken,
  mintWidgetSession,
  resolveCaller,
  widgetEnabled,
} from "./audience";
import { buildQuillsRoute, type AnyQuillsRoute } from "./define-route";
import { registry } from "./registry";

// Contract checks for Quills routes: real PostgreSQL, workspaces A and B, identity from test headers.

export type Finding = { check: string; detail: string };
export type ContractInput = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Widget routes: the widget session token of the valid caller. */
  bearer?: string;
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
  /** A scoped transaction in A or B as that workspace's owner. */
  scoped: <T>(
    workspaceId: string,
    work: (db: Database, actor: QuillsActor) => Promise<T>,
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
  /** Widget: requests with a forged credential, for example a wrong HMAC. Each is rejected. */
  forged?: (ids: T) => ContractInput[];
  /** The principal that the audit row of the authorized request names, when the audience default does not apply. */
  actor?: (env: ContractEnv, ids: T, body: any) => Promise<string | null>;
};
export const fixture = <T>(f: Fixture<T>) => f;
export const empty = fixture({ seed: async () => ({}), valid: () => ({}) });

type App = Hono<any, any, any>;
type Sent = { status: number; body: any };

const prefix = `contract_${Date.now().toString(36)}`;
const users = {
  owner: `${prefix}_owner`,
  outsider: `${prefix}_outsider`,
  removed: `${prefix}_removed`,
  limited: `${prefix}_limited`,
  admin: `${prefix}_admin`,
  customerA: `${prefix}_customer_a`,
  customerB: `${prefix}_customer_b`,
};
const role = `${prefix}_role`;
const forbiddenKey = /secret|token|password|hash|workspaceId/i;
let pool: Pool;
let env: ContractEnv;
let fingerprintSql: { all: string; domain: string };

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
    scoped: (workspaceId, work) =>
      withQuillsWorkspace(
        {
          workspaceId,
          userId: workspaceId === a ? users.owner : users.outsider,
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

let clientCount = 0;
async function send(
  app: App,
  d: AnyQuillsRoute,
  input: ContractInput,
  user: string,
  scope?: PermissionMap,
  workspace = env.a,
): Promise<Sent> {
  const teammate = (d.audience ?? "teammate") === "teammate";
  let path = `${teammate ? "/quills" : "/quills-public"}/${workspace}${d.path}`;
  for (const [key, value] of Object.entries(input.params ?? {}))
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  const query = new URLSearchParams(input.query).toString();
  const res = await app.request(query ? `${path}?${query}` : path, {
    method: d.method.toUpperCase(),
    headers: {
      "x-test-user": user,
      ...(input.body !== undefined && { "content-type": "application/json" }),
      ...(scope && { "x-test-scope": JSON.stringify(scope) }),
      ...(input.bearer && { authorization: `Bearer ${input.bearer}` }),
      // A fresh client per request keeps the checks under the rate limits; rate-limit.test.ts covers them.
      "x-kaneo-client-ip": `198.51.100.${++clientCount % 250}`,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The declared Quills action, or every other action, with or without the native permissions. */
const grant = (
  d: AnyQuillsRoute,
  allowed: boolean,
  native = true,
): PermissionMap => ({
  ...(native && d.native),
  workspace: [...((native && d.native?.workspace) || []), "read"],
  quills: allowed
    ? [d.action]
    : statement.quills.filter((action) => action !== d.action),
});

const setRole = (permission: PermissionMap) =>
  pool.query(
    "UPDATE public.workspace_role SET permission=$1 WHERE workspace_id=$2 AND role=$3",
    [JSON.stringify(permission), env.a, role],
  );

const fingerprint = async (
  workspaceId: string,
  rows: keyof typeof fingerprintSql = "all",
): Promise<string> =>
  (await pool.query(fingerprintSql[rows], [workspaceId])).rows[0].h;

const replace = (
  input: ContractInput,
  key: string,
  value: string,
): ContractInput => {
  if (input.params && key in input.params)
    return { ...input, params: { ...input.params, [key]: value } };
  if (input.query && key in input.query)
    return { ...input, query: { ...input.query, [key]: value } };
  return { ...input, body: { ...(input.body as object), [key]: value } };
};

/** Inputs that the declared schemas must reject with 400. */
function badInputs(d: AnyQuillsRoute, input: ContractInput) {
  const bad: ContractInput[] = [];
  for (const key of Object.keys(input.params ?? {}))
    if (!d.params?.shape[key]?.safeParse("!").success)
      bad.push(replace(input, key, "!"));
  if (d.query?.shape.limit)
    bad.push({ ...input, query: { ...input.query, limit: "1000000000" } });
  if (d.body)
    bad.push(
      { ...input, body: "not an object" },
      { ...input, body: undefined },
    );
  return bad;
}

/** Response values that a closed object schema does not declare. */
function looseness(schema: z.ZodType, value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    return looseness(schema.unwrap() as z.ZodType, value, path);
  if (schema instanceof z.ZodArray && Array.isArray(value))
    return value.flatMap((item, index) =>
      looseness(schema.element as z.ZodType, item, `${path}[${index}]`),
    );
  const catchall = schema instanceof z.ZodObject && schema.def.catchall;
  if (
    !(schema instanceof z.ZodObject) ||
    Array.isArray(value) ||
    (catchall && !(catchall instanceof z.ZodNever))
  )
    return [`${path} is not a closed object schema`];
  return Object.entries(value).flatMap(([key, item]) => {
    const field = schema.shape[key] as z.ZodType | undefined;
    return field
      ? looseness(field, item, `${path}.${key}`)
      : [`${path}.${key} is not declared`];
  });
}

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value !== null && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

const keyNames = (value: unknown): string[] =>
  value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, item]) => [key, ...keyNames(item)])
    : [];

/** Outbox rows written by the authorized request since `since`. */
async function outboxIssues(
  d: AnyQuillsRoute,
  input: ContractInput,
  body: unknown,
  since: string,
  domain: string,
  /** The teammate who called, or the principal (a TypeID or null) that the audit row must name. */
  actor: { kaneoUserId: string } | { principalId: string | null } = {
    kaneoUserId: users.limited,
  },
): Promise<string[]> {
  const change =
    typeof d.event === "function" &&
    d.event(
      {
        params: d.params?.parse(input.params),
        query: d.query?.parse(input.query ?? {}),
        body: d.body?.parse(input.body),
        workspaceId: env.a,
      },
      // The JSON body, not a parse with the server schema: dates arrive as strings.
      body,
    );
  const byTeammate = "kaneoUserId" in actor;
  const {
    rows: [n],
  } = await pool.query(
    `SELECT
      (SELECT count(*) FROM quills.events WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz)::int AS events,
      (SELECT count(*) FROM quills.events WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz AND type=$3 AND entity_id=$4)::int AS "matchingEvents",
      (SELECT count(*) FROM quills.audit_log WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz)::int AS audit,
      (SELECT count(*) FROM quills.audit_log l LEFT JOIN quills.principal p ON p.id=l.actor_principal_id AND p.workspace_id=l.workspace_id
        WHERE l.workspace_id=$1 AND l.occurred_at>=$2::timestamptz AND l.event_type=$3 AND l.target_id=$4
        AND CASE WHEN $6::boolean THEN p.kaneo_user_id=$5 ELSE l.actor_principal_id IS NOT DISTINCT FROM $7::uuid END)::int AS "matchingAudit",
      (SELECT count(*) FROM quills.job_queue WHERE workspace_id=$1 AND created_at>=$2::timestamptz)::int AS jobs`,
    [
      env.a,
      since,
      change ? change.type : "",
      change ? change.entityId : "",
      byTeammate ? actor.kaneoUserId : "",
      byTeammate,
      !byTeammate && actor.principalId ? toUuid(actor.principalId) : null,
    ],
  );
  if (d.method === "get")
    return n.events ||
      n.audit ||
      n.jobs ||
      domain !== (await fingerprint(env.a, "domain"))
      ? ["a read wrote rows"]
      : [];
  if (typeof d.event !== "function")
    return n.events || n.jobs
      ? ["a route without an event wrote an outbox row"]
      : [];
  if (!change) return ["the authorized mutation recorded no change event"];
  return [
    ...(n.events === 1 && n.matchingEvents === 1
      ? []
      : [
          `expected one ${change.type} event for ${change.entityId}, found ${n.events} events`,
        ]),
    ...(n.audit === 1 && n.matchingAudit === 1
      ? []
      : [
          `expected one ${change.type} audit row by the caller, found ${n.audit}`,
        ]),
    ...(n.jobs === 1 ? [] : [`expected one job, found ${n.jobs}`]),
  ];
}

/** Runs every contract check for one declaration against `app`. An empty list passes. */
export async function checkRoute(
  app: App,
  d: AnyQuillsRoute,
  f: Fixture | undefined,
): Promise<Finding[]> {
  if (!f) return [{ check: "no-fixture", detail: d.operationId }];
  if ((d.audience ?? "teammate") !== "teammate")
    return checkAudienceRoute(app, d, f);
  const findings: Finding[] = [];
  const fail = (check: string, detail: string) =>
    findings.push({ check, detail });
  const expectStatus = async (
    check: string,
    statuses: number[],
    user: string,
    input: ContractInput,
    scope?: PermissionMap,
  ) => {
    const res = await send(app, d, input, user, scope);
    if (!statuses.includes(res.status))
      fail(
        check,
        `expected ${statuses.join(" or ")}, got ${res.status} ${JSON.stringify(res.body)}`,
      );
    return res;
  };

  const handler = registry.get(d);
  if (
    !handler ||
    !app.routes.some(
      (r) => r.handler === handler && r.method === d.method.toUpperCase(),
    )
  )
    fail("registered", "the route is not mounted through defineQuillsRoute");

  const ids = await f.seed(env, users.owner);
  const input = f.valid(ids);
  await expectStatus("no-session", [401], "", input);
  await expectStatus("other-workspace", [403, 404], users.outsider, input);
  await expectStatus("removed-member", [403, 404], users.removed, input);
  await pool.query(
    "UPDATE public.workspace SET archived_at=now() WHERE id=$1",
    [env.a],
  );
  try {
    await expectStatus("archived-workspace", [403], users.owner, input);
  } finally {
    await pool.query(
      "UPDATE public.workspace SET archived_at=NULL WHERE id=$1",
      [env.a],
    );
  }
  await setRole(grant(d, false));
  await expectStatus("denied-action", [403], users.limited, input);
  const scoped = await send(app, d, input, users.owner, grant(d, false));
  if (scoped.status !== 403 || scoped.body?.code !== "API_KEY_SCOPE")
    fail(
      "api-key-scope",
      `got ${scoped.status} ${JSON.stringify(scoped.body)}`,
    );
  for (const bad of badInputs(d, input))
    await expectStatus("schema-400", [400], users.owner, bad);
  // A route that authorizes a project must also hold the native permission.
  if (d.native || d.project) {
    await setRole(grant(d, true, false));
    await expectStatus("native-permission", [403], users.limited, input);
    const key = await send(app, d, input, users.owner, grant(d, true, false));
    if (key.status !== 403)
      fail("native-permission", `API key without it: got ${key.status}`);
  }

  // A foreign ID gets a declared error and changes nothing in either workspace.
  const rejected = [403, ...Object.keys(d.errors ?? {}).map(Number)];
  const foreign = f.foreign?.(ids) ?? {};
  const fields = Object.keys({
    ...input.query,
    ...(typeof input.body === "object" ? input.body : {}),
  }).filter((key) => key.endsWith("Id"));
  for (const key of [...Object.keys(input.params ?? {}), ...fields])
    if (!(key in foreign))
      fail("foreign-ids", `${key}: the fixture has no workspace B value`);
  for (const [key, value] of Object.entries(foreign)) {
    const before = `${await fingerprint(env.a)}${await fingerprint(env.b)}`;
    const res = await send(app, d, replace(input, key, value), users.owner);
    if (!rejected.includes(res.status))
      fail("foreign-ids", `${key}: got ${res.status}`);
    if (before !== `${await fingerprint(env.a)}${await fingerprint(env.b)}`)
      fail("foreign-ids", `${key}: rows changed`);
  }

  await setRole(grant(d, true));
  // A caller who can open no project in A: a project route denies, a read hides the seeded rows.
  if (d.project || d.native?.project) {
    await env.db.insert(kaneo.workspaceMemberAccessTable).values({
      workspaceId: env.a,
      userId: users.limited,
      projectAccess: "selected",
    });
    try {
      if (d.project)
        await expectStatus("private-project", [403, 404], users.limited, input);
      else {
        const res = await expectStatus(
          "private-project",
          [200],
          users.limited,
          input,
        );
        const text = JSON.stringify(res.body);
        const leaked = strings(ids).filter((id) => text.includes(id));
        if (leaked.length)
          fail("private-project", `leaked ${leaked.join(", ")}`);
      }
    } finally {
      await env.db
        .delete(kaneo.workspaceMemberAccessTable)
        .where(eq(kaneo.workspaceMemberAccessTable.userId, users.limited));
    }
  }

  const fresh = f.valid(await f.seed(env, users.limited));
  const since: string = (
    await pool.query("SELECT clock_timestamp()::text AS t")
  ).rows[0].t;
  const domain = await fingerprint(env.a, "domain");
  const ok = await send(app, d, fresh, users.limited, grant(d, true));
  if (ok.status !== 200)
    fail("authorized", `got ${ok.status} ${JSON.stringify(ok.body)}`);
  else {
    const issues = [
      ...looseness(d.response, ok.body),
      ...new Set(
        keyNames(ok.body)
          .filter(
            (key) => forbiddenKey.test(key) && !d.allowKeys?.includes(key),
          )
          .map((key) => `the response has a key named ${key}`),
      ),
    ];
    for (const issue of issues) fail("strict-response", issue);
    for (const issue of await outboxIssues(d, fresh, ok.body, since, domain))
      fail("outbox", issue);
  }

  await expectStatus(
    "instance-admin",
    [200],
    users.admin,
    f.valid(await f.seed(env, users.admin)),
  );

  if (d.body) {
    const target = f.valid(await f.seed(env, users.owner));
    const before = await fingerprint(env.b);
    await send(
      app,
      d,
      { ...target, body: { ...(target.body as object), workspaceId: env.b } },
      users.owner,
    );
    if (before !== (await fingerprint(env.b)))
      fail("foreign-body-workspace", "a row in workspace B changed");
  }

  for (const issue of await rollbackIssues(d, f, users.owner))
    fail("rollback", issue);
  return findings;
}

/** Fail after the handler, then fail the outbox write: neither may leave a row behind. */
async function rollbackIssues(d: AnyQuillsRoute, f: Fixture, user: string) {
  const issues: string[] = [];
  const event = d.event;
  const failures: Partial<AnyQuillsRoute>[] = [
    {
      handler: async (input) => {
        await d.handler(input);
        throw new Error("Injected failure after the handler");
      },
    },
    ...(typeof event === "function"
      ? [
          {
            event: (input: any, result: any) => {
              const change = event(input, result);
              return change && { ...change, entityId: "" };
            },
          },
        ]
      : []),
  ];
  for (const failure of d.method === "get" ? [] : failures) {
    const failing = apiRouter<
      BaseVariables & { workspaceId: string }
    >().openapi(...buildQuillsRoute({ ...d, ...failure }));
    const failingApp =
      (d.audience ?? "teammate") === "teammate"
        ? contractApp(failing)
        : contractApp(apiRouter(), failing);
    const target = f.valid(await f.seed(env, users.owner));
    const before = await fingerprint(env.a);
    const res = await send(failingApp, d, target, user);
    if (res.status !== 500) issues.push(`expected 500, got ${res.status}`);
    if (before !== (await fingerprint(env.a)))
      issues.push("rows changed after the failed request");
  }
  return issues;
}

/** The principal (TypeID) that a widget session token belongs to, or null. */
async function widgetPrincipal(workspaceId: string, token: string | undefined) {
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT value->>'principalId' AS id FROM quills.kv_store WHERE workspace_id=$1 AND key=$2",
    [workspaceId, `widget:session:${hashToken(token)}`],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

/** Customer A's portal principal (TypeID) in A, or null when the account has no profile there. */
async function portalPrincipal(userId: string) {
  const { rows } = await pool.query(
    `SELECT p.id FROM quills.principal p JOIN quills.customer_identity c ON c.id=p.user_id AND c.workspace_id=p.workspace_id
     WHERE c.workspace_id=$1 AND c.kaneo_user_id=$2`,
    [env.a, userId],
  );
  return rows[0] ? fromUuid("principal", rows[0].id) : null;
}

/**
 * Contract checks for a portal, widget or public route. The caller comes from the audience:
 * no identity (public), customer A's Kaneo session (portal) or the fixture's bearer (widget).
 */
async function checkAudienceRoute(
  app: App,
  d: AnyQuillsRoute,
  f: Fixture,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fail = (check: string, detail: string) =>
    findings.push({ check, detail });
  const audience = d.audience!;
  const signIn = audience !== "public" && d.signIn !== false;
  const caller = audience === "portal" ? users.customerA : "";
  const call = (input: ContractInput, user = caller, workspace = env.a) =>
    send(app, d, input, user, undefined, workspace);
  const expectStatus = async (
    check: string,
    statuses: number[],
    input: ContractInput,
    user = caller,
    workspace = env.a,
  ) => {
    const res = await call(input, user, workspace);
    if (!statuses.includes(res.status))
      fail(
        check,
        `expected ${statuses.join(" or ")}, got ${res.status} ${JSON.stringify(res.body)}`,
      );
    return res;
  };
  const both = async () =>
    `${await fingerprint(env.a)}${await fingerprint(env.b)}`;

  const handler = registry.get(d);
  if (
    !handler ||
    !app.routes.some(
      (r) => r.handler === handler && r.method === d.method.toUpperCase(),
    )
  )
    fail("registered", "the route is not mounted through defineQuillsRoute");

  const ids = await f.seed(env, users.owner);
  const input = f.valid(ids);
  if (audience === "public" && !f.hidden)
    fail("hidden", "a public fixture declares no hidden values");
  const hidden = f.hidden?.(ids) ?? [];
  const leaks = (check: string, res: Sent, values = hidden) => {
    const text = JSON.stringify(res.body);
    const leaked = values.filter((value) => text.includes(value));
    if (leaked.length)
      fail(check, `the response contains ${leaked.join(", ")}`);
  };

  await expectStatus(
    "unknown-workspace",
    [404],
    input,
    caller,
    `${prefix}_missing`,
  );
  await pool.query(
    "UPDATE public.workspace SET archived_at=now() WHERE id=$1",
    [env.a],
  );
  try {
    await expectStatus("archived-workspace", [403, 404], input);
  } finally {
    await pool.query(
      "UPDATE public.workspace SET archived_at=NULL WHERE id=$1",
      [env.a],
    );
  }

  if (audience === "portal") {
    if (signIn) await expectStatus("portal-sign-in", [401], input, "");
    if (!f.own && !f.probe)
      fail("customer-ownership", "the fixture declares neither own nor probe");
    const own = f.own?.(ids) ?? [];
    const snapshot = async () => JSON.stringify(await f.probe?.(env, ids));
    const before = await snapshot();
    const other = await call(input, users.customerB);
    leaks("customer-ownership", other, own);
    leaks("hidden", other);
    if (before !== (await snapshot()))
      fail("customer-ownership", "customer B changed customer A's records");

    // A member of A on a portal route is a customer: no teammate data, no membership change.
    const counts = async () =>
      (
        await pool.query(
          `SELECT (SELECT count(*) FROM public.workspace_member WHERE workspace_id=$1)::int AS members,
                  (SELECT count(*) FROM quills.principal WHERE workspace_id=$1 AND kaneo_user_id IS NOT NULL)::int AS teammates`,
          [env.a],
        )
      ).rows[0];
    const teammate = (
      await pool.query(
        "SELECT id FROM quills.principal WHERE workspace_id=$1 AND kaneo_user_id=$2",
        [env.a, users.owner],
      )
    ).rows[0]?.id;
    const countsBefore = JSON.stringify(await counts());
    const asTeammate = await call(input, users.owner);
    if (
      teammate &&
      JSON.stringify(asTeammate.body).includes(fromUuid("principal", teammate))
    )
      fail("teammate-as-customer", "the response names the teammate principal");
    leaks("teammate-as-customer", asTeammate, own);
    leaks("hidden", asTeammate);
    if (countsBefore !== JSON.stringify(await counts()))
      fail(
        "teammate-as-customer",
        "workspace members or teammate principals changed",
      );
    if (before !== (await snapshot()))
      fail("customer-ownership", "a teammate changed customer A's records");
  }

  if (audience === "widget") {
    if (signIn) {
      const { bearer: _, ...anonymous } = input;
      await expectStatus("widget-session", [401], anonymous);
      const expired = await env.widgetVisitor(env.a, { expired: true });
      await expectStatus("widget-session", [401], {
        ...input,
        bearer: expired.token,
      });
      const foreign = await env.widgetVisitor(env.b);
      await expectStatus("widget-workspace", [401], {
        ...input,
        bearer: foreign.token,
      });
    }
    // Workspace A's credential and input on workspace B's path.
    const before = await fingerprint(env.b);
    const crossed = await call(input, caller, env.b);
    if (![401, 403, 404].includes(crossed.status))
      fail(
        "widget-workspace",
        `workspace B answered workspace A's credential with ${crossed.status}`,
      );
    if (before !== (await fingerprint(env.b)))
      fail("widget-workspace", "a row in workspace B changed");
    for (const forged of f.forged?.(ids) ?? []) {
      const prior = await both();
      await expectStatus("widget-credential", [401, 403], forged);
      if (prior !== (await both()))
        fail("widget-credential", "a forged credential changed rows");
    }
  }

  for (const bad of badInputs(d, input))
    await expectStatus("schema-400", [400], bad);

  const rejected = [403, 404, ...Object.keys(d.errors ?? {}).map(Number)];
  const foreign = f.foreign?.(ids) ?? {};
  const fields = Object.keys({
    ...input.query,
    ...(typeof input.body === "object" ? input.body : {}),
  }).filter((key) => key.endsWith("Id"));
  for (const key of [...Object.keys(input.params ?? {}), ...fields])
    if (!(key in foreign))
      fail("foreign-ids", `${key}: the fixture has no workspace B value`);
  for (const [key, value] of Object.entries(foreign)) {
    const before = await both();
    const res = await call(replace(input, key, value));
    if (!rejected.includes(res.status))
      fail("foreign-ids", `${key}: got ${res.status}`);
    leaks("hidden", res);
    if (before !== (await both())) fail("foreign-ids", `${key}: rows changed`);
  }

  const freshIds = await f.seed(env, users.owner);
  const fresh = f.valid(freshIds);
  const since: string = (
    await pool.query("SELECT clock_timestamp()::text AS t")
  ).rows[0].t;
  const domain = await fingerprint(env.a, "domain");
  const ok = await call(fresh);
  if (ok.status !== 200)
    fail("authorized", `got ${ok.status} ${JSON.stringify(ok.body)}`);
  else {
    const issues = [
      ...looseness(d.response, ok.body),
      ...new Set(
        keyNames(ok.body)
          .filter(
            (key) => forbiddenKey.test(key) && !d.allowKeys?.includes(key),
          )
          .map((key) => `the response has a key named ${key}`),
      ),
    ];
    for (const issue of issues) fail("strict-response", issue);
    leaks("hidden", ok, f.hidden?.(freshIds) ?? []);
    const principalId = f.actor
      ? await f.actor(env, freshIds, ok.body)
      : audience === "portal"
        ? await portalPrincipal(users.customerA)
        : audience === "widget"
          ? await widgetPrincipal(env.a, fresh.bearer)
          : null;
    for (const issue of await outboxIssues(d, fresh, ok.body, since, domain, {
      principalId,
    }))
      fail("outbox", issue);
  }

  for (const issue of await rollbackIssues(d, f, caller))
    fail("rollback", issue);
  return findings;
}
