import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { grantedScopes, hasScopes } from "../../integrations/delivery";
import { oauthProviders, validTarget } from "../../integrations/providers";
import { deliver, type Delivery } from "./integration-send";

// The provider delivery seam (deliverOAuth) against the local provider server
// (integrations/provider-edge.fixture.ts). No database.

/** Runs before each provider request, with its `METHOD /<host><path>`. Tests set it per call. */
let beforeSend: ((route: string) => void) | undefined;
const edge = vi.mocked(globalThis.fetch).getMockImplementation()!;
vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  beforeSend?.(`${init?.method ?? "GET"} /${url.hostname}${url.pathname}`);
  return edge(input, init);
});
/** Answers `route` with each value in turn, then with the server's own answer. */
const answers = (
  route: string,
  ...values: ({ status: number; body?: unknown } | "drop")[]
) => {
  beforeSend = (sent) => {
    if (sent !== route) return;
    const next = values.shift();
    if (next) providerOverrides.set(route, next);
    else providerOverrides.delete(route);
  };
};
const calls = (path: string) =>
  providerCalls.filter((call) => call.path.startsWith(path));

const gitlab = (overrides: Partial<Delivery> = {}): Delivery => ({
  provider: "gitlab",
  credentials: {
    accessToken: "old",
    refreshToken: "glrt_old",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  app: { clientId: "client", clientSecret: "secret" },
  target: "12",
  type: "post.created",
  occurredAt: new Date(),
  content: {
    board: "ideas",
    boardId: "board_1",
    post: {
      id: "post_1",
      title: "Dark mode",
      content: "Please",
      author: "Ada",
    },
  },
  deliveryId: "op_1",
  ...overrides,
});
const ISSUES = "POST /gitlab.com/api/v4/projects/12/issues";

afterEach(() => {
  beforeSend = undefined;
  providerOverrides.clear();
  providerCalls.length = 0;
});

describe("provider delivery seam", () => {
  it("gives every provider that lists events a deliver function", () => {
    for (const [type, provider] of Object.entries(oauthProviders))
      expect(provider.events.length === 0 || "deliver" in provider, type).toBe(
        true,
      );
  });

  it("refreshes once after a 401 and sends once more with the new token", async () => {
    answers(ISSUES, { status: 401 }, { status: 201, body: { iid: 4 } });
    const outcome = await deliver(gitlab());
    expect(outcome).toMatchObject({
      state: "succeeded",
      result: { externalId: "12#4" },
      refreshed: {
        accessToken: "glpat_contract_token",
        refreshToken: "glrt_contract_token",
      },
    });
    expect(providerCalls.map((call) => call.path)).toEqual([
      "/gitlab.com/api/v4/projects/12/issues",
      "/gitlab.com/oauth/token",
      "/gitlab.com/api/v4/projects/12/issues",
    ]);
    expect(providerCalls[0]!.authorization).toBe("Bearer old");
    expect(providerCalls[2]!.authorization).toBe("Bearer glpat_contract_token");
  });

  it("asks for a reconnect after a second 401, with one refresh only", async () => {
    answers(ISSUES, { status: 401 }, { status: 401 });
    expect(await deliver(gitlab())).toMatchObject({
      state: "auth_required",
      errorCode: "authentication",
      refreshed: { accessToken: "glpat_contract_token" },
    });
    expect(calls("/gitlab.com/oauth/token")).toHaveLength(1);
    expect(calls("/gitlab.com/api/v4/projects")).toHaveLength(2);
  });

  it("does not refresh again after a 401 when the due token was refreshed for this call", async () => {
    answers(ISSUES, { status: 401 });
    expect(
      await deliver(
        gitlab({
          credentials: {
            accessToken: "old",
            refreshToken: "glrt_old",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        }),
      ),
    ).toMatchObject({ state: "auth_required" });
    expect(calls("/gitlab.com/oauth/token")).toHaveLength(1);
    expect(calls("/gitlab.com/api/v4/projects")).toHaveLength(1);
  });

  it("sends nothing more when the refresh after a 401 is refused or unanswered", async () => {
    answers(ISSUES, { status: 401 });
    providerOverrides.set("POST /gitlab.com/oauth/token", { status: 400 });
    expect(await deliver(gitlab())).toEqual({
      state: "auth_required",
      errorCode: "authentication",
    });
    providerCalls.length = 0;
    answers(ISSUES, { status: 401 });
    providerOverrides.set("POST /gitlab.com/oauth/token", { status: 503 });
    expect(await deliver(gitlab())).toEqual({
      state: "retry_wait",
      errorCode: "unavailable",
    });
    expect(calls("/gitlab.com/api/v4/projects")).toHaveLength(1);
  });

  it("never resends after a 403, a 5xx or no answer", async () => {
    for (const answer of [{ status: 403 }, { status: 502 }, "drop"] as const) {
      providerCalls.length = 0;
      answers(ISSUES, answer);
      expect((await deliver(gitlab())).state).toMatch(
        /^(auth_required|uncertain)$/,
      );
      expect(providerCalls).toHaveLength(1);
    }
  });
});

describe("channel target rules", () => {
  const LINEAR_TEAM = "5b1f4c3e-0000-4000-8000-000000000001";
  it.each([
    ["jira", "10000:10001", true],
    ["jira", "10000", false],
    ["jira", "APP:10001", false],
    ["jira", "10000:10001:1", false],
    ["linear", LINEAR_TEAM, true],
    ["linear", LINEAR_TEAM.toUpperCase(), true],
    ["linear", "eng", false],
    ["linear", `${LINEAR_TEAM}x`, false],
    ["azure_devops", "Contract App:Bug", true],
    ["azure_devops", "Équipe (web):User Story", true],
    ["azure_devops", "Contract App", false],
    ["azure_devops", ":Bug", false],
    ["azure_devops", "Contract App:", false],
    ["azure_devops", "..:Bug", false],
    ["azure_devops", "App:..", false],
    ["azure_devops", " App:Bug", false],
    ["azure_devops", "App:Bug ", false],
    ["azure_devops", "App/x:Bug", false],
    ["azure_devops", "App:B:C", false],
    ["azure_devops", "App\u0007:Bug", false],
    ["azure_devops", `${"a".repeat(65)}:Bug`, false],
    // A provider without a rule keeps the default: 1 to 30 letters and digits.
    ["slack", "C0123ABCD", true],
    ["slack", "C0123-ABCD", false],
  ])("%s accepts %j: %s", (type, target, valid) => {
    expect(validTarget(type, target)).toBe(valid);
  });
});

describe("granted scopes", () => {
  it("records the answer's scopes, as a string or a list, or the requested ones", () => {
    expect(grantedScopes({ scope: "read write" }, "x")).toBe("read write");
    expect(grantedScopes({ scope: ["read", "issues:create"] }, "x")).toBe(
      "read issues:create",
    );
    expect(grantedScopes({}, "read,issues:create")).toBe("read issues:create");
    expect(grantedScopes({ scope: " " }, "read")).toBe("read");
    expect(hasScopes({ scopes: "read issues:create" }, ["issues:create"])).toBe(
      true,
    );
    expect(hasScopes({ scopes: "read" }, ["issues:create"])).toBe(false);
    expect(hasScopes({}, ["issues:create"])).toBe(false);
  });
});

describe("Linear answers", () => {
  const GRAPHQL = "POST /api.linear.app/graphql";
  const linear = (): Delivery => ({
    ...gitlab(),
    provider: "linear",
    credentials: {
      accessToken: "lin_token",
      refreshToken: "lin_refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    config: { scopes: "read issues:create" },
    target: "5b1f4c3e-0000-4000-8000-000000000001",
  });
  it.each([
    ["authentication error", "AUTHENTICATION_ERROR", "auth_required"],
    ["forbidden", "FORBIDDEN", "auth_required"],
    ["ratelimited", "RATELIMITED", "retry_wait"],
    ["invalid input", "INVALID_INPUT", "failed"],
  ])(
    "maps a refused mutation (%s) without a resend",
    async (type, code, state) => {
      answers(GRAPHQL, {
        status: 200,
        body: {
          data: null,
          errors: [{ message: "provider text", extensions: { type, code } }],
        },
      });
      const outcome = await deliver(linear());
      expect(outcome.state).toBe(state);
      expect(JSON.stringify(outcome)).not.toContain("provider text");
      expect(providerCalls).toHaveLength(1);
    },
  );
  it("records an answer with an issueCreate but no issue as uncertain, and drops a foreign URL", async () => {
    answers(GRAPHQL, {
      status: 200,
      body: { data: { issueCreate: { success: false } } },
    });
    expect(await deliver(linear())).toMatchObject({ state: "uncertain" });
    answers(GRAPHQL, {
      status: 200,
      body: {
        data: {
          issueCreate: {
            issue: {
              id: "9c2a4f1e-0000-4000-8000-000000000042",
              identifier: "<b>",
              url: "https://linear.app.evil.test/x",
            },
          },
        },
      },
    });
    expect(await deliver(linear())).toMatchObject({
      state: "succeeded",
      result: {
        externalId: "9c2a4f1e-0000-4000-8000-000000000042",
        externalDisplayId: undefined,
        externalUrl: null,
      },
    });
  });
});

describe("stored values checked before each call", () => {
  const CLOUD = "11111111-2222-3333-4444-555555555555";
  it("asks for a reconnect with no call for a bad Jira cloud ID or Azure DevOps organization", async () => {
    for (const [provider, config, target] of [
      ["jira", { cloudId: "../evil", scopes: "write:jira-work" }, "1:2"],
      ["jira", { cloudId: "evil.test/x", scopes: "write:jira-work" }, "1:2"],
      ["azure_devops", { organization: "evil.test/x" }, "App:Bug"],
      ["azure_devops", { organization: "" }, "App:Bug"],
    ] as const)
      expect(
        await deliver({ ...gitlab(), provider, config, target }),
        `${provider} ${JSON.stringify(config)}`,
      ).toMatchObject({ state: "auth_required", errorCode: "authentication" });
    expect(providerCalls).toEqual([]);
  });
  it("refuses a channel that is not the provider's shape before any call", async () => {
    for (const [provider, config, target] of [
      ["jira", { cloudId: CLOUD, scopes: "write:jira-work" }, "../1:2"],
      ["azure_devops", { organization: "contract" }, "..:Bug"],
      ["linear", { scopes: "issues:create" }, "../teams"],
    ] as const)
      expect(
        await deliver({ ...gitlab(), provider, config, target }),
      ).toMatchObject({ state: "failed", errorCode: "provider_failed" });
    expect(providerCalls).toEqual([]);
  });
});
