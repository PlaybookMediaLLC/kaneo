import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";
import { statement } from "@kaneo/permissions";
import {
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../../database/quills/client";
import { runQuillsMigrations } from "../../database/quills/migrate";
import * as kaneo from "../../database/schema";
import { httpExceptionResponse } from "../../errors/http-exception-response";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import type { PermissionMap } from "../../utils/role-permissions";
import { buildQuillsRoute, type AnyQuillsRoute } from "./define-route";
import { registry } from "./registry";

// Contract checks for Quills routes: real PostgreSQL, workspaces A and B, identity from test headers.

export type Finding = { check: string; detail: string };
export type ContractInput = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
};
export type ContractEnv = {
  a: string;
  b: string;
  /** The owner of A. */
  owner: string;
  db: NodePgDatabase<typeof kaneo>;
  /** A unique ID for seeded rows. */
  id: (label: string) => string;
  /** A scoped transaction in A or B as that workspace's owner. */
  scoped: <T>(
    workspaceId: string,
    work: (db: Database, actor: QuillsActor) => Promise<T>,
  ) => Promise<T>;
};
export type Fixture<T = any> = {
  /** Fresh rows for one request. Called once per stateful check, with the user who sends that check's main request. */
  seed: (env: ContractEnv, caller: string) => Promise<T>;
  /** A request in workspace A that succeeds for an authorized caller. */
  valid: (ids: T) => ContractInput;
  /** Workspace B values, keyed by the param, query or body field they replace. */
  foreign?: (ids: T) => Record<string, string>;
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
    all: hash(tables),
    domain: hash(
      tables.filter((t) => !["audit_log", "events", "job_queue"].includes(t)),
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
  };
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

/** The Quills router behind header identity and the API's error responses. */
export function contractApp(router: App) {
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
  return app;
}

/** Routes under /quills that were not mounted through defineQuillsRoute. */
export function unregisteredRoutes(app: App) {
  const handlers = new Set(registry.values());
  const routes = new Map<string, boolean>();
  for (const route of app.routes)
    if (route.method !== "ALL" && route.path.startsWith("/quills/")) {
      const key = `${route.method} ${route.path}`;
      routes.set(key, routes.get(key) || handlers.has(route.handler));
    }
  return [...routes]
    .filter(([, registered]) => !registered)
    .map(([key]) => key);
}

async function send(
  app: App,
  d: AnyQuillsRoute,
  input: ContractInput,
  user: string,
  scope?: PermissionMap,
): Promise<Sent> {
  let path = `/quills/${env.a}${d.path}`;
  for (const [key, value] of Object.entries(input.params ?? {}))
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  const query = new URLSearchParams(input.query).toString();
  const res = await app.request(query ? `${path}?${query}` : path, {
    method: d.method.toUpperCase(),
    headers: {
      "x-test-user": user,
      ...(input.body !== undefined && { "content-type": "application/json" }),
      ...(scope && { "x-test-scope": JSON.stringify(scope) }),
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
  const {
    rows: [n],
  } = await pool.query(
    `SELECT
      (SELECT count(*) FROM quills.events WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz)::int AS events,
      (SELECT count(*) FROM quills.events WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz AND type=$3 AND entity_id=$4)::int AS "matchingEvents",
      (SELECT count(*) FROM quills.audit_log WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz)::int AS audit,
      (SELECT count(*) FROM quills.audit_log l JOIN quills.principal p ON p.id=l.actor_principal_id AND p.workspace_id=l.workspace_id
        WHERE l.workspace_id=$1 AND l.occurred_at>=$2::timestamptz AND l.event_type=$3 AND l.target_id=$4 AND p.kaneo_user_id=$5)::int AS "matchingAudit",
      (SELECT count(*) FROM quills.job_queue WHERE workspace_id=$1 AND created_at>=$2::timestamptz)::int AS jobs`,
    [
      env.a,
      since,
      change ? change.type : "",
      change ? change.entityId : "",
      users.limited,
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

  // Fail after the handler, then fail the outbox write: neither may leave a row behind.
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
    const failingApp = contractApp(
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({ ...d, ...failure }),
      ),
    );
    const target = f.valid(await f.seed(env, users.owner));
    const before = await fingerprint(env.a);
    const res = await send(failingApp, d, target, users.owner);
    if (res.status !== 500) fail("rollback", `expected 500, got ${res.status}`);
    if (before !== (await fingerprint(env.a)))
      fail("rollback", "rows changed after the failed request");
  }
  return findings;
}
