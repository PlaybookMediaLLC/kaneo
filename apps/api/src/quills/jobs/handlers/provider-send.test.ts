import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
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
