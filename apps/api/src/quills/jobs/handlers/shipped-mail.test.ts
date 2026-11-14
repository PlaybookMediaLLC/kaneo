import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId } from "@kaneo/ids";
import {
  principal,
  user as customer,
} from "../../../database/quills/schema/auth";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../../database/quills/schema/changelog";
import { emailLog } from "../../../database/quills/schema/email-log";
import { events } from "../../../database/quills/schema/events";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import {
  inAppNotifications,
  notificationPreferences,
  postSubscriptions,
} from "../../../database/quills/schema/notifications";
import { postVotes } from "../../../database/quills/schema/posts";
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
import { runQuillsSweeps } from "./sweeps";

// Shipped notices (RFC 0003, feature 13) under a real database: the fan-out of changelog.published
// to the voters and followers of the linked posts, preferences, the delivery ledger on a retry,
// and the failure paths. The mail provider is the only fake: it records each send.

const mail = vi.hoisted(() => ({
  shipped: [] as {
    to: string;
    requestTitle: string;
    entryUrl: string;
    unsubscribeUrl: string;
  }[],
  fail: undefined as (() => never) | undefined,
}));
vi.mock("@kaneo/email/quills", async (original) => ({
  ...(await original<typeof import("@kaneo/email/quills")>()),
  sendShippedEmail: vi.fn(async (params: (typeof mail.shipped)[number]) => {
    mail.fail?.();
    mail.shipped.push(params);
    return { sent: true };
  }),
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

/** Runs the worker until nothing is due. */
async function drain() {
  for (let pass = 0; pass < 20; pass++) {
    const { processed, failed } = await drainQuillsWorkspace(
      contractEnv().a,
      async () => {},
    );
    if (!processed && !failed) return;
  }
}
const publish = (linkedPostIds: string[], notify?: boolean) =>
  Promise.resolve(
    app.request(`/quills/${contractEnv().a}/changelog`, {
      method: "POST",
      headers: {
        "x-test-user": contractEnv().owner,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: contractEnv().id("entry"),
        content: "Now live",
        publishState: { type: "published" },
        linkedPostIds,
        ...(notify !== undefined && { notify }),
      }),
    }),
  ).then(async (res) => ({ status: res.status, body: await res.json() }));
const eventOf = async (entryId: string) =>
  (
    await contractEnv().scoped(contractEnv().a, (db) =>
      db
        .select({ eventId: events.eventId })
        .from(events)
        .where(
          and(
            eq(events.type, "changelog.published"),
            eq(events.entityId, entryId),
          ),
        ),
    )
  )[0]?.eventId;
const mailJobs = (eventId: string) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db
      .select({
        id: jobQueue.id,
        status: jobQueue.status,
        dedupeKey: jobQueue.dedupeKey,
      })
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.queue, "quills.mail"),
          sql`${jobQueue.dedupeKey} like ${`${eventId}:%`}`,
        ),
      ),
  );
const to = () => mail.shipped.map((sent) => sent.to).sort();

