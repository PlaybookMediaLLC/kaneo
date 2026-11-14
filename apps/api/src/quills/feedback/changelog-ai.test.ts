import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { events } from "../../database/quills/schema/events";
import { postVotes } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  chatReply,
  provider,
  providerUrl,
} from "../assistant/provider-edge.fixture";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { postIn } from "./seeds.fixture";

// The AI changelog draft (RFC 0003, feature 14) against a real database and the local provider edge.

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
vi.mock("../../ws", () => ({ broadcastToUserAndWait: vi.fn(async () => {}) }));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

const draft = async (postIds: string[], workspace = contractEnv().a) => {
  const res = await app.request(`/quills/${workspace}/changelog/drafts`, {
    method: "POST",
    headers: {
      "x-test-user": contractEnv().owner,
      "content-type": "application/json",
    },
    body: JSON.stringify({ postIds }),
  });
  return { status: res.status, body: await res.json() };
};

const usage = () =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db
      .select({ step: aiUsageLog.pipelineStep, tokens: aiUsageLog.totalTokens })
      .from(aiUsageLog)
      .where(eq(aiUsageLog.pipelineStep, "changelog_draft")),
  );
const stored = () =>
  contractEnv().scoped(contractEnv().a, async (db) => ({
    entries: (
      await db.select({ id: changelogEntries.id }).from(changelogEntries)
    ).length,
    events: (await db.select({ id: events.id }).from(events)).length,
  }));

describe.skipIf(!url)("Quills AI changelog draft", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    provider.reply();
    await stopContract();
  });

  it("drafts from visible posts, counts requesters, logs usage and saves nothing", async () => {
    const env = contractEnv();
    const first = await postIn(env, env.a, { title: "Dark mode" });
    const second = await postIn(env, env.a, { title: "CSV export" });
    const voters = await Promise.all(
      [env.customerA, env.customerB].map(
        async (user) =>
          (await env.portalCustomer(env.a, user)).principalId as PrincipalId,
      ),
    );
    await env.scoped(env.a, (db) =>
      db.insert(postVotes).values([
        { postId: first.postId as PostId, principalId: voters[0]! },
        { postId: second.postId as PostId, principalId: voters[0]! },
        { postId: second.postId as PostId, principalId: voters[1]! },
      ]),
    );
    provider.requests.length = 0;
    provider.reply(() =>
      chatReply({
        title: "Dark mode and CSV export",
        body: "- Dark mode\n- CSV export",
      }),
    );
    const before = await stored();

    const res = await draft([first.postId, second.postId]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      title: "Dark mode and CSV export",
      body: "- Dark mode\n- CSV export",
      postIds: [first.postId, second.postId],
      requesterCount: 2,
    });
    // The prompt holds the posts as untrusted data.
    const prompt = JSON.stringify(provider.requests.at(-1)?.body.messages);
    expect(prompt).toContain("<requests>");
    expect(prompt).toContain("Dark mode");
    expect(await usage()).toEqual([{ step: "changelog_draft", tokens: 20 }]);
    // No entry, no event: a draft publishes nothing.
    expect(await stored()).toEqual(before);
  });

  it("refuses foreign or unknown posts and bad lists before any provider call", async () => {
    const env = contractEnv();
    const mine = await postIn(env, env.a);
    const foreign = await postIn(env, env.b);
    provider.requests.length = 0;
    expect((await draft([mine.postId, foreign.postId])).status).toBe(404);
    expect((await draft([])).status).toBe(400);
    expect((await draft([mine.postId, mine.postId])).status).toBe(400);
    expect(
      (await draft(Array.from({ length: 26 }, () => mine.postId))).status,
    ).toBe(400);
    expect(provider.requests).toEqual([]);
  });

  it("answers 409 when AI is off and 502 for a provider failure, without usage rows", async () => {
    const env = contractEnv();
    const post = await postIn(env, env.a);
    const before = (await usage()).length;
    vi.stubEnv("QUILLS_AI_BASE_URL", "");
    try {
      const off = await draft([post.postId]);
      expect(off.status).toBe(409);
      expect(off.body).toMatchObject({ message: "AI is not configured" });
    } finally {
      vi.stubEnv("QUILLS_AI_BASE_URL", providerUrl);
    }
    provider.reply(() => ({ status: 500, json: { error: "secret detail" } }));
    const failed = await draft([post.postId]);
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("secret detail");
    expect((await usage()).length).toBe(before);
  });
});
