import { eq } from "drizzle-orm";
import { fromUuid } from "@kaneo/ids";
import { statement } from "@kaneo/permissions";
import * as kaneo from "../../database/schema";
import type { PermissionMap } from "../../utils/role-permissions";
import { hashToken } from "./audience";
import { boundedInputIssues } from "./bounded-inputs";
import {
  env,
  pool,
  prefix,
  users,
  type App,
  type ContractInput,
  type Finding,
  type Fixture,
} from "./contract-world";
import {
  badInputs,
  fingerprint,
  grant,
  outboxIssues,
  replace,
  responseIssues,
  responseText,
  rollbackIssues,
  send,
  setRole,
  strings,
  type Sent,
} from "./contract-probe";
import type { AnyQuillsRoute } from "./define-route";
import { registry } from "./registry";

// The contract checks for one declaration. Teammate routes and the other audiences have their own table.

/** Runs every contract check for one declaration against `app`. An empty list passes. */
export async function checkRoute(
  app: App,
  d: AnyQuillsRoute,
  f: Fixture | undefined,
): Promise<Finding[]> {
  if (!f) return [{ check: "no-fixture", detail: d.operationId }];
  if (d.audience === "signed") return checkSignedRoute(app, d, f);
  if (d.audience === "internal") return checkInternalRoute(app, d, f);
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
  for (const issue of boundedInputIssues(d)) fail("bounded-inputs", issue);

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
  // Each extra required action alone: a role or key that lacks it is denied.
  for (const extra of d.alsoRequires ?? []) {
    const without: PermissionMap = {
      ...grant(d, true),
      quills: statement.quills.filter((action) => action !== extra),
    };
    await setRole(without);
    await expectStatus("denied-action", [403], users.limited, input);
    const key = await send(app, d, input, users.owner, without);
    if (key.status !== 403 || key.body?.code !== "API_KEY_SCOPE")
      fail("api-key-scope", `without ${extra}: got ${key.status}`);
  }
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
    findings.push(...responseIssues(d, ok));
    for (const issue of await outboxIssues(d, fresh, ok.body, since, domain))
      fail("outbox", issue);
  }
  for (const issue of await deletedObjectIssues(f, (target) =>
    send(app, d, target, users.owner),
  ))
    fail("deleted-object", issue);

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

