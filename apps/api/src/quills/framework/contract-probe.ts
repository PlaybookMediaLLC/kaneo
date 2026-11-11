import { toUuid } from "@kaneo/ids";
import { statement } from "@kaneo/permissions";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import type { PermissionMap } from "../../utils/role-permissions";
import {
  contractApp,
  env,
  fingerprintSql,
  pool,
  role,
  users,
  type App,
  type ContractInput,
  type Finding,
  type Fixture,
} from "./contract-world";
import { buildQuillsRoute, type AnyQuillsRoute } from "./define-route";

// Requests, row fingerprints and response probes that the contract checks share.

/** `body` is the parsed JSON, or the text when the response is not JSON. */
export type Sent = { status: number; body: any; type: string | null };
const forbiddenKey = /secret|token|password|hash|workspaceId/i;

let clientCount = 0;
export async function send(
  app: App,
  d: AnyQuillsRoute,
  input: ContractInput,
  user: string,
  scope?: PermissionMap,
  workspace = env.a,
): Promise<Sent> {
  const audience = d.audience ?? "teammate";
  // Signed and internal routes name no workspace: their credential decides it.
  let path =
    audience === "teammate"
      ? `/quills/${workspace}${d.path}`
      : audience === "app"
        ? `/quills/${workspace}/apps${d.path}`
        : audience === "signed" || audience === "internal"
          ? `/quills-public/${audience}${d.path}`
          : `/quills-public/${workspace}${d.path}`;
  for (const [key, value] of Object.entries(input.params ?? {}))
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  const query = new URLSearchParams(input.query).toString();
  const res = await app.request(query ? `${path}?${query}` : path, {
    method: d.method.toUpperCase(),
    headers: {
      "x-test-user": user,
      ...((input.body !== undefined || input.raw !== undefined) && {
        "content-type": "application/json",
      }),
      ...(scope && { "x-test-scope": JSON.stringify(scope) }),
      // An app route's key is the caller's app key.
      ...(scope && audience === "app" && { "x-test-key": "app" }),
      ...(input.bearer && { authorization: `Bearer ${input.bearer}` }),
      // A fresh client per request keeps the checks under the rate limits; rate-limit.test.ts covers them.
      "x-kaneo-client-ip": `198.51.100.${++clientCount % 250}`,
      ...input.headers,
    },
    body:
      input.raw ??
      (input.body === undefined ? undefined : JSON.stringify(input.body)),
  });
  const type = res.headers.get("content-type");
  const text = await res.text();
  let body: unknown = text || null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the checks read the text.
  }
  return { status: res.status, body, type };
}

/** The response as text, for the leak checks: JSON as serialized, a raw document as sent. */
export const responseText = (res: Sent) =>
  typeof res.body === "string" ? res.body : JSON.stringify(res.body);

/**
 * The response checks of an authorized request. Only a raw route skips `strict-response`: it must
 * answer its declared content type with a text body (`raw-response`). Every other route must answer
 * JSON that matches a closed copy of its schema, with no forbidden key names. The callers run the
 * leak checks on both.
 */
export function responseIssues(d: AnyQuillsRoute, res: Sent): Finding[] {
  const type = res.type?.split(";")[0]?.trim();
  if (d.raw)
    return type === d.raw && typeof res.body === "string"
      ? []
      : [
          {
            check: "raw-response",
            detail: `expected a ${d.raw} document, got ${res.type}`,
          },
        ];
  const issues =
    type === "application/json"
      ? [
          ...looseness(d.response, res.body),
          ...new Set(
            keyNames(res.body)
              .filter(
                (key) => forbiddenKey.test(key) && !d.allowKeys?.includes(key),
              )
              .map((key) => `the response has a key named ${key}`),
          ),
        ]
      : [`expected application/json, got ${res.type}`];
  return issues.map((detail) => ({ check: "strict-response", detail }));
}

