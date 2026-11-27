import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { toUuid } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { conversations } from "../../database/quills/schema/conversation";
import { events } from "../../database/quills/schema/events";
import { jobQueue } from "../../database/quills/schema/job-queue";
import {
  isOriginAllowed,
  normalizeCidr,
  normalizeEmailDomain,
  normalizeOriginPattern,
  solvePowChallenge,
} from "../framework/anti-spam";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import quillsRouter from "../index";
import { fanOut } from "../jobs/fanout";
import publicRouter from "../public";
import { enableWidget } from "../widget/seed.fixture";

// Anti-spam integration & unit proof (#320):
// 1. Unit tests for origin patterns, CIDR & email-domain normalization.
// 2. Real-PG tests for origin allow-list, CIDR /24 & email-domain & visitor blocks,
//    stateless PoW challenge issuance + replay rejection, 3-tier rate limits with Retry-After,
//    heuristic spam quarantine, bulk mark_spam + blockVisitors, and ZERO AI/notification/mail fan-out.

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
const uuid = (id: string) => (id.includes("_") ? toUuid(id) : id);

describe("anti-spam pure helpers (#320)", () => {
  it("normalizes exact and wildcard origin patterns and checks Origin/Referer", () => {
    expect(normalizeOriginPattern("HTTPS://App.Acme.com/")).toBe(
      "https://app.acme.com",
    );
    expect(normalizeOriginPattern("https://*.acme.com")).toBe(
      "https://*.acme.com",
    );
    expect(normalizeOriginPattern("javascript:alert(1)")).toBeNull();
    expect(normalizeOriginPattern("https://acme.com/path")).toBeNull();

    const list = ["https://app.acme.com", "https://*.staging.acme.com"];
    expect(isOriginAllowed("https://app.acme.com", null, list)).toBe(true);
    expect(isOriginAllowed("https://pr-42.staging.acme.com", null, list)).toBe(
      true,
    );
    expect(isOriginAllowed("https://staging.acme.com", null, list)).toBe(false);
    expect(isOriginAllowed("https://evil.example", null, list)).toBe(false);
    expect(isOriginAllowed("null", null, list)).toBe(false);
    expect(
      isOriginAllowed(null, "https://app.acme.com/billing?tab=1", list),
    ).toBe(true);
    expect(isOriginAllowed(null, "https://evil.example/phish", list)).toBe(
      false,
    );
  });

  it("normalizes IPv4/IPv6 CIDR ranges and email domains", () => {
    expect(normalizeCidr("203.0.113.5")).toBe("203.0.113.5/32");
    expect(normalizeCidr("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(normalizeCidr("203.0.113.5/24")).toBe("203.0.113.0/24");
    expect(normalizeCidr("2001:db8::1/48")).toBe("2001:db8::/48");
    expect(normalizeCidr("203.0.113.5/")).toBeNull();
    expect(normalizeCidr("203.0.113.0/99")).toBeNull();
    expect(normalizeCidr("not-an-ip")).toBeNull();

    expect(normalizeEmailDomain("@Spammer.Example")).toBe("spammer.example");
    expect(normalizeEmailDomain("bad domain")).toBeNull();
  });
});

describe.skipIf(!url)("anti-spam real PostgreSQL integration (#320)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    await enableWidget(contractEnv(), contractEnv().a);
  }, 120_000);

  afterAll(() => stopContract());

  async function teamJson(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await app.request(`/quills/${contractEnv().a}${path}`, {
      method,
      headers: {
        "x-test-user": contractEnv().owner,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function pubReq(
    method: string,
    path: string,
    opts?: {
      bearer?: string;
      ip?: string;
      origin?: string;
      headers?: Record<string, string>;
      body?: unknown;
    },
  ): Promise<{ status: number; headers: Headers; body: any }> {
    const res = await app.request(`/quills-public/${contractEnv().a}${path}`, {
      method,
      headers: {
        ...(opts?.bearer && { authorization: `Bearer ${opts.bearer}` }),
        ...(opts?.ip && { "x-kaneo-client-ip": opts.ip }),
        ...(opts?.origin && { origin: opts.origin }),
        ...(opts?.body !== undefined && { "content-type": "application/json" }),
        ...opts?.headers,
      },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return {
      status: res.status,
      headers: res.headers,
      body: await res.json().catch(() => null),
    };
  }

  it("enforces widget allowedOrigins on /widget/* endpoints", async () => {
    const patch = await teamJson("PUT", "/settings/widget", {
      allowedOrigins: ["https://app.acme.test", "https://*.acme.test"],
    });
    expect(patch.status).toBe(200);
    expect(patch.body.allowedOrigins).toEqual([
      "https://app.acme.test",
      "https://*.acme.test",
    ]);

    const ok = await pubReq("GET", "/widget/config.json", {
      origin: "https://docs.acme.test",
    });
    expect(ok.status).toBe(200);

    const denied = await pubReq("GET", "/widget/config.json", {
      origin: "https://attacker.test",
    });
    expect(denied.status).toBe(403);

    const nullOriginDenied = await pubReq("GET", "/widget/config.json", {
      origin: "null",
    });
    expect(nullOriginDenied.status).toBe(403);

    await teamJson("PUT", "/settings/widget", { allowedOrigins: [] });
  });

  it("enforces stateless PoW challenge in always mode, rejects replay, and blocks provider downgrade", async () => {
    await teamJson("PUT", "/settings/widget", {
      antiSpam: { challengeMode: "always", challengeProvider: "pow" },
    });

    const ip = "198.51.100.41";
    const missing = await pubReq("POST", "/widget/anonymous-session", { ip });
    expect(missing.status).toBe(403);
    expect(missing.body?.code).toBe("CHALLENGE_REQUIRED");

    const ch = await pubReq("POST", "/widget/challenge", { ip });
    expect(ch.status).toBe(200);
    expect(ch.body.provider).toBe("pow");
    const nonce = solvePowChallenge(ch.body.token);

    const solvedHeaders = {
      "x-quills-challenge-provider": "pow",
      "x-quills-challenge-token": ch.body.token,
      "x-quills-challenge-nonce": nonce,
    };
    const allowed = await pubReq("POST", "/widget/anonymous-session", {
      ip,
      headers: solvedHeaders,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.sessionToken).toBeTruthy();

    // Replaying the exact same PoW solution MUST fail
    const replayed = await pubReq("POST", "/widget/anonymous-session", {
      ip,
      headers: solvedHeaders,
    });
    expect(replayed.status).toBe(403);
    expect(replayed.body?.code).toBe("CHALLENGE_INVALID");

    // Switching workspace to Turnstile MUST reject a client-submitted PoW proof
    const ch2 = await pubReq("POST", "/widget/challenge", { ip });
    const nonce2 = solvePowChallenge(ch2.body.token);
    await teamJson("PUT", "/settings/widget", {
      antiSpam: {
        challengeMode: "always",
        challengeProvider: "turnstile",
        turnstileSiteKey: "1x00000000000000000000AA",
      },
    });
    const downgraded = await pubReq("POST", "/widget/anonymous-session", {
      ip,
      headers: {
        "x-quills-challenge-provider": "pow",
        "x-quills-challenge-token": ch2.body.token,
        "x-quills-challenge-nonce": nonce2,
      },
    });
    expect(downgraded.status).toBe(403);
    expect(downgraded.body?.code).toBe("CHALLENGE_INVALID");

    await teamJson("PUT", "/settings/widget", {
      antiSpam: { challengeMode: "off", challengeProvider: "pow" },
    });
  });

  it("enforces workspace-wide and per-IP caps with Retry-After on floods", async () => {
    await teamJson("PUT", "/settings/widget", {
      antiSpam: {
        challengeMode: "off",
        rateLimits: {
          sessionsPerIpHour: 2,
          conversationsPerIp10m: 3,
          workspaceConversationsPer10m: 5,
        },
      },
    });

    const ip1 = "198.51.100.51";
    const s1 = await pubReq("POST", "/widget/anonymous-session", { ip: ip1 });
    const s2 = await pubReq("POST", "/widget/anonymous-session", { ip: ip1 });
    const s3 = await pubReq("POST", "/widget/anonymous-session", { ip: ip1 });
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
    expect(s3.status).toBe(429);
    expect(Number(s3.headers.get("retry-after"))).toBeGreaterThan(0);

    // Distributed flood across different IPs hits workspace cap (5 * 6 = 30 hourly cap or 5 conv cap)
    // Verify per-IP and workspace session cap both enforce Retry-After
    let created = 0;
    let limited = 0;
    for (let i = 0; i < 35; i++) {
      const ip = `198.51.101.${i + 1}`;
      const sess = await pubReq("POST", "/widget/anonymous-session", { ip });
      if (sess.status === 429) {
        limited++;
        expect(Number(sess.headers.get("retry-after"))).toBeGreaterThan(0);
        continue;
      }
      if (sess.status === 200) created++;
    }
    expect(created).toBeLessThanOrEqual(30);
    expect(limited).toBeGreaterThan(0);

    await teamJson("PUT", "/settings/widget", {
      antiSpam: {
        challengeMode: "off",
        rateLimits: {
          sessionsPerIpHour: 200,
          conversationsPerIp10m: 200,
          workspaceConversationsPer10m: 500,
        },
      },
    });
  });

  it("blocks non-canonical CIDR /24 ranges, validates visitor_principal, and allows removal", async () => {
    const badPrincipal = await teamJson("POST", "/support/spam-blocks", {
      kind: "visitor_principal",
      value: "not-a-valid-principal-id",
    });
    expect(badPrincipal.status).toBe(400);

    const create = await teamJson("POST", "/support/spam-blocks", {
      kind: "ip_cidr",
      value: "203.0.113.5/24",
      reason: "Botnet /24",
      expiresInDays: 7,
    });
    expect(create.status).toBe(200);
    expect(create.body.value).toBe("203.0.113.0/24");
    const blockId = create.body.id;

    const blocked = await pubReq("POST", "/widget/anonymous-session", {
      ip: "203.0.113.77",
    });
    expect(blocked.status).toBe(403);

    const allowed = await pubReq("POST", "/widget/anonymous-session", {
      ip: "203.0.114.77",
    });
    expect(allowed.status).toBe(200);

    const del = await teamJson("DELETE", `/support/spam-blocks/${blockId}`);
    expect(del.status).toBe(200);
    const restored = await pubReq("POST", "/widget/anonymous-session", {
      ip: "203.0.113.77",
    });
    expect(restored.status).toBe(200);
  });

  it("quarantines heuristic spam silently and enqueues ZERO AI/notification/mail jobs", async () => {
    const ip = "198.51.100.88";
    const sess = await pubReq("POST", "/widget/anonymous-session", { ip });
    expect(sess.status).toBe(200);

    const spamBody =
      "FREE CRYPTO AIRDROP CLICK NOW https://evil1.example https://evil2.example https://evil3.example BUY VIAGRA CASINO WINNER!!!";
    const conv = await pubReq("POST", "/widget/conversations", {
      bearer: sess.body.sessionToken,
      ip,
      body: {
        content: spamBody,
        idempotencyKey: `spam-${contractEnv().id("k")}`,
        attachmentIds: [],
      },
    });
    expect(conv.status).toBe(200);
    const convId = uuid(conv.body.conversation.id);

    await withQuillsSystemWorkspace(contractEnv().a, async (db) => {
      const [row] = await db
        .select({
          status: conversations.status,
          endReason: conversations.endReason,
          spamReason: conversations.spamReason,
        })
        .from(conversations)
        .where(eq(conversations.id, convId as never));
      expect(row?.status).toBe("closed");
      expect(row?.endReason).toBe("spam");
      expect(row?.spamReason).toBe("heuristic");

      const evRows = await db
        .select({ eventId: events.eventId })
        .from(events)
        .where(eq(events.entityId, conv.body.conversation.id));

      for (const ev of evRows) {
        await fanOut(contractEnv().a, ev.eventId);
        const queued = await db
          .select({ queue: jobQueue.queue })
          .from(jobQueue)
          .where(eq(jobQueue.dedupeKey, ev.eventId));
        // Only the initial quills.event outbox job exists; ZERO AI, notification, mail, or webhook jobs.
        expect(queued.filter((j) => j.queue !== "quills.event")).toEqual([]);
      }
    });
  });

  it("supports bulk mark_spam with blockVisitors=true", async () => {
    const ip = "198.51.100.99";
    const sess = await pubReq("POST", "/widget/anonymous-session", { ip });
    expect(sess.status).toBe(200);

    const conv = await pubReq("POST", "/widget/conversations", {
      bearer: sess.body.sessionToken,
      ip,
      body: {
        content: "Hello normal message before bulk spam action",
        idempotencyKey: `bulk-${contractEnv().id("k")}`,
        attachmentIds: [],
      },
    });
    expect(conv.status).toBe(200);
    const convId = conv.body.conversation.id;

    const bulk = await teamJson("POST", "/conversations/bulk", {
      conversationIds: [convId],
      action: { type: "mark_spam", blockVisitors: true },
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.changedIds).toContain(convId);

    const second = await pubReq("POST", "/widget/conversations", {
      bearer: sess.body.sessionToken,
      ip,
      body: {
        content: "Trying again after being blocked",
        idempotencyKey: `bulk2-${contractEnv().id("k")}`,
        attachmentIds: [],
      },
    });
    expect(second.status).toBe(403);
  });
});
