import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { auditLog } from "../../../database/quills/schema/audit-log";
import { boards } from "../../../database/quills/schema/boards";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { kvStore } from "../../../database/quills/schema/kv";
import {
  notificationPreferences,
  postSubscriptions,
} from "../../../database/quills/schema/notifications";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import * as kaneo from "../../../database/schema";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import {
  customerPost,
  enablePortal,
  verifyEmail,
} from "../../portal/customer-seed.fixture";
import { drainQuillsWorkspace } from "../worker";
import { digestWeek, queueWeeklyDigests } from "./digest";
import { runQuillsSweeps } from "./sweeps";

// The weekly digest (RFC 0003, feature 16, D15) under a real database. The mail provider is the
// only fake: it records each send.

const mail = vi.hoisted(() => ({
  digests: [] as {
    to: string;
    items: { title: string; status: string; url: string }[];
    unsubscribeUrl: string;
  }[],
}));
vi.mock("@kaneo/email/quills", async (original) => ({
  ...(await original<typeof import("@kaneo/email/quills")>()),
  sendWeeklyDigestEmail: vi.fn(
    async (params: (typeof mail.digests)[number]) => {
      mail.digests.push(params);
      return { sent: true };
    },
  ),
}));

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
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

async function drain() {
  for (let pass = 0; pass < 20; pass++) {
    const { processed, failed } = await drainQuillsWorkspace(
      contractEnv().a,
      async () => {},
    );
    if (!processed && !failed) return;
  }
}
const digestJobs = () =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db
      .select({ key: jobQueue.dedupeKey, status: jobQueue.status })
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.queue, "quills.mail"),
          like(jobQueue.dedupeKey, "digest:%"),
        ),
      ),
  );

describe("digest week", () => {
  it("covers the ISO week (UTC) before the current one", () => {
    expect(digestWeek(new Date("2026-11-13T10:00:00Z"))).toEqual({
      week: "2026-W45",
      from: new Date("2026-11-02T00:00:00Z"),
      to: new Date("2026-11-09T00:00:00Z"),
    });
    expect(digestWeek(new Date("2026-11-09T00:00:00Z")).week).toBe("2026-W45");
    expect(digestWeek(new Date("2027-01-01T12:00:00Z")).week).toBe("2026-W52");
    expect(digestWeek(new Date("2027-01-04T00:00:00Z")).week).toBe("2026-W53");
    expect(digestWeek(new Date("2026-01-05T00:00:00Z")).week).toBe("2026-W01");
  });
});