/** The declared Quills action, or every other action, with or without the native permissions. */
export const grant = (
  d: AnyQuillsRoute,
  allowed: boolean,
  native = true,
): PermissionMap => ({
  ...(native && d.native),
  workspace: [...((native && d.native?.workspace) || []), "read"],
  quills: allowed
    ? [d.action, ...(d.alsoRequires ?? [])]
    : statement.quills.filter((action) => action !== d.action),
});

export const setRole = (permission: PermissionMap) =>
  pool.query(
    "UPDATE public.workspace_role SET permission=$1 WHERE workspace_id=$2 AND role=$3",
    [JSON.stringify(permission), env.a, role],
  );

export const fingerprint = async (
  workspaceId: string,
  rows: keyof typeof fingerprintSql = "all",
): Promise<string> =>
  (await pool.query(fingerprintSql[rows], [workspaceId])).rows[0].h;

export const replace = (
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
export function badInputs(d: AnyQuillsRoute, input: ContractInput) {
  const bad: ContractInput[] = [];
  for (const key of Object.keys(input.params ?? {}))
    if (!d.params?.shape[key]?.safeParse("!").success)
      bad.push(replace(input, key, "!"));
  if (d.query?.shape.limit)
    bad.push({ ...input, query: { ...input.query, limit: "1000000000" } });
  // A signed body is checked against its signature before its schema: a changed body is a forgery (401).
  if (d.body && d.audience !== "signed")
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

export const strings = (value: unknown): string[] =>
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
export async function outboxIssues(
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
  const declared =
    typeof d.event === "function" &&
    d.event(
      {
        params: d.params?.parse(input.params),
        query: d.query?.parse(input.query ?? {}),
        // A signed route's body is the raw bytes it was sent.
        body: d.body?.parse(
          input.raw === undefined ? input.body : JSON.parse(input.raw),
        ),
        workspaceId: env.a,
      },
      // The JSON body, not a parse with the server schema: dates arrive as strings.
      body,
      // The handler's own return value is not visible here; the response body stands in for it.
      body,
    );
  // A route may record several changes; the first is checked by type, entity and actor.
  const changes = [declared || []].flat();
  const change = changes[0];
  const expected = changes.length;
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
  if (d.method === "get" && d.audience !== "signed")
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
    ...(n.events === expected && n.matchingEvents >= 1
      ? []
      : [
          `expected ${expected} events with ${change.type} for ${change.entityId}, found ${n.events} events`,
        ]),
    ...(n.audit === expected && n.matchingAudit >= 1
      ? []
      : [
          `expected ${expected} audit rows with ${change.type} by the caller, found ${n.audit}`,
        ]),
    ...(n.jobs === expected
      ? []
      : [`expected ${expected} jobs, found ${n.jobs}`]),
  ];
}

/** Fail after the handler, then fail the outbox write: neither may leave a row behind. */
export async function rollbackIssues(
  d: AnyQuillsRoute,
  f: Fixture,
  user: string,
  scope?: PermissionMap,
) {
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
            event: (input: any, result: any, raw: unknown) => {
              const change = event(input, result, raw);
              return (
                change &&
                [change].flat().map((one) => ({ ...one, entityId: "" }))
              );
            },
          },
        ]
      : []),
  ];
  const reads = d.method === "get" && d.audience !== "signed";
  for (const failure of reads ? [] : failures) {
    const failing = apiRouter<
      BaseVariables & { workspaceId: string }
    >().openapi(...buildQuillsRoute({ ...d, ...failure }));
    const failingApp = ["teammate", "app"].includes(d.audience ?? "teammate")
      ? contractApp(failing)
      : contractApp(apiRouter(), failing);
    const target = f.valid(await f.seed(env, users.owner));
    const before = await fingerprint(env.a);
    const res = await send(failingApp, d, target, user, scope);
    if (res.status !== 500) issues.push(`expected 500, got ${res.status}`);
    if (before !== (await fingerprint(env.a)))
      issues.push("rows changed after the failed request");
  }
  return issues;
}