describe.skipIf(!url)("Quills shipped notices", () => {
  let p1: { postId: string; title: string };
  let p2: { postId: string; title: string };
  const visitors: Record<string, { principalId: PrincipalId; email: string }> =
    {};
  let customerA: PrincipalId;
  let owner: PrincipalId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
    for (const key of [
      "EMAIL_SES_ACCESS_KEY_ID",
      "EMAIL_SES_SECRET_ACCESS_KEY",
      "EMAIL_RESEND_API_KEY",
      "RESEND_API_KEY",
      "EMAIL_SMTP_HOST",
    ])
      vi.stubEnv(key, "");
    const env = contractEnv();
    await enablePortal(env, env.a);
    p1 = await customerPost(env, env.a);
    p2 = await customerPost(env, env.a);
    const p3 = await customerPost(env, env.a);
    for (const name of [
      "voter",
      "follower",
      "statusOff",
      "muted",
      "typeOff",
      "unrelated",
    ]) {
      const visitor = await env.widgetVisitor(env.a);
      const [row] = await env.scoped(env.a, (db) =>
        db
          .select({ email: customer.email })
          .from(principal)
          .innerJoin(customer, eq(customer.id, principal.userId))
          .where(eq(principal.id, visitor.principalId as PrincipalId)),
      );
      visitors[name] = {
        principalId: visitor.principalId as PrincipalId,
        email: row!.email!,
      };
    }
    customerA = (await env.portalCustomer(env.a, env.customerA))
      .principalId as PrincipalId;
    await verifyEmail(env, env.customerA);
    owner = await env.scoped(env.a, async (_db, actor) => actor.principalId);
    const vote = (name: string, post: { postId: string }) => ({
      postId: post.postId as PostId,
      principalId: visitors[name]!.principalId,
    });
    await env.scoped(env.a, async (db) => {
      await db
        .insert(postVotes)
        .values([
          vote("voter", p1),
          vote("voter", p2),
          vote("muted", p1),
          vote("typeOff", p1),
          vote("unrelated", p3),
          { postId: p2.postId as PostId, principalId: customerA },
          { postId: p1.postId as PostId, principalId: owner },
        ]);
      await db.insert(postSubscriptions).values([
        {
          postId: p1.postId as PostId,
          principalId: visitors.follower!.principalId,
          reason: "manual",
        },
        {
          postId: p1.postId as PostId,
          principalId: visitors.statusOff!.principalId,
          reason: "manual",
          notifyStatusChanges: false,
        },
      ]);
      await db.insert(notificationPreferences).values([
        { principalId: visitors.muted!.principalId, emailMuted: true },
        {
          principalId: visitors.typeOff!.principalId,
          matrix: { post_shipped: { email: false } },
        },
      ]);
    });
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopContract();
  });

  it("mails each voter and follower once after commit, never the publisher", async () => {
    const env = contractEnv();
    mail.shipped.length = 0;
    const published = await publish([p1.postId, p2.postId]);
    expect(published.status).toBe(200);
    const eventId = (await eventOf(published.body.id))!;
    // Nothing is sent or queued for mail until the worker delivers the committed event.
    expect(mail.shipped).toEqual([]);
    expect(await mailJobs(eventId)).toEqual([]);

    await drain();
    expect(to()).toEqual(
      [
        visitors.voter!.email,
        visitors.follower!.email,
        `${env.customerA}@example.test`,
      ].sort(),
    );
    const byAddress = Object.fromEntries(
      mail.shipped.map((sent) => [sent.to, sent]),
    );
    // A voter of both posts hears about the first linked one; customer A about the one it voted for.
    expect(byAddress[visitors.voter!.email]).toMatchObject({
      requestTitle: p1.title,
      entryUrl: expect.stringContaining(`/changelog/${published.body.id}`),
    });
    expect(byAddress[`${env.customerA}@example.test`]).toMatchObject({
      requestTitle: p2.title,
    });
    const logged = await env.scoped(env.a, (db) =>
      db
        .select({ status: emailLog.status })
        .from(emailLog)
        .where(eq(emailLog.emailType, "ShippedEmail")),
    );
    expect(logged).toHaveLength(3);

    // A redelivered job finds its completed ledger row and sends nothing again.
    const key = `mail:${eventId}:${visitors.voter!.principalId}`;
    const [ledger] = await env.scoped(env.a, (db) =>
      db
        .select({ outcome: hookDeliveries.outcome })
        .from(hookDeliveries)
        .where(eq(hookDeliveries.jobId, key)),
    );
    expect(ledger).toEqual({ outcome: "completed" });
    await env.scoped(env.a, (db) =>
      db
        .update(jobQueue)
        .set({
          status: "pending",
          runAt: sql`now() - interval '1 second'`,
          attempts: 0,
          finishedAt: null,
        })
        .where(eq(jobQueue.queue, "quills.mail")),
    );
    await drain();
    expect(mail.shipped).toHaveLength(3);

    // The unsubscribe link turns the shipped notice off for that customer only.
    const token = new URL(
      byAddress[visitors.voter!.email]!.unsubscribeUrl,
    ).searchParams.get("token");
    const confirmed = await app.request(
      `/quills-public/${env.a}/unsubscribe/confirm`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kaneo-client-ip": "203.0.113.7",
        },
        body: JSON.stringify({ token }),
      },
    );
    expect(await confirmed.json()).toMatchObject({
      processed: true,
      action: "unsubscribe_shipped",
    });
    mail.shipped.length = 0;
    await publish([p1.postId]);
    await drain();
    expect(to()).toEqual([visitors.follower!.email]);
  });

  it("tells a teammate voter in-app on a scheduled publish, and nobody without a notice", async () => {
    const env = contractEnv();
    mail.shipped.length = 0;
    const entryId = await env.scoped(env.a, async (db) => {
      const [entry] = await db
        .insert(changelogEntries)
        .values({
          title: env.id("scheduled"),
          content: "Shipped on schedule",
          publishedAt: new Date(Date.now() - 60_000),
        })
        .returning({ id: changelogEntries.id });
      await db.insert(changelogEntryPosts).values({
        changelogEntryId: entry!.id,
        postId: p1.postId as PostId,
      });
      return entry!.id;
    });
    await runQuillsSweeps(env.a);
    expect(await eventOf(entryId)).toBeDefined();
    await drain();
    const inbox = await env.scoped(env.a, (db) =>
      db
        .select({
          type: inAppNotifications.type,
          title: inAppNotifications.title,
        })
        .from(inAppNotifications)
        .where(eq(inAppNotifications.principalId, owner)),
    );
    expect(inbox).toContainEqual({
      type: "post_shipped",
      title: expect.stringContaining("Shipped:"),
    });
    expect(to()).toContain(`${env.owner}@example.test`);

    mail.shipped.length = 0;
    const quiet = await publish([p1.postId, p2.postId], false);
    await drain();
    expect(await mailJobs((await eventOf(quiet.body.id))!)).toEqual([]);
    expect(mail.shipped).toEqual([]);
  });

  it("records a refused send as failed and an uncertain one as never sent again", async () => {
    const env = contractEnv();
    const outcomes = async (eventId: string) =>
      (
        await env.scoped(env.a, (db) =>
          db
            .select({ outcome: hookDeliveries.outcome })
            .from(hookDeliveries)
            .where(sql`${hookDeliveries.jobId} like ${`mail:${eventId}:%`}`),
        )
      ).map((row) => row.outcome);

    mail.fail = () => {
      throw Object.assign(new Error("refused"), { status: 422 });
    };
    const refused = await publish([p2.postId]);
    await drain();
    const refusedEvent = (await eventOf(refused.body.id))!;
    // Customer A's send was refused; the voter turned the notice off and gets no send at all.
    expect(await outcomes(refusedEvent)).toEqual(["failed"]);
    expect(
      (await mailJobs(refusedEvent)).find(
        (job) => job.dedupeKey === `${refusedEvent}:${customerA}`,
      )?.status,
    ).toBe("failed");

    mail.fail = () => {
      throw new Error("connection reset");
    };
    const unsure = await publish([p2.postId]);
    await drain();
    const unsureEvent = (await eventOf(unsure.body.id))!;
    expect(await outcomes(unsureEvent)).toEqual(["uncertain"]);
    mail.fail = undefined;
    mail.shipped.length = 0;
    await env.scoped(env.a, (db) =>
      db
        .update(jobQueue)
        .set({ status: "pending", runAt: sql`now()`, attempts: 0 })
        .where(sql`${jobQueue.dedupeKey} like ${`${unsureEvent}:%`}`),
    );
    await drain();
    expect(mail.shipped).toEqual([]);
  });
});