/** With a fixture `softDelete`: the authorized caller's request on a soft-deleted target is 404 and changes nothing. */
async function deletedObjectIssues(
  f: Fixture,
  call: (input: ContractInput) => Promise<Sent>,
) {
  if (!f.softDelete) return [];
  const ids = await f.seed(env, users.owner);
  await f.softDelete(env, ids);
  const before = await fingerprint(env.a);
  const res = await call(f.valid(ids));
  return [
    ...(res.status === 404
      ? []
      : [`expected 404, got ${res.status} ${JSON.stringify(res.body)}`]),
    ...(before === (await fingerprint(env.a)) ? [] : ["rows changed"]),
  ];
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
  for (const issue of boundedInputIssues(d)) fail("bounded-inputs", issue);

  const ids = await f.seed(env, users.owner);
  const input = f.valid(ids);
  if (audience === "public" && !f.hidden)
    fail("hidden", "a public fixture declares no hidden values");
  const hidden = f.hidden?.(ids) ?? [];
  const leaks = (check: string, res: Sent, values = hidden) => {
    const text = responseText(res);
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
      responseText(asTeammate).includes(fromUuid("principal", teammate))
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
    // With `own` or `probe`: another visitor of A sends the same input with its own session.
    if (f.own || f.probe) {
      const snapshot = async () => JSON.stringify(await f.probe?.(env, ids));
      const before = await snapshot();
      const other = await env.widgetVisitor(env.a);
      const res = await call({ ...input, bearer: other.token });
      leaks("customer-ownership", res, f.own?.(ids) ?? []);
      if (before !== (await snapshot()))
        fail(
          "customer-ownership",
          "another widget visitor changed the visitor's records",
        );
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
    findings.push(...responseIssues(d, ok));
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
  for (const issue of await deletedObjectIssues(f, (target) => call(target)))
    fail("deleted-object", issue);

  for (const issue of await rollbackIssues(d, f, caller))
    fail("rollback", issue);
  return findings;
}

/** Shared by the signed and internal tables: the route is mounted through defineQuillsRoute with bounded inputs. */
function registration(app: App, d: AnyQuillsRoute) {
  const findings: Finding[] = [];
  const handler = registry.get(d);
  if (
    !handler ||
    !app.routes.some(
      (r) => r.handler === handler && r.method === d.method.toUpperCase(),
    )
  )
    findings.push({
      check: "registered",
      detail: "the route is not mounted through defineQuillsRoute",
    });
  for (const issue of boundedInputIssues(d))
    findings.push({ check: "bounded-inputs", detail: issue });
  return findings;
}

/**
 * Contract checks for a signed route: a machine caller with no session. A forged signature is 401
 * and changes nothing; workspace B's credential never changes A; a replayed delivery is a no-op;
 * no response contains a secret.
 */
async function checkSignedRoute(
  app: App,
  d: AnyQuillsRoute,
  f: Fixture,
): Promise<Finding[]> {
  const findings = registration(app, d);
  const fail = (check: string, detail: string) =>
    findings.push({ check, detail });
  const call = (input: ContractInput) => send(app, d, input, "");
  const both = async () =>
    `${await fingerprint(env.a)}${await fingerprint(env.b)}`;
  const ids = await f.seed(env, users.owner);
  const input = f.valid(ids);
  if (!f.hidden) fail("hidden", "a signed fixture declares no secret values");
  const leaks = (check: string, res: Sent, values: string[]) => {
    const text = responseText(res);
    const leaked = values.filter((value) => text.includes(value));
    if (leaked.length)
      fail(check, `the response contains ${leaked.join(", ")}`);
  };
  const hidden = f.hidden?.(ids) ?? [];

  if (!f.forged)
    fail("bad-signature", "the fixture declares no forged requests");
  for (const forged of f.forged?.(ids) ?? []) {
    const before = await both();
    const res = await call(forged);
    if (res.status !== 401)
      fail(
        "bad-signature",
        `expected 401, got ${res.status} ${JSON.stringify(res.body)}`,
      );
    leaks("hidden", res, hidden);
    if (before !== (await both()))
      fail("bad-signature", "a forged request changed rows");
  }

  if (!f.crossed)
    fail("cross-workspace", "the fixture declares no workspace B requests");
  for (const crossed of f.crossed?.(ids) ?? []) {
    const before = await fingerprint(env.a);
    const res = await call(crossed);
    if (![200, 401, 403, 404].includes(res.status))
      fail("cross-workspace", `got ${res.status} ${JSON.stringify(res.body)}`);
    leaks("cross-workspace", res, hidden);
    if (before !== (await fingerprint(env.a)))
      fail("cross-workspace", "workspace B's credential changed a row in A");
  }

  for (const bad of badInputs(d, input)) {
    const res = await call(bad);
    if (res.status !== 400)
      fail(
        "schema-400",
        `expected 400, got ${res.status} ${JSON.stringify(res.body)}`,
      );
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
    findings.push(...responseIssues(d, ok));
    leaks("hidden", ok, f.hidden?.(freshIds) ?? []);
    // A machine caller records a system change: no principal.
    for (const issue of await outboxIssues(d, fresh, ok.body, since, domain, {
      principalId: f.actor ? await f.actor(env, freshIds, ok.body) : null,
    }))
      fail("outbox", issue);
    // The same delivery again: the declared replay answer, and no row changes anywhere.
    const before = await both();
    const again = await call(fresh);
    if (again.status !== 200)
      fail(
        "replay",
        `expected 200, got ${again.status} ${JSON.stringify(again.body)}`,
      );
    else if (JSON.stringify(again.body) !== JSON.stringify(d.replay))
      fail(
        "replay",
        `expected the replay answer, got ${JSON.stringify(again.body)}`,
      );
    if (before !== (await both()))
      fail("replay", "a replayed delivery changed rows");
    // Each header changed in turn: a signed header fails the check (401); an unsigned one must not
    // make the same signed bytes count as a new delivery.
    for (const [name, value] of Object.entries(fresh.headers ?? {})) {
      const prior = await both();
      const res = await call({
        ...fresh,
        headers: { ...fresh.headers, [name]: `${value}x` },
      });
      if (
        !(
          res.status === 401 ||
          (res.status === 200 &&
            JSON.stringify(res.body) === JSON.stringify(d.replay))
        )
      )
        fail(
          "replay",
          `a changed ${name} header made a new delivery: ${res.status} ${JSON.stringify(res.body)}`,
        );
      if (prior !== (await both()))
        fail("replay", `a changed ${name} header changed rows`);
    }
  }

  // A workspace archived after it issued the credential.
  const archived = f.valid(await f.seed(env, users.owner));
  await pool.query(
    "UPDATE public.workspace SET archived_at=now() WHERE id=$1",
    [env.a],
  );
  try {
    const before = await both();
    const res = await call(archived);
    if (![401, 403, 404].includes(res.status))
      fail("archived-workspace", `expected 401, 403 or 404, got ${res.status}`);
    if (before !== (await both())) fail("archived-workspace", "rows changed");
  } finally {
    await pool.query(
      "UPDATE public.workspace SET archived_at=NULL WHERE id=$1",
      [env.a],
    );
  }

  // A correctly signed body that the schema rejects: 400 and no change.
  if (d.body && !f.invalid)
    fail("schema-400", "the fixture declares no signed invalid bodies");
  // Fresh rows: a later seed may replace the first one (for example, a reconnect).
  const invalidIds = f.invalid && (await f.seed(env, users.owner));
  for (const invalid of f.invalid?.(invalidIds) ?? []) {
    const before = await both();
    const res = await call(invalid);
    if (res.status !== 400)
      fail(
        "schema-400",
        `signed invalid body: expected 400, got ${res.status} ${JSON.stringify(res.body)}`,
      );
    if (before !== (await both()))
      fail("schema-400", "a signed invalid body changed rows");
  }

  for (const issue of await deletedObjectIssues(f, call))
    fail("deleted-object", issue);
  for (const issue of await rollbackIssues(d, f, "")) fail("rollback", issue);
  return findings;
}

/**
 * Contract checks for the internal caller: 404 while QUILLS_INTERNAL_TOKEN is unset, 401 without the
 * token or with a wrong one, 200 with it, and no response contains the token.
 */
async function checkInternalRoute(
  app: App,
  d: AnyQuillsRoute,
  f: Fixture,
): Promise<Finding[]> {
  const findings = registration(app, d);
  const fail = (check: string, detail: string) =>
    findings.push({ check, detail });
  const call = (input: ContractInput) => send(app, d, input, "");
  const input = f.valid(await f.seed(env, users.owner));
  const token = process.env.QUILLS_INTERNAL_TOKEN;
  if (!token)
    fail("internal-token", "the fixture sets no QUILLS_INTERNAL_TOKEN");
  delete process.env.QUILLS_INTERNAL_TOKEN;
  try {
    const res = await call(input);
    if (res.status !== 404)
      fail(
        "internal-disabled",
        `expected 404 without the variable, got ${res.status}`,
      );
  } finally {
    if (token) process.env.QUILLS_INTERNAL_TOKEN = token;
  }
  const { authorization: _, ...rest } = input.headers ?? {};
  for (const authorization of [undefined, "Bearer wrong", `Basic ${token}`]) {
    const res = await call({
      ...input,
      headers: authorization ? { ...rest, authorization } : rest,
    });
    if (res.status !== 401)
      fail(
        "internal-token",
        `expected 401 for ${authorization ? authorization.split(" ")[0] : "no token"}, got ${res.status}`,
      );
  }
  const ok = await call(input);
  if (ok.status !== 200)
    fail("authorized", `got ${ok.status} ${JSON.stringify(ok.body)}`);
  else {
    findings.push(...responseIssues(d, ok));
    if (token && responseText(ok).includes(token))
      fail("hidden", "the response contains the internal token");
  }
  return findings;
}
