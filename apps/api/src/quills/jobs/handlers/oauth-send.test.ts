import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { deliver, type Delivery } from "./integration-send";

// OAuth deliveries against the local provider server (integrations/provider-edge.fixture.ts).

const delivery = (overrides: Partial<Delivery>): Delivery => ({
  provider: "github",
  credentials: { accessToken: "gho_token" },
  app: { clientId: "client", clientSecret: "secret", botToken: "bot" },
  target: "acme:app",
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
const calls = (path: string) =>
  providerCalls.filter((call) => call.path.startsWith(path));

afterEach(() => {
  providerOverrides.clear();
  providerCalls.length = 0;
});

describe("OAuth deliveries", () => {
  it("creates a GitHub issue and records its link", async () => {
    expect(await deliver(delivery({}))).toEqual({
      state: "succeeded",
      refreshed: undefined,
      result: {
        externalId: "acme/app#7",
        externalUrl: "https://github.com/acme/app/issues/7",
      },
    });
    const [call] = calls("/api.github.com/repos/acme/app/issues");
    expect(JSON.parse(call!.body)).toMatchObject({ title: "Dark mode" });
  });
  it("sends no GitHub issue for a status change", async () => {
    expect(await deliver(delivery({ type: "post.status_changed" }))).toEqual({
      state: "succeeded",
    });
    expect(providerCalls).toEqual([]);
  });
  it("records a create without an answer, or with a 5xx, as uncertain", async () => {
    providerOverrides.set("POST /api.github.com/repos/acme/app/issues", "drop");
    expect(await deliver(delivery({}))).toMatchObject({
      state: "uncertain",
      errorCode: "outcome_unknown",
    });
    providerOverrides.set("POST /api.github.com/repos/acme/app/issues", {
      status: 502,
    });
    expect(await deliver(delivery({}))).toMatchObject({ state: "uncertain" });
  });
  it("asks for a reconnect on a rejected token", async () => {
    providerOverrides.set("POST /api.github.com/repos/acme/app/issues", {
      status: 401,
    });
    expect(await deliver(delivery({}))).toMatchObject({
      state: "auth_required",
    });
  });
  it("posts Slack and Discord messages and maps Slack's error names", async () => {
    expect(
      await deliver(
        delivery({ provider: "slack", target: "C1", type: "comment.created" }),
      ),
    ).toEqual({ state: "succeeded" });
    providerOverrides.set("POST /slack.com/api/chat.postMessage", {
      status: 200,
      body: { ok: false, error: "token_revoked" },
    });
    expect(
      await deliver(delivery({ provider: "slack", target: "C1" })),
    ).toMatchObject({ state: "auth_required" });
    providerOverrides.set("POST /discord.com/api/v10/channels/9/messages", {
      status: 200,
      body: { id: "1" },
    });
    expect(
      await deliver(delivery({ provider: "discord", target: "9" })),
    ).toEqual({ state: "succeeded" });
    const [message] = calls("/discord.com/api/v10/channels/9/messages");
    expect(JSON.parse(message!.body)).toMatchObject({
      allowed_mentions: { parse: [] },
    });
  });
  it("records a Slack answer that may have posted as uncertain, and refuses an unsafe target", async () => {
    providerOverrides.set("POST /slack.com/api/chat.postMessage", {
      status: 200,
      body: { ok: false, error: "internal_error" },
    });
    expect(
      await deliver(delivery({ provider: "slack", target: "C1" })),
    ).toMatchObject({ state: "uncertain" });
    expect(await deliver(delivery({ target: "..:hooks" }))).toMatchObject({
      state: "failed",
    });
    expect(calls("/api.github.com")).toEqual([]);
    // A GitLab target is a numeric project ID: "acme" passes the default rule, not GitLab's.
    await deliver(delivery({ provider: "gitlab", target: "acme" }));
    expect(calls("/gitlab.com")).toEqual([]);
  });
  it("refreshes a due GitLab token first and returns the new secrets", async () => {
    providerOverrides.set("POST /gitlab.com/api/v4/projects/12/issues", {
      status: 201,
      body: { iid: 3, web_url: "https://gitlab.com/acme/app/-/issues/3" },
    });
    const outcome = await deliver(
      delivery({
        provider: "gitlab",
        target: "12",
        credentials: {
          accessToken: "old",
          refreshToken: "glrt_old",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          webhookSecret: "kept",
        },
      }),
    );
    expect(outcome).toMatchObject({
      state: "succeeded",
      result: { externalId: "12#3" },
      refreshed: {
        accessToken: "glpat_contract_token",
        refreshToken: "glrt_contract_token",
        webhookSecret: "kept",
      },
    });
    // The refresh ran first, and the create used the new token.
    expect(providerCalls.map((call) => call.path)).toEqual([
      "/gitlab.com/oauth/token",
      "/gitlab.com/api/v4/projects/12/issues",
    ]);
    expect(providerCalls[1]!.authorization).toBe("Bearer glpat_contract_token");
  });
  it("sends nothing when a GitLab refresh is rejected", async () => {
    providerOverrides.set("POST /gitlab.com/oauth/token", { status: 400 });
    expect(
      await deliver(
        delivery({
          provider: "gitlab",
          target: "12",
          credentials: {
            accessToken: "old",
            refreshToken: "glrt_old",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        }),
      ),
    ).toEqual({ state: "auth_required", errorCode: "authentication" });
    expect(calls("/gitlab.com/api/v4/projects")).toEqual([]);
  });
});
