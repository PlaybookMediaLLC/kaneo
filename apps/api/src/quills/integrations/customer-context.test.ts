import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { principal, user } from "../../database/quills/schema/auth";
import { integrations } from "../../database/quills/schema/integrations";
import * as kaneo from "../../database/schema";
import { encryptSecret } from "../../notification-preferences/secrets";
import { customer } from "../directory/seed.fixture";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { openCredentials } from "../framework/integration-config";
import { mintOAuthState } from "../framework/signed";
import quillsRouter from "../index";
import publicRouter from "../public";
import { boundContact } from "./contacts";
import "./contacts.fixture";
import { oauthConnection, platformCredentials } from "./oauth-seed.fixture";
import { providerCalls, providerOverrides } from "./provider-edge.fixture";

// HubSpot, Intercom, Zendesk and Salesforce against the local provider server (contacts.fixture.ts),
// the contacts route and the customer context route.

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
const EMAIL = "ada@example.test";
const KEYED_EMAIL = "keyed.customer@example.test";
const CONTEXT_EMAIL = "context.customer@example.test";

describe("contact bounds", () => {
  it("selects, trims and bounds the fields of a provider contact", () => {
    expect(
      boundContact({
        name: ` ${"n".repeat(300)} `,
        company: "",
        url: "http://insecure.example.test/x",
        fields: [
          { label: "Empty", value: " " },
          ...Array.from({ length: 20 }, (_, i) => ({
            label: `Field ${i}`,
            value: "v".repeat(600),
          })),
        ],
      }),
    ).toEqual({
      name: "n".repeat(200),
      company: null,
      url: null,
      fields: Array.from({ length: 9 }, (_, i) => ({
        label: `Field ${i}`,
        value: "v".repeat(500),
      })),
    });
  });
});

