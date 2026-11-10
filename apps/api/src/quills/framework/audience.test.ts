import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createId } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  withQuillsAudience,
  withQuillsSystemWorkspace,
  withQuillsWorkspace,
} from "../../database/quills/client";
import { settings, user as customer } from "../../database/quills/schema/auth";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "./contract";

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
const app = contractApp(quillsRouter, publicRouter);
const suffix = Date.now().toString(36);

async function call(
  method: string,
  path: string,
  options: {
    user?: string;
    body?: unknown;
    ip?: string;
    workspace?: string;
  } = {},
) {
  const res = await app.request(
    `/quills-public/${options.workspace ?? contractEnv().a}${path}`,
    {
      method,
      headers: {
        ...(options.user && { "x-test-user": options.user }),
        ...(options.ip && { "x-kaneo-client-ip": options.ip }),
        ...(options.body !== undefined && {
          "content-type": "application/json",
        }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const portalAccess = (access: Record<string, unknown>) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.update(settings).set({ portalConfig: JSON.stringify({ access }) }),
  );

/** A teammate route of workspace A, called by its owner. */
async function teammate(method: string, path: string, body?: unknown) {
  const res = await app.request(`/quills/${contractEnv().a}${path}`, {
    method,
    headers: {
      "x-test-user": contractEnv().owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status !== 200)
    throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

describe.skipIf(!url)("Quills audiences", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    await pool?.query(
      "DELETE FROM public.workspace WHERE id = ANY($1::text[])",
      [
        [
          `audience_c_${suffix}`,
          `audience_d_${suffix}`,
          `audience_e_${suffix}`,
        ],
      ],
    );
    await stopContract();
  });

  it("resolves a workspace by slug, and an ID match wins over a slug", async () => {
    const env = contractEnv();
    const c = `audience_c_${suffix}`;
    await env.db.insert(kaneo.workspaceTable).values([
      {
        id: c,
        name: "Workspace C",
        slug: `slug-c-${suffix}`,
        createdAt: new Date(),
      },
      // D's slug is C's ID: the ID must still resolve to C.
      {
        id: `audience_d_${suffix}`,
        name: "Workspace D",
        slug: c,
        createdAt: new Date(),
      },
      // E never used Quills.
      {
        id: `audience_e_${suffix}`,
        name: "Workspace E",
        slug: `slug-e-${suffix}`,
        createdAt: new Date(),
      },
    ]);
    // A teammate's first Quills request initializes a workspace; this does the same for C and D.
    for (const id of [c, `audience_d_${suffix}`])
      await withQuillsSystemWorkspace(id, async () => {});
    expect(
      (await call("GET", "/portal/config", { workspace: `slug-c-${suffix}` }))
        .body.name,
    ).toBe("Workspace C");
    expect(
      (await call("GET", "/portal/config", { workspace: c })).body.name,
    ).toBe("Workspace C");
    expect(
      (await call("GET", "/portal/config", { workspace: `missing-${suffix}` }))
        .status,
    ).toBe(404);
    // An anonymous caller neither sees nor seeds a workspace that never used Quills.
    expect(
      (await call("GET", "/portal/config", { workspace: `slug-e-${suffix}` }))
        .status,
    ).toBe(404);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.settings WHERE workspace_id=$1",
          [`audience_e_${suffix}`],
        )
      ).rows[0].n,
    ).toBe(0);

    // The team grant reads membership of the same workspace: a member of D is not a member of C.
    await env.db.insert(kaneo.workspaceUserTable).values({
      workspaceId: `audience_d_${suffix}`,
      userId: env.customerB,
      role: "member",
      joinedAt: new Date(),
    });
    await withQuillsAudience({ workspace: c }, (db) =>
      db.update(settings).set({
        portalConfig: JSON.stringify({ access: { visibility: "private" } }),
      }),
    );
    const access = (workspace: string) =>
      call("GET", "/portal/access", { workspace, user: env.customerB });
    expect((await access(c)).body).toEqual({
      granted: false,
      reason: "unauthorized",
    });
    await withQuillsAudience({ workspace: `audience_d_${suffix}` }, (db) =>
      db.update(settings).set({
        portalConfig: JSON.stringify({ access: { visibility: "private" } }),
      }),
    );
    expect((await access(`audience_d_${suffix}`)).body).toEqual({
      granted: true,
      reason: "team",
    });
  });

  it("counts failed attempts against the rate limit, per client", async () => {
    const attempt = (ip: string) =>
      call("POST", "/widget/install-context", {
        ip,
        body: { code: "qbi_not-a-real-code" },
      });
    const ip = "203.0.113.7";
    for (let i = 0; i < 20; i++) expect((await attempt(ip)).status).toBe(404);
    expect((await attempt(ip)).status).toBe(429);
    expect((await attempt("203.0.113.8")).status).toBe(404);
  });

  it("links a customer profile only for a member or the vouched account", async () => {
    const env = contractEnv();
    const link = (kaneoUserId: string) => ({
      name: "Linked",
      kaneoUserId,
    });
    // A teammate transaction cannot link a non-member.
    await expect(
      withQuillsWorkspace({ workspaceId: env.a, userId: env.owner }, (db) =>
        db.insert(customer).values(link(env.customerB)),
      ),
    ).rejects.toThrow();
    // The audience entry point vouches for one account only.
    await expect(
      withQuillsAudience(
        { workspace: env.a, kaneoUserId: env.customerA },
        (db) => db.insert(customer).values(link(env.customerB)),
      ),
    ).rejects.toThrow();
    await expect(
      withQuillsAudience({ workspace: env.a }, (db) =>
        db.insert(customer).values(link(env.customerB)),
      ),
    ).rejects.toThrow();
    const [row] = await withQuillsAudience(
      { workspace: env.a, kaneoUserId: env.customerB },
      (db) =>
        db
          .insert(customer)
          .values(link(env.customerB))
          .returning({ id: customer.id }),
    );
    expect(row!.id).toMatch(/^user_/);
  });

  it("signs a Kaneo account in as a customer without workspace membership", async () => {
    const env = contractEnv();
    const members = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM public.workspace_member WHERE workspace_id=$1",
          [env.a],
        )
      ).rows[0].n;
    const before = await members();
    const updated = await call("PUT", "/user/profile", {
      user: env.customerA,
      body: { name: "Customer A" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ linked: true, name: "Customer A" });
    const { rows } = await pool.query(
      `SELECT c.id AS customer, p.id AS principal, c.kaneo_user_id, p.kaneo_user_id AS principal_user, p.role, p.type,
              (SELECT actor_type FROM quills.audit_log l WHERE l.workspace_id=p.workspace_id AND l.actor_principal_id=p.id ORDER BY occurred_at DESC LIMIT 1) AS actor_type
       FROM quills.customer_identity c JOIN quills.principal p ON p.user_id=c.id AND p.workspace_id=c.workspace_id
       WHERE c.workspace_id=$1 AND c.kaneo_user_id=$2`,
      [env.a, env.customerA],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kaneo_user_id: env.customerA,
        principal_user: null,
        role: "user",
        type: "user",
        actor_type: "customer",
      }),
    ]);
    expect(await members()).toBe(before);

    // Unlink keeps the profile, its principal and the Kaneo account.
    expect(
      (await call("DELETE", "/user/profile", { user: env.customerA })).body,
    ).toEqual({ changed: true });
    expect(
      (await call("GET", "/user/profile", { user: env.customerA })).body,
    ).toMatchObject({ linked: false, principalId: null });
    const kept = await pool.query(
      `SELECT c.kaneo_user_id, (SELECT count(*)::int FROM public."user" WHERE id=$3) AS accounts
       FROM quills.customer_identity c JOIN quills.principal p ON p.user_id=c.id AND p.workspace_id=c.workspace_id
       WHERE c.workspace_id=$1 AND c.id=$2::uuid`,
      [env.a, rows[0].customer, env.customerA],
    );
    expect(kept.rows).toEqual([{ kaneo_user_id: null, accounts: 1 }]);
  });

  it("returns no avatar for a profile that is not a portal person", async () => {
    const env = contractEnv();
    const [orphan] = await env.scoped(env.a, (db) =>
      db
        .insert(customer)
        .values({ name: "No principal", image: "https://img.example/x.png" })
        .returning({ id: customer.id }),
    );
    expect((await call("GET", `/user/avatar/${orphan!.id}`)).status).toBe(404);
  });

  it("treats a teammate on a portal route as a customer", async () => {
    const env = contractEnv();
    const teammate = (
      await pool.query(
        "SELECT id FROM quills.principal WHERE workspace_id=$1 AND kaneo_user_id=$2",
        [env.a, env.owner],
      )
    ).rows[0].id as string;
    const res = await call("PUT", "/user/profile", {
      user: env.owner,
      body: { name: "Owner as customer" },
    });
    expect(res.status).toBe(200);
    expect(res.body.principalId).toMatch(/^principal_/);
    const { rows } = await pool.query(
      "SELECT p.id, p.kaneo_user_id FROM quills.principal p JOIN quills.customer_identity c ON c.id=p.user_id WHERE c.workspace_id=$1 AND c.kaneo_user_id=$2",
      [env.a, env.owner],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(teammate);
    expect(rows[0].kaneo_user_id).toBeNull();
  });

  it("evaluates the private-portal gate from the server-side policy", async () => {
    const env = contractEnv();
    const access = async (user?: string) =>
      (await call("GET", "/portal/access", { user })).body;
    await portalAccess({ visibility: "public" });
    expect(await access()).toEqual({ granted: true, reason: "public" });

    // The teammate writer normalizes domains and drops segments that do not exist.
    const written = await teammate("PUT", "/settings/portal/access", {
      visibility: "private",
      allowedDomains: ["@Example.TEST", "not a domain"],
      allowedSegmentIds: [createId("segment")],
    });
    expect(written).toEqual({
      visibility: "private",
      allowedDomains: ["example.test"],
      allowedSegmentIds: [],
    });
    expect(await access()).toEqual({
      granted: false,
      reason: "unauthenticated",
    });
    expect(await access(env.owner)).toEqual({ granted: true, reason: "team" });
    // The email is not verified yet: no domain grant.
    expect(await access(env.customerA)).toEqual({
      granted: false,
      reason: "unauthorized",
    });
    await env.db
      .update(kaneo.userTable)
      .set({ emailVerified: true })
      .where(eq(kaneo.userTable.id, env.customerA));
    expect(await access(env.customerA)).toEqual({
      granted: true,
      reason: "domain",
    });

    // A teammate can put a portal customer in a segment, which then grants access.
    const { principalId } = await env.portalCustomer(env.a, env.customerA);
    const segment = await teammate("POST", "/segments", {
      name: `Allowed ${suffix}`,
      type: "manual",
    });
    expect(
      await teammate("POST", `/segments/${segment.id}/members`, {
        principalIds: [principalId],
      }),
    ).toMatchObject({ added: 1 });
    await teammate("PUT", "/settings/portal/access", {
      visibility: "private",
      allowedDomains: [],
      allowedSegmentIds: [segment.id],
    });
    expect(await access(env.customerA)).toEqual({
      granted: true,
      reason: "segment",
    });
    expect(await access(env.customerB)).toEqual({
      granted: false,
      reason: "unauthorized",
    });

    // Only a denial that the server evaluates is recorded.
    expect(
      (await call("POST", "/portal/access-denied", { user: env.customerA }))
        .body,
    ).toEqual({
      recorded: false,
      reason: "segment",
    });
    expect(
      (await call("POST", "/portal/access-denied", { user: env.customerB }))
        .body,
    ).toEqual({
      recorded: true,
      reason: "unauthorized",
    });
    await portalAccess({ visibility: "public" });
  });
});
