import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { integrations } from "../../../database/quills/schema/integrations";
import * as kaneo from "../../../database/schema";
import {
  decryptSecret,
  encryptSecret,
} from "../../../notification-preferences/secrets";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import { mintOAuthState } from "../../framework/signed";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import { APP_SECRET, platformCredentials } from "../oauth-seed.fixture";
import { providerCalls, providerOverrides } from "../provider-edge.fixture";
import { TEAMS_TEAM } from "./teams.fixture";

// Microsoft Teams against the local provider server (provider-edge.fixture.ts): connect, the token
// exchange, team and channel lists, Graph paging and the token refresh. No test reaches Microsoft.

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
vi.mock("../../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;

const TOKEN = "POST /login.microsoftonline.com/organizations/oauth2/v2.0/token";
const TEAMS = "GET /graph.microsoft.com/v1.0/me/joinedTeams";
const CHANNELS = `GET /graph.microsoft.com/v1.0/teams/${TEAMS_TEAM}/channels?$select=id,displayName`;
const SCOPE =
  "Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send offline_access";
const team = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  displayName: `Team ${n}`,
});

describe.skipIf(!url)("Microsoft Teams provider", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = () => ({ headers: { "x-test-user": contractEnv().owner } });
  beforeAll(async () => {
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
      "quills-contract-test-key";
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  /** A Teams connection in workspace A with these token fields, and the workspace's OAuth app. */
  async function connection(secrets: Record<string, string>) {
    const env = contractEnv();
    await platformCredentials(env, env.a, "teams");
    const [row] = await env.scoped(env.a, async (db, actor) => {
      await db
        .delete(integrations)
        .where(eq(integrations.integrationType, "teams"));
      return db
        .insert(integrations)
        .values({
          integrationType: "teams",
          status: "active",
          secrets: encryptSecret(JSON.stringify(secrets))!,
          config: {},
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        })
        .returning({ id: integrations.id });
    });
    return row!.id;
  }
  async function stored() {
    const env = contractEnv();
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.integrationType, "teams")),
    );
    return JSON.parse(decryptSecret(row!.secrets)!) as Record<string, string>;
  }
  async function list(id: string, query = "") {
    const res = await app.request(
      `/quills/${contractEnv().a}/integrations/${id}/destinations${query}`,
      as(),
    );
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  }
  /** The provider calls that `work` makes, as `METHOD /<host><path and query>`. */
  async function calls(work: () => Promise<unknown>) {
    const start = providerCalls.length;
    await work();
    return providerCalls
      .slice(start)
      .map((call) => `${call.method} ${call.path}`);
  }
  async function answering<T>(
    answers: Record<string, { status: number; body?: unknown }>,
    work: () => Promise<T>,
  ) {
    for (const [route, answer] of Object.entries(answers))
      providerOverrides.set(route, answer);
    try {
      return await work();
    } finally {
      providerOverrides.clear();
    }
  }

  it("connects with delegated scopes on the organizations endpoint, seals the tokens and keeps the granted scopes", async () => {
    const env = contractEnv();
    await platformCredentials(env, env.a, "teams");
    const res = await app.request(`/quills/${env.a}/oauth/teams/connect`, as());
    expect(res.status).toBe(200);
    const authorize = new URL(
      ((await res.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(authorize.origin + authorize.pathname).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    );
    const redirect = authorize.searchParams.get("redirect_uri")!;
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: "client-teams",
      response_type: "code",
      response_mode: "query",
      scope: SCOPE,
    });
    expect(redirect).toMatch(
      /\/api\/quills-public\/signed\/oauth\/teams\/callback$/,
    );

    // Microsoft adds session_state to a successful redirect.
    let body = "";
    const made = await calls(async () => {
      const done = await app.request(
        `/quills-public/signed/oauth/teams/callback?state=${encodeURIComponent(authorize.searchParams.get("state")!)}&code=contract-code&session_state=s`,
        as(),
      );
      expect(done.status).toBe(200);
      body = await done.text();
    });
    expect(made).toEqual([TOKEN]);
    expect(
      Object.fromEntries(new URLSearchParams(providerCalls.at(-1)!.body)),
    ).toEqual({
      client_id: "client-teams",
      client_secret: APP_SECRET,
      scope: SCOPE,
      code: "contract-code",
      grant_type: "authorization_code",
      redirect_uri: redirect,
    });
    expect(JSON.parse(body)).toMatchObject({
      status: "connected",
      integration: { workspaceName: "Microsoft Teams" },
    });
    expect(body).not.toContain("teams-contract");
    const secrets = await stored();
    expect(secrets).toMatchObject({
      accessToken: "teams-contract-token",
      refreshToken: "teams-contract-refresh",
    });
    // expires_in is 3600 seconds.
    expect(Date.parse(secrets.expiresAt!)).toBeGreaterThan(
      Date.now() + 3500_000,
    );
    // Delivery needs ChannelMessage.Send in the granted scopes of the token answer.
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ config: integrations.config })
        .from(integrations)
        .where(eq(integrations.integrationType, "teams")),
    );
    expect(row!.config).toMatchObject({
      scopes: "Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send",
    });
  });

  it("answers consent and token failures with fixed errors and no provider text", async () => {
    const env = contractEnv();
    await platformCredentials(env, env.a, "teams");
    const callback = (query: string) =>
      app.request(
        `/quills-public/signed/oauth/teams/callback?state=${encodeURIComponent(
          mintOAuthState({
            workspaceId: env.a,
            userId: env.owner,
            type: "teams",
          }),
        )}${query}`,
        as(),
      );
    // The tenant needs admin consent: Microsoft sends an error and no code.
    const made = await calls(async () => {
      const res = await callback(
        "&error=consent_required&error_description=AADSTS90094%3A+admin+consent+required",
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        message: "The provider did not grant access.",
      });
    });
    expect(made).toEqual([]);

    for (const answer of [
      // Consent removed between the redirect and the token call.
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "AADSTS65001: The user has not consented",
        },
      },
      // A malformed answer: no access token.
      { status: 200, body: { token_type: "Bearer" } },
    ]) {
      const res = await answering({ [TOKEN]: answer }, async () =>
        callback("&code=contract-code"),
      );
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(JSON.parse(text)).toMatchObject({
        message: "The provider rejected the request.",
      });
      expect(text).not.toContain("AADSTS");
    }
  });

  it("lists the joined teams and the channels of a listed team", async () => {
    const id = await connection({ accessToken: "teams-seeded" });
    for (const query of ["", "?kind=team"])
      expect(
        await calls(async () =>
          expect(await list(id, query)).toEqual({
            status: 200,
            body: {
              destinations: [{ id: TEAMS_TEAM, name: "Contract team" }],
            },
          }),
        ),
      ).toEqual([TEAMS]);
    expect(providerCalls.at(-1)!.authorization).toBe("Bearer teams-seeded");

    // The route lists the teams first, then the channels of the listed team.
    expect(
      await calls(async () =>
        expect(await list(id, `?kind=channel&parent=${TEAMS_TEAM}`)).toEqual({
          status: 200,
          body: {
            destinations: [{ id: "19:contract@thread.tacv2", name: "General" }],
          },
        }),
      ),
    ).toEqual([TEAMS, CHANNELS]);
  });

  it("refuses the channels of a team that the connection does not list", async () => {
    const id = await connection({ accessToken: "teams-seeded" });
    for (const parent of [team(9).id, "not-a-guid", "19:contract@thread.tacv2"])
      expect(
        await calls(async () =>
          expect(
            (
              await list(
                id,
                `?kind=channel&parent=${encodeURIComponent(parent)}`,
              )
            ).status,
          ).toBe(404),
        ),
        parent,
      ).toEqual([TEAMS]);
  });

  it("follows Graph paging on the Graph origin only, up to 200 items", async () => {
    const id = await connection({ accessToken: "teams-seeded" });
    const page = (value: unknown[], next?: string) => ({
      status: 200,
      body: { value, ...(next && { "@odata.nextLink": next }) },
    });
    const next = "https://graph.microsoft.com/v1.0/me/joinedTeams/page-2";

    // The Graph origin: followed.
    expect(
      await calls(async () =>
        expect(
          await answering(
            {
              [TEAMS]: page([team(1)], `${next}?$skiptoken=x`),
              [`GET /graph.microsoft.com/v1.0/me/joinedTeams/page-2`]: page([
                team(2),
              ]),
            },
            () => list(id),
          ),
        ).toEqual({
          status: 200,
          body: {
            destinations: [
              { id: team(1).id, name: "Team 1" },
              { id: team(2).id, name: "Team 2" },
            ],
          },
        }),
      ),
    ).toEqual([TEAMS, `${TEAMS}/page-2?$skiptoken=x`]);

    // Another host, port or scheme, or credentials in the link: the list ends, the token stays on Graph.
    const fetched = vi.mocked(globalThis.fetch).mock.calls.length;
    const links = [
      "https://login.microsoftonline.com/v1.0/me/joinedTeams/page-2",
      "https://graph.microsoft.com.evil.test/v1.0/me/joinedTeams/page-2",
      "https://graph.microsoft.com:8443/v1.0/me/joinedTeams/page-2",
      "https://user:pass@graph.microsoft.com/v1.0/me/joinedTeams/page-2",
      "http://graph.microsoft.com/v1.0/me/joinedTeams/page-2",
    ];
    for (const link of links)
      expect(
        await calls(async () =>
          expect(
            await answering({ [TEAMS]: page([team(1)], link) }, () => list(id)),
          ).toEqual({
            status: 200,
            body: { destinations: [{ id: team(1).id, name: "Team 1" }] },
          }),
        ),
        link,
      ).toEqual([TEAMS]);
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.slice(fetched)
        .map(([input]) => String(input)),
    ).toEqual(
      links.map(() => "https://graph.microsoft.com/v1.0/me/joinedTeams"),
    );

    // A link back to the same page: 200 items at most, and 10 pages at most.
    const loop = "https://graph.microsoft.com/v1.0/me/joinedTeams";
    const many = Array.from({ length: 150 }, (_, n) => team(n));
    let destinations: unknown[] = [];
    expect(
      (
        await calls(async () => {
          destinations = (
            await answering({ [TEAMS]: page(many, loop) }, () => list(id))
          ).body.destinations as unknown[];
        })
      ).length,
    ).toBe(2);
    expect(destinations.length).toBe(200);
    expect(
      (
        await calls(() =>
          answering({ [TEAMS]: page([], loop) }, () => list(id)),
        )
      ).length,
    ).toBe(10);
  });

  it("answers a Graph refusal and a malformed list with fixed errors", async () => {
    const id = await connection({ accessToken: "teams-seeded" });
    for (const [answer, status, message] of [
      [
        {
          status: 403,
          body: { error: { message: "Insufficient privileges" } },
        },
        409,
        "The connected account may not do this in the provider.",
      ],
      [
        { status: 200, body: { value: "not a list" } },
        502,
        "The provider could not be reached. Try again.",
      ],
      [
        { status: 200, body: { teams: [] } },
        502,
        "The provider could not be reached. Try again.",
      ],
    ] as const) {
      const res = await answering({ [TEAMS]: answer }, () => list(id));
      expect(res).toEqual({
        status,
        body: expect.objectContaining({ message }),
      });
      expect(JSON.stringify(res.body)).not.toContain("Insufficient");
    }
  });

  it("refreshes a due token and asks for a reconnect when the grant is gone", async () => {
    const due = new Date(Date.now() - 1000).toISOString();
    let id = await connection({
      accessToken: "expired",
      refreshToken: "old-refresh",
      expiresAt: due,
    });
    expect(
      await calls(async () => expect((await list(id)).status).toBe(200)),
    ).toEqual([TOKEN, TEAMS]);
    const [refresh, graph] = providerCalls.slice(-2);
    expect(Object.fromEntries(new URLSearchParams(refresh!.body))).toEqual({
      client_id: "client-teams",
      client_secret: APP_SECRET,
      scope: SCOPE,
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
    });
    expect(graph!.authorization).toBe("Bearer teams-contract-token");
    const secrets = await stored();
    expect(secrets).toMatchObject({
      accessToken: "teams-contract-token",
      refreshToken: "teams-contract-refresh",
    });
    // expires_in is 3600 seconds.
    expect(Date.parse(secrets.expiresAt!)).toBeGreaterThan(
      Date.now() + 3500_000,
    );

    // No new refresh token: the old one stays.
    id = await connection({
      accessToken: "expired",
      refreshToken: "old-refresh",
      expiresAt: due,
    });
    expect(
      (
        await answering(
          {
            [TOKEN]: {
              status: 200,
              body: { access_token: "rotated", expires_in: 3600 },
            },
          },
          () => list(id),
        )
      ).status,
    ).toBe(200);
    expect(await stored()).toMatchObject({
      accessToken: "rotated",
      refreshToken: "old-refresh",
    });

    // A malformed answer without an access token stores nothing.
    id = await connection({
      accessToken: "expired",
      refreshToken: "old-refresh",
      expiresAt: due,
    });
    expect(
      await answering(
        { [TOKEN]: { status: 200, body: { token_type: "Bearer" } } },
        () => list(id),
      ),
    ).toEqual({
      status: 409,
      body: expect.objectContaining({
        message: "The provider rejected the saved credentials. Reconnect.",
      }),
    });
    expect(await stored()).toEqual({
      accessToken: "expired",
      refreshToken: "old-refresh",
      expiresAt: due,
    });

    // invalid_grant: the refresh token or the consent is gone.
    id = await connection({
      accessToken: "expired",
      refreshToken: "revoked",
      expiresAt: due,
    });
    const res = await answering(
      {
        [TOKEN]: {
          status: 400,
          body: { error: "invalid_grant", error_description: "AADSTS70000" },
        },
      },
      () => list(id),
    );
    expect(res).toEqual({
      status: 409,
      body: expect.objectContaining({
        message: "The provider rejected the saved credentials. Reconnect.",
      }),
    });
    expect(JSON.stringify(res.body)).not.toContain("AADSTS");
    expect(await stored()).toMatchObject({ refreshToken: "revoked" });
  });
});