describe.skipIf(!url)("CRM providers and customer context", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  let env: ContractEnv;
  const get = async (path: string) => {
    const res = await app.request(`/quills/${env.a}${path}`, as(env.owner));
    return { status: res.status, body: (await res.json()) as any };
  };
  const callback = (type: string, fields?: Record<string, string>) =>
    app.request(
      `/quills-public/signed/oauth/${type}/callback?state=${encodeURIComponent(
        mintOAuthState({
          workspaceId: env.a,
          userId: env.owner,
          type,
          fields,
        }),
      )}&code=contract-code`,
      as(env.owner),
    );
  const stored = (type: string) =>
    env.scoped(env.a, async (db) => {
      const [row] = await db
        .select({ config: integrations.config, secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.integrationType, type));
      return row;
    });
  /** Removes every connection in A, so a context read reaches only the ones a test adds. */
  const disconnectAll = () =>
    env.scoped(env.a, (db) => db.delete(integrations));
  /** A connection with a due token and a refresh token, so the next call refreshes it first. */
  const dueConnection = (type: string, config: Record<string, string>) =>
    env.scoped(env.a, async (db, actor) => {
      await db
        .delete(integrations)
        .where(eq(integrations.integrationType, type));
      const [row] = await db
        .insert(integrations)
        .values({
          integrationType: type,
          status: "active",
          secrets: encryptSecret(
            JSON.stringify({
              accessToken: "old-access",
              refreshToken: "old-refresh",
              expiresAt: new Date(Date.now() - 1000).toISOString(),
            }),
          )!,
          config: { workspaceName: "Contract", account: "contract", ...config },
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        })
        .returning({ id: integrations.id });
      return row!.id;
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    env = contractEnv();
  }, 120000);
  afterAll(() => stopContract());

  it("exchanges a code for each provider and stores no token in the answer", async () => {
    const expected = {
      hubspot: { portalId: "42", account: "contract.hubspot.com" },
      intercom: { account: "Contract app" },
      zendesk: { subdomain: "contract", account: "contract.zendesk.com" },
      salesforce: {
        instanceUrl: "https://contract.my.salesforce.com",
        account: "contract.my.salesforce.com",
      },
    };
    for (const [type, config] of Object.entries(expected)) {
      await platformCredentials(env, env.a, type);
      const res = await callback(
        type,
        type === "zendesk" ? { subdomain: "contract" } : undefined,
      );
      const text = await res.text();
      expect(res.status, `${type}: ${text}`).toBe(200);
      expect(JSON.parse(text)).toMatchObject({
        status: "connected",
        integration: { integrationType: type },
      });
      expect(text).not.toMatch(/contract-token|contract-refresh/);
      const row = await stored(type);
      expect(row!.config).toMatchObject(config);
      expect(row!.secrets).not.toMatch(/contract-token/);
    }
    // HubSpot and Salesforce keep the refresh token and an expiry, so a due token refreshes.
    for (const type of ["hubspot", "salesforce"]) {
      const secrets = openCredentials((await stored(type))!.secrets);
      expect(secrets, type).toMatchObject({
        accessToken: `${type}-contract-token`,
        refreshToken: `${type}-contract-refresh`,
      });
      expect(Date.parse(secrets!.expiresAt!), type).toBeGreaterThan(Date.now());
    }
    // A Salesforce app without the refresh_token scope: no expiry, so no refresh that must fail.
    const route = "POST /login.salesforce.com/services/oauth2/token";
    providerOverrides.set(route, {
      status: 200,
      body: {
        access_token: "salesforce-contract-token",
        instance_url: "https://contract.my.salesforce.com",
      },
    });
    try {
      expect((await callback("salesforce")).status).toBe(200);
    } finally {
      providerOverrides.delete(route);
    }
    expect(openCredentials((await stored("salesforce"))!.secrets)).toEqual({
      accessToken: "salesforce-contract-token",
      refreshToken: "",
      expiresAt: "",
    });
  });

  it("checks the Zendesk subdomain at connect and in the signed state", async () => {
    await platformCredentials(env, env.a, "zendesk");
    const connect = (query: string) =>
      app.request(
        `/quills/${env.a}/oauth/zendesk/connect${query}`,
        as(env.owner),
      );
    for (const query of [
      "",
      "?subdomain=evil.example.com",
      "?subdomain=-contract",
      "?subdomain=contract%2F..",
      "?subdomain=Contract",
    ])
      expect((await connect(query)).status, query).toBe(400);
    const res = await connect("?subdomain=contract");
    expect(res.status).toBe(200);
    const authorize = new URL(
      ((await res.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(authorize.hostname).toBe("contract.zendesk.com");
    expect(authorize.searchParams.get("scope")).toBe(
      "users:read organizations:read",
    );

    const state = authorize.searchParams.get("state")!;
    const [payload, signature] = state.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    const altered = `${Buffer.from(
      JSON.stringify({ ...claims, f: { subdomain: "evil" } }),
    ).toString("base64url")}.${signature}`;
    const calls = providerCalls.length;
    const refused = await app.request(
      `/quills-public/signed/oauth/zendesk/callback?state=${encodeURIComponent(altered)}&code=c`,
      as(env.owner),
    );
    expect(refused.status).toBe(401);
    // A signed subdomain outside the pattern is refused before any provider call.
    expect(
      (await callback("zendesk", { subdomain: "evil.example.com" })).status,
    ).toBe(400);
    expect(providerCalls.length).toBe(calls);
  });

  it("refuses a Salesforce token answer that names an instance outside salesforce.com", async () => {
    await platformCredentials(env, env.a, "salesforce");
    await env.scoped(env.a, (db) =>
      db
        .delete(integrations)
        .where(eq(integrations.integrationType, "salesforce")),
    );
    const route = "POST /login.salesforce.com/services/oauth2/token";
    try {
      for (const instance of [
        "https://evil.example.com",
        "http://contract.my.salesforce.com",
        "https://contract.my.salesforce.com.evil.test",
        "https://contract.my.salesforce.com:8443",
        "https://user:pass@contract.my.salesforce.com",
        "javascript:alert(1)",
        "",
      ]) {
        providerOverrides.set(route, {
          status: 200,
          body: {
            access_token: "salesforce-contract-token",
            instance_url: instance,
          },
        });
        expect((await callback("salesforce")).status, instance).toBe(400);
      }
    } finally {
      providerOverrides.delete(route);
    }
    expect(await stored("salesforce")).toBeUndefined();
  });

  it("refreshes a due Salesforce token without changing the stored instance", async () => {
    await platformCredentials(env, env.a, "salesforce");
    const id = await dueConnection("salesforce", {
      instanceUrl: "https://contract.my.salesforce.com",
    });
    const route = "POST /login.salesforce.com/services/oauth2/token";
    providerOverrides.set(route, {
      status: 200,
      body: {
        access_token: "salesforce-new-access",
        instance_url: "https://evil.my.salesforce.com",
      },
    });
    const from = providerCalls.length;
    try {
      const res = await get(`/integrations/${id}/contacts?email=${EMAIL}`);
      expect(res.status).toBe(200);
      expect(res.body.contact).toMatchObject({
        name: "Ada Contract",
        company: "Acme",
        url: "https://contract.my.salesforce.com/lightning/r/Contact/003000000000001AAA/view",
      });
    } finally {
      providerOverrides.delete(route);
    }
    const calls = providerCalls.slice(from);
    const refresh = new URLSearchParams(
      calls.find((call) => call.path.endsWith("/oauth2/token"))!.body,
    );
    expect(Object.fromEntries(refresh)).toMatchObject({
      grant_type: "refresh_token",
      client_id: "client-salesforce",
      refresh_token: "old-refresh",
    });
    const query = calls.find((call) => call.path.includes("/services/data/"));
    expect(query!.path).toMatch(/^\/contract\.my\.salesforce\.com\//);
    expect(query!.authorization).toBe("Bearer salesforce-new-access");
    const row = await stored("salesforce");
    expect(row!.config).toMatchObject({
      instanceUrl: "https://contract.my.salesforce.com",
    });
    // The handler stored the refreshed token; Salesforce kept its refresh token.
    expect(openCredentials(row!.secrets)).toMatchObject({
      accessToken: "salesforce-new-access",
      refreshToken: "old-refresh",
    });

    // The email is a SOQL string literal: a quote in it is escaped.
    const quoted = providerCalls.length;
    expect(
      (
        await get(
          `/integrations/${id}/contacts?email=${encodeURIComponent("o'brien@example.test")}`,
        )
      ).status,
    ).toBe(200);
    const soql = new URL(
      `http://x${providerCalls.slice(quoted).find((call) => call.path.includes("/query"))!.path}`,
    ).searchParams.get("q");
    expect(soql).toContain("WHERE Email = 'o\\'brien@example.test' LIMIT 1");
  });

  it("finds a contact, selects its fields, answers no match with null and an answer without its list with 502", async () => {
    const id = await oauthConnection(env, env.a, {
      type: "hubspot",
      config: { portalId: "42" },
    });
    const from = providerCalls.length;
    const found = await get(`/integrations/${id}/contacts?email=${EMAIL}`);
    expect(found).toEqual({
      status: 200,
      body: {
        contact: {
          name: "Ada Contract",
          company: "Acme",
          url: "https://app.hubspot.com/contacts/42/contact/101",
          fields: [
            { label: "Lifecycle", value: "customer" },
            { label: "Deal value (account currency)", value: "1,250" },
            { label: "Deals", value: "2" },
          ],
        },
      },
    });
    // The search filters on the exact email.
    const search = providerCalls
      .slice(from)
      .find((call) => call.path.endsWith("/contacts/search"));
    expect(JSON.parse(search!.body).filterGroups).toEqual([
      { filters: [{ propertyName: "email", operator: "EQ", value: EMAIL }] },
    ]);
    const route = "POST /api.hubapi.com/crm/v3/objects/contacts/search";
    try {
      for (const body of [
        { results: [] },
        { results: [{ id: { nested: "101" }, properties: "x" }] },
      ]) {
        providerOverrides.set(route, { status: 200, body });
        expect(
          await get(`/integrations/${id}/contacts?email=${EMAIL}`),
          JSON.stringify(body),
        ).toEqual({ status: 200, body: { contact: null } });
      }
      // An answer without the result list is a provider failure, not "no match".
      for (const body of [{ results: "not a list" }, "not an object"]) {
        providerOverrides.set(route, { status: 200, body });
        expect(
          (await get(`/integrations/${id}/contacts?email=${EMAIL}`)).status,
          JSON.stringify(body),
        ).toBe(502);
      }
      // A provider failure is a fixed answer; provider text never reaches the caller.
      providerOverrides.set(route, {
        status: 500,
        body: { message: "provider secret detail" },
      });
      const failed = await get(`/integrations/${id}/contacts?email=${EMAIL}`);
      expect(failed.status).toBe(502);
      expect(JSON.stringify(failed.body)).not.toContain("secret detail");
      providerOverrides.set(route, { status: 401 });
      expect(
        (await get(`/integrations/${id}/contacts?email=${EMAIL}`)).status,
      ).toBe(409);
    } finally {
      providerOverrides.delete(route);
    }
    for (const email of ["not-an-email", `${"a".repeat(250)}@example.test`])
      expect(
        (
          await get(
            `/integrations/${id}/contacts?email=${encodeURIComponent(email)}`,
          )
        ).status,
      ).toBe(400);
    // A connection without contact lookup.
    const github = await oauthConnection(env, env.a);
    expect(
      (await get(`/integrations/${github}/contacts?email=${EMAIL}`)).status,
    ).toBe(409);
  });

  it("keeps only the Zendesk user with the exact email, and checks the stored subdomain again", async () => {
    const id = await oauthConnection(env, env.a, {
      type: "zendesk",
      config: { subdomain: "contract" },
    });
    expect(await get(`/integrations/${id}/contacts?email=${EMAIL}`)).toEqual({
      status: 200,
      body: {
        contact: {
          name: "Ada Contract",
          company: "Acme",
          url: "https://contract.zendesk.com/agent/users/9",
          fields: [
            { label: "Role", value: "end-user" },
            { label: "Tags", value: "vip" },
          ],
        },
      },
    });
    // The search also matches other addresses; a user with another address is not this contact.
    expect(
      await get(`/integrations/${id}/contacts?email=ada.other2@example.test`),
    ).toEqual({ status: 200, body: { contact: null } });

    await env.scoped(env.a, (db) =>
      db
        .update(integrations)
        .set({ config: { subdomain: "evil.example.com/x?" } })
        .where(eq(integrations.id, id)),
    );
    const calls = providerCalls.length;
    expect(
      (await get(`/integrations/${id}/contacts?email=${EMAIL}`)).status,
    ).toBe(409);
    expect(providerCalls.length).toBe(calls);
  });

  it("reads the Intercom company and tag names that the search gives only as references", async () => {
    const id = await oauthConnection(env, env.a, { type: "intercom" });
    expect(await get(`/integrations/${id}/contacts?email=${EMAIL}`)).toEqual({
      status: 200,
      body: {
        contact: {
          name: "Ada Contract",
          company: "Acme",
          url: "https://app.intercom.com/a/apps/_/users/6501",
          fields: [
            { label: "Plan", value: "pro" },
            { label: "Tags", value: "vip" },
          ],
        },
      },
    });
    // A failed name read leaves its field out; the contact still answers.
    const route = "GET /api.intercom.io/contacts/6501/tags";
    providerOverrides.set(route, { status: 500 });
    try {
      expect(
        (await get(`/integrations/${id}/contacts?email=${EMAIL}`)).body.contact
          .fields,
      ).toEqual([{ label: "Plan", value: "pro" }]);
    } finally {
      providerOverrides.delete(route);
    }
  });

  it("looks up the customer's own email, refreshes a due token and stores it", async () => {
    await disconnectAll();
    await platformCredentials(env, env.a, "hubspot");
    await dueConnection("hubspot", {});
    const person = await customer(env, env.a, { email: CONTEXT_EMAIL });
    const searched = (from: number) =>
      providerCalls
        .slice(from)
        .filter((call) => call.path.endsWith("/contacts/search"))
        .map((call) => JSON.parse(call.body).filterGroups[0].filters[0].value);

    let from = providerCalls.length;
    const res = await get(`/people/${person}/context`);
    expect(res.body.providers).toEqual([
      expect.objectContaining({ integrationType: "hubspot", status: "found" }),
    ]);
    expect(searched(from)).toEqual([CONTEXT_EMAIL]);
    const refresh = new URLSearchParams(
      providerCalls
        .slice(from)
        .find((call) => call.path === "/api.hubapi.com/oauth/v1/token")!.body,
    );
    expect(Object.fromEntries(refresh)).toMatchObject({
      grant_type: "refresh_token",
      client_id: "client-hubspot",
      refresh_token: "old-refresh",
    });
    expect(openCredentials((await stored("hubspot"))!.secrets)).toMatchObject({
      accessToken: "hubspot-contract-token",
      refreshToken: "hubspot-contract-refresh",
    });

    // A lead: its account email is a placeholder, so the lookup uses its contact email.
    const lead = await customer(env, env.a, { lead: true });
    const [lookedUp] = await env.scoped(env.a, (db) =>
      db
        .select({ contactEmail: principal.contactEmail })
        .from(principal)
        .where(eq(principal.id, lead as never)),
    );
    const route = "POST /api.hubapi.com/crm/v3/objects/contacts/search";
    providerOverrides.set(route, { status: 200, body: { results: [] } });
    from = providerCalls.length;
    try {
      expect((await get(`/people/${lead}/context`)).body.providers).toEqual([
        expect.objectContaining({
          integrationType: "hubspot",
          status: "not_found",
          error: null,
          contact: null,
        }),
      ]);
    } finally {
      providerOverrides.delete(route);
    }
    expect(searched(from)).toEqual([lookedUp!.contactEmail]);

    // A lead without a contact email has no address to look up: no entries, no calls.
    await env.scoped(env.a, (db) =>
      db
        .update(principal)
        .set({ contactEmail: null })
        .where(eq(principal.id, lead as never)),
    );
    from = providerCalls.length;
    expect(await get(`/people/${lead}/context`)).toEqual({
      status: 200,
      body: { providers: [] },
    });
    expect(providerCalls.length).toBe(from);
  });

  it("reads each connected provider for a customer; one failure does not fail the read", async () => {
    await disconnectAll();
    const person = await customer(env, env.a, { email: EMAIL });
    await oauthConnection(env, env.a, { type: "hubspot" });
    await oauthConnection(env, env.a, { type: "intercom" });
    const route = "POST /api.intercom.io/contacts/search";
    providerOverrides.set(route, {
      status: 500,
      body: { message: "provider secret detail" },
    });
    let res: Awaited<ReturnType<typeof get>>;
    try {
      res = await get(`/people/${person}/context`);
    } finally {
      providerOverrides.delete(route);
    }
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([
      expect.objectContaining({
        integrationType: "hubspot",
        status: "found",
        error: null,
        contact: expect.objectContaining({ name: "Ada Contract" }),
      }),
      expect.objectContaining({
        integrationType: "intercom",
        status: "failed",
        error: "The provider could not be reached. Try again.",
        contact: null,
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/secret detail|gho_seeded/);
  });

  it("reads Freshdesk and Stripe with their saved keys, and refuses a stored Freshdesk host outside freshdesk.com", async () => {
    const person = await customer(env, env.a, { email: KEYED_EMAIL });
    await disconnectAll();
    const keyConnection = (type: string, account: string) =>
      env.scoped(env.a, async (db, actor) => {
        await db
          .delete(integrations)
          .where(eq(integrations.integrationType, type));
        await db.insert(integrations).values({
          integrationType: type,
          status: "active",
          secrets: encryptSecret(
            JSON.stringify({ apiKey: `${type}-contract-key` }),
          )!,
          config: { workspaceName: type, account },
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        });
      });
    await keyConnection("stripe", "");
    await keyConnection("freshdesk", "contract.freshdesk.com");
    const fetchMock = vi.mocked(globalThis.fetch);
    const edge = fetchMock.getMockImplementation()!;
    const seen: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const target = new URL(
        input instanceof Request ? input.url : String(input),
      );
      seen.push(`${target.hostname}${target.pathname}`);
      if (target.href.startsWith("https://api.stripe.com/v1/customers?"))
        return Response.json({
          data: [{ id: "cus_Contract1", name: "Ada Stripe" }],
        });
      if (
        target.href.startsWith(
          "https://contract.freshdesk.com/api/v2/contacts?",
        )
      )
        return Response.json([{ id: 55, name: "Ada Desk", job_title: "CTO" }]);
      return edge(input, init);
    });
    try {
      const res = await get(`/people/${person}/context`);
      expect(res).toEqual({
        status: 200,
        body: {
          providers: [
            expect.objectContaining({
              integrationType: "freshdesk",
              status: "found",
              contact: {
                name: "Ada Desk",
                company: null,
                url: "https://contract.freshdesk.com/a/contacts/55",
                fields: [{ label: "Job title", value: "CTO" }],
              },
            }),
            expect.objectContaining({
              integrationType: "stripe",
              status: "found",
              contact: {
                name: "Ada Stripe",
                company: null,
                url: "https://dashboard.stripe.com/customers/cus_Contract1",
                fields: [{ label: "Customer ID", value: "cus_Contract1" }],
              },
            }),
          ],
        },
      });
      await keyConnection("freshdesk", "evil.example.com");
      seen.length = 0;
      const refused = await get(`/people/${person}/context`);
      expect(refused.body.providers[0]).toMatchObject({
        integrationType: "freshdesk",
        status: "failed",
        error: "The provider rejected the saved credentials. Reconnect.",
      });
      expect(seen).toEqual(["api.stripe.com/v1/customers"]);
    } finally {
      fetchMock.mockImplementation(edge);
      for (const type of ["stripe", "freshdesk"])
        await env.scoped(env.a, (db) =>
          db.delete(integrations).where(eq(integrations.integrationType, type)),
        );
    }
  });

  it("refuses the context of a teammate, a foreign-workspace person and a deleted person", async () => {
    await oauthConnection(env, env.a, { type: "hubspot" });
    const teammate = await env.scoped(
      env.a,
      async (_db, actor) => actor.principalId,
    );
    // The owner's portal profile has an email, but it belongs to a teammate, not a customer.
    const profile = await env.scoped(env.a, async (db) => {
      const [identity] = await db
        .insert(user)
        .values({
          name: "Teammate profile",
          email: "teammate.profile@example.test",
          kaneoUserId: env.owner,
        })
        .returning({ id: user.id });
      const [row] = await db
        .insert(principal)
        .values({
          userId: identity!.id,
          role: "user",
          type: "user",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      return row!.id;
    });
    const foreign = await customer(env, env.b);
    const deleted = await customer(env, env.a);
    const removed = await app.request(`/quills/${env.a}/users/${deleted}`, {
      method: "DELETE",
      ...as(env.owner),
    });
    expect(removed.status).toBe(200);
    const calls = providerCalls.length;
    for (const principalId of [teammate, profile, foreign, deleted])
      expect(await get(`/people/${principalId}/context`), principalId).toEqual({
        status: 404,
        body: expect.objectContaining({ message: "Person not found" }),
      });
    expect(providerCalls.length).toBe(calls);
  });

  it("writes no email and no token to audit, event or job rows", async () => {
    const secrets = [
      EMAIL,
      KEYED_EMAIL,
      CONTEXT_EMAIL,
      "contract-token",
      "contract-refresh",
      "salesforce-new-access",
      "old-access",
      "old-refresh",
      "gho_seeded",
      "contract-key",
    ];
    const leaked = await pool.query(
      `SELECT 'audit' AS source FROM quills.audit_log a WHERE a.workspace_id = ANY($1) AND a::text LIKE ANY($2)
       UNION ALL SELECT 'event' FROM quills.events e WHERE e.workspace_id = ANY($1) AND e::text LIKE ANY($2)
       UNION ALL SELECT 'job' FROM quills.job_queue j WHERE j.workspace_id = ANY($1) AND j::text LIKE ANY($2)`,
      [[env.a, env.b], secrets.map((value) => `%${value}%`)],
    );
    expect(leaked.rows).toEqual([]);
  });
});