describe.skipIf(!url)("Quills weekly digest", () => {
  const { week, from, to } = digestWeek();
  const lastWeek = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const people: Record<string, PrincipalId> = {};
  const titles: Record<string, string> = {};
  const post: Record<string, PostId> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
    const env = contractEnv();
    await enablePortal(env, env.a);
    for (const name of ["p1", "p2", "p3", "p4", "hidden", "late"]) {
      const created = await customerPost(env, env.a);
      post[name] = created.postId as PostId;
      titles[name] = created.title;
    }
    const foreign = await customerPost(env, env.b);
    for (const name of ["c1", "c2", "c3"])
      people[name] = (await env.widgetVisitor(env.a))
        .principalId as PrincipalId;
    people.customerA = (await env.portalCustomer(env.a, env.customerA))
      .principalId as PrincipalId;
    await verifyEmail(env, env.customerA);
    people.owner = await env.scoped(
      env.a,
      async (_db, actor) => actor.principalId,
    );
    await env.scoped(env.a, async (db) => {
      await db.insert(postVotes).values([
        { postId: post.p1!, principalId: people.c1! },
        { postId: post.hidden!, principalId: people.c1! },
        { postId: post.late!, principalId: people.c1! },
        { postId: post.p3!, principalId: people.c2! },
        { postId: post.p4!, principalId: people.c3! },
        { postId: post.p1!, principalId: people.owner! },
      ]);
      await db.insert(postSubscriptions).values([
        { postId: post.p2!, principalId: people.c1!, reason: "manual" },
        { postId: post.p1!, principalId: people.customerA!, reason: "manual" },
      ]);
      await db.insert(notificationPreferences).values({
        principalId: people.c2!,
        matrix: { weekly_digest: { email: false } },
      });
      // Status changes last week, one this week (`late`), none for p4.
      await db.insert(auditLog).values([
        ...["p1", "p2", "p3", "hidden"].map((name) => ({
          eventType: "post.status_changed",
          targetType: "post",
          targetId: post[name]!,
          occurredAt: lastWeek,
          actorType: "user",
        })),
        {
          eventType: "post.status_changed",
          targetType: "post",
          targetId: post.late!,
          occurredAt: new Date(to.getTime() + 60_000),
          actorType: "user",
        },
      ]);
      // The voter can no longer see this post's board.
      const [hidden] = await db
        .select({ boardId: posts.boardId })
        .from(posts)
        .where(eq(posts.id, post.hidden!));
      await db
        .update(boards)
        .set({
          access: {
            view: "team",
            vote: "team",
            submit: "team",
            comment: "team",
            segments: { view: [], vote: [], submit: [], comment: [] },
            moderation: {
              comments: "inherit",
              anonPosts: "inherit",
              signedPosts: "inherit",
            },
          },
        })
        .where(eq(boards.id, hidden!.boardId));
    });
    await env.scoped(env.b, (db) =>
      db.insert(auditLog).values({
        eventType: "post.status_changed",
        targetType: "post",
        targetId: foreign.postId,
        occurredAt: lastWeek,
        actorType: "user",
      }),
    );
  }, 120000);
  afterAll(async () => {
    await stopContract();
  });

  it("sends one digest per customer with the visible posts that changed last week", async () => {
    const env = contractEnv();
    await runQuillsSweeps(env.a);
    expect((await digestJobs()).map((job) => job.key).sort()).toEqual(
      ["c1", "c2", "customerA"]
        .map((name) => `digest:${people[name]}:${week}`)
        .sort(),
    );
    await drain();
    const byAddress = Object.fromEntries(
      mail.digests.map((sent) => [sent.to, sent]),
    );
    expect(Object.keys(byAddress)).toHaveLength(2);
    const c1 = mail.digests.find(
      (sent) => sent.to !== `${env.customerA}@example.test`,
    )!;
    expect(c1.items.map((item) => item.title).sort()).toEqual(
      [titles.p1!, titles.p2!].sort(),
    );
    expect(byAddress[`${env.customerA}@example.test`]!.items).toEqual([
      expect.objectContaining({ title: titles.p1 }),
    ]);

    // A second sweep, a lost week marker and a redelivered job send nothing new.
    await runQuillsSweeps(env.a);
    await env.scoped(env.a, (db) =>
      db.delete(kvStore).where(eq(kvStore.key, `digest:${week}`)),
    );
    await env.scoped(env.a, (db) => queueWeeklyDigests(db));
    expect(await digestJobs()).toHaveLength(3);
    await env.scoped(env.a, (db) =>
      db
        .update(jobQueue)
        .set({ status: "pending", runAt: sql`now()`, attempts: 0 })
        .where(like(jobQueue.dedupeKey, "digest:%")),
    );
    await drain();
    expect(mail.digests).toHaveLength(2);
  });

  it("stops the digest through its unsubscribe link and the preference route", async () => {
    const env = contractEnv();
    const sent = mail.digests.find(
      (digest) => digest.to === `${env.customerA}@example.test`,
    )!;
    const token = new URL(sent.unsubscribeUrl).searchParams.get("token");
    // The customer turned the in-app digest off before: the link keeps that choice.
    await env.scoped(env.a, (db) =>
      db
        .insert(notificationPreferences)
        .values({
          principalId: people.customerA!,
          matrix: { weekly_digest: { inApp: false } },
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.workspaceId,
            notificationPreferences.principalId,
          ],
          set: { matrix: { weekly_digest: { inApp: false } } },
        }),
    );
    const res = await app.request(
      `/quills-public/${env.a}/unsubscribe/confirm`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kaneo-client-ip": "203.0.113.9",
        },
        body: JSON.stringify({ token }),
      },
    );
    expect(await res.json()).toMatchObject({
      processed: true,
      action: "unsubscribe_digest",
    });
    const preference = await app.request(
      `/quills-public/${env.a}/user/weekly-digest`,
      { headers: { "x-test-user": env.customerA } },
    );
    expect(await preference.json()).toEqual({ weeklyDigest: false });
    const [stored] = await env.scoped(env.a, (db) =>
      db
        .select({ matrix: notificationPreferences.matrix })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.principalId, people.customerA!)),
    );
    expect(stored!.matrix).toMatchObject({
      weekly_digest: { inApp: false, email: false },
    });
  });

  it("includes the voter of a duplicate that was merged into a changed post", async () => {
    const env = contractEnv();
    const duplicate = (await customerPost(env, env.a)).postId as PostId;
    const voter = (await env.widgetVisitor(env.a)).principalId as PrincipalId;
    await env.scoped(env.a, async (db) => {
      await db
        .update(posts)
        .set({ canonicalPostId: post.p1! })
        .where(eq(posts.id, duplicate));
      await db
        .insert(postVotes)
        .values({ postId: duplicate, principalId: voter });
      // The week is done after the first test: queue it again for the new voter.
      await db.delete(kvStore).where(eq(kvStore.key, `digest:${week}`));
      await queueWeeklyDigests(db);
    });
    expect((await digestJobs()).map((job) => job.key)).toContain(
      `digest:${voter}:${week}`,
    );
    const sent = mail.digests.length;
    await drain();
    expect(mail.digests).toHaveLength(sent + 1);
    // The digest names the post that the duplicate was merged into.
    expect(mail.digests.at(-1)!.items).toEqual([
      expect.objectContaining({ title: titles.p1 }),
    ]);
  });
});
