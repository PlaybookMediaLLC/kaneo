import { once } from "node:events";
import { createServer, type AddressInfo, type Socket } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PrincipalId } from "@kaneo/ids";
import { sendStatusChangeEmail } from "@kaneo/email/quills";
import * as kaneo from "../../../database/schema";
import { emailLog } from "../../../database/quills/schema/email-log";
import { events } from "../../../database/quills/schema/events";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { notificationPreferences } from "../../../database/quills/schema/notifications";
import { subscribers } from "../fanout";
import { enqueueQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { rejection } from "./mail";

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
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("mail");

// The SMTP edge: a loopback sink. `mode` decides how it answers RCPT TO and the end of DATA.
type Mode = "accept" | "reject" | "busy" | "drop";
let mode: Mode = "accept";
let recipients: string[] = [];
let messages = 0;
const sockets = new Set<Socket>();
const sink = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 sink\r\n");
  let pending = "";
  let data = false;
  socket.on("data", (chunk) => {
    pending += chunk.toString();
    for (
      let end = pending.indexOf("\r\n");
      end >= 0;
      end = pending.indexOf("\r\n")
    ) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);
      if (data) {
        if (line !== ".") continue;
        data = false;
        messages++;
        if (mode === "drop") return socket.destroy();
        socket.write("250 queued\r\n");
      } else if (line.startsWith("EHLO") || line.startsWith("HELO"))
        socket.write("250 sink\r\n");
      else if (line.startsWith("RCPT TO")) {
        recipients.push(line);
        socket.write(
          mode === "reject"
            ? "550 no such mailbox\r\n"
            : mode === "busy"
              ? "451 try again later\r\n"
              : "250 ok\r\n",
        );
      } else if (line === "DATA") {
        data = true;
        socket.write("354 go ahead\r\n");
      } else if (line === "QUIT") socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
});

// A test-only event type that mails its recipients with a real Quills template.
let mate: PrincipalId;
subscribers["test.mail"] = {
  recipients: async () => ({ principalIds: [mate] }),
  mail: async () => ({
    type: "post_status_changed",
    emailType: "StatusChangeEmail",
    send: (to) =>
      sendStatusChangeEmail({
        to,
        postTitle: "Dark mode",
        postUrl: "https://example.test/posts/dark-mode",
        previousStatus: "open",
        newStatus: "planned",
        workspaceName: "Acme",
        unsubscribeUrl: "https://example.test/preferences",
      }),
  }),
};
const mailed = (actorId?: string) =>
  h.emit(h.a, {
    type: "test.mail",
    entityType: "team",
    entityId: "mail",
    actorId,
  });
const job = async (eventId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(eq(jobQueue.dedupeKey, `${eventId}:${mate}`)),
    )
  ).find((row) => row.queue === "quills.mail");
const outcome = async (eventId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({ outcome: hookDeliveries.outcome })
        .from(hookDeliveries)
        .where(eq(hookDeliveries.jobId, `mail:${eventId}:${mate}`)),
    )
  )[0]?.outcome;
const replay = (id: bigint) =>
  h.system(h.a, (db) =>
    db
      .update(jobQueue)
      .set({
        status: "pending",
        attempts: 0,
        runAt: new Date(0),
        finishedAt: null,
      })
      .where(eq(jobQueue.id, id)),
  );
/** A mail job queued by hand, as fan-out left it, with its event already published. */
async function queued() {
  const eventId = await mailed();
  await h.system(h.a, async (db) => {
    await db
      .update(events)
      .set({ publishedAt: new Date() })
      .where(eq(events.eventId, eventId));
    await enqueueQuillsJob(
      db,
      "quills.mail",
      { eventId, principalId: mate },
      `${eventId}:${mate}`,
      5,
    );
  });
  return eventId;
}

describe.skipIf(!url)("Quills mail delivery", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    mate = await h.principal(h.a, h.mate);
    sink.listen(0, "127.0.0.1");
    await once(sink, "listening");
    for (const key of [
      "EMAIL_SES_ACCESS_KEY_ID",
      "EMAIL_SES_SECRET_ACCESS_KEY",
      "EMAIL_RESEND_API_KEY",
      "RESEND_API_KEY",
    ])
      delete process.env[key];
    process.env.EMAIL_SMTP_HOST = "127.0.0.1";
    process.env.EMAIL_SMTP_PORT = String((sink.address() as AddressInfo).port);
    process.env.EMAIL_FROM = "Quills <quills@example.test>";
  }, 120000);
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    sink.close();
    await h.stop();
    await pool?.end();
  });
  beforeEach(() => {
    mode = "accept";
    recipients = [];
    messages = 0;
  });

  it("mails the teammate's account address once, also when the job is replayed", async () => {
    const eventId = await mailed();
    await h.drain(h.a);
    expect(messages).toBe(1);
    expect(recipients).toEqual([`RCPT TO:<${h.mate}@example.test>`]);
    const done = (await job(eventId))!;
    expect(done.status).toBe("succeeded");
    expect(await outcome(eventId)).toBe("completed");
    const [log] = await h.system(h.a, (db) =>
      db.select().from(emailLog).where(eq(emailLog.principalId, mate)),
    );
    expect(log).toMatchObject({
      status: "sent",
      emailType: "StatusChangeEmail",
      direction: "outbound",
    });

    await replay(done.id);
    await h.drain(h.a);
    expect(messages).toBe(1);
  });

  it("does not mail the actor", async () => {
    const eventId = await mailed(mate);
    await h.drain(h.a);
    expect(messages).toBe(0);
    expect(await job(eventId)).toBeUndefined();
  });

  it("records a dropped connection after the message as uncertain and never resends it", async () => {
    mode = "drop";
    const eventId = await mailed();
    await h.drain(h.a);
    expect(messages).toBe(1);
    const failed = (await job(eventId))!;
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.lastError).toContain("uncertain");
    expect(await outcome(eventId)).toBe("uncertain");

    mode = "accept";
    await replay(failed.id);
    await h.drain(h.a);
    expect(messages).toBe(1);
  });

  it("fails a permanent rejection at once and retries a temporary one", async () => {
    mode = "reject";
    const rejected = await mailed();
    await h.drain(h.a);
    expect((await job(rejected))!).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "SMTP 550",
    });
    expect(await outcome(rejected)).toBe("failed");

    mode = "busy";
    const busy = await mailed();
    await h.drain(h.a);
    expect((await job(busy))!).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "SMTP 451",
    });
    mode = "accept";
    await h.due(h.a);
    await h.drain(h.a);
    expect((await job(busy))!).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(messages).toBe(1);
  });

  it("treats an attempt that stopped after its claim as uncertain", async () => {
    const eventId = await queued();
    await h.system(h.a, (db) =>
      db.insert(hookDeliveries).values({
        jobId: `mail:${eventId}:${mate}`,
        hookType: "mail",
        outcome: "processing",
      }),
    );
    await h.drain(h.a);
    expect(messages).toBe(0);
    expect((await job(eventId))!.status).toBe("failed");
    expect(await outcome(eventId)).toBe("uncertain");
  });

  it("honors mute and sends nothing to a teammate who left before the send", async () => {
    await h.system(h.a, (db) =>
      db
        .insert(notificationPreferences)
        .values({ principalId: mate, emailMuted: true }),
    );
    const muted = await mailed();
    await h.drain(h.a);
    await h.system(h.a, (db) => db.delete(notificationPreferences));
    expect(messages).toBe(0);
    expect((await job(muted))!.status).toBe("succeeded");

    const left = await queued();
    await pool.query(
      "DELETE FROM public.workspace_member WHERE workspace_id=$1 AND user_id=$2",
      [h.a, h.mate],
    );
    try {
      await h.drain(h.a);
    } finally {
      await h.db().insert(kaneo.workspaceUserTable).values({
        workspaceId: h.a,
        userId: h.mate,
        role: "member",
        joinedAt: new Date(),
      });
    }
    expect(messages).toBe(0);
    expect((await job(left))!.status).toBe("succeeded");
    expect(await outcome(left)).toBeUndefined();
  });
});

describe("Quills mail error classes", () => {
  it("retries only failures that prove nothing was accepted", () => {
    const error = (fields: object) => Object.assign(new Error("x"), fields);
    expect(rejection(error({ responseCode: 451 }))).toEqual({
      error: "SMTP 451",
      permanent: false,
    });
    expect(rejection(error({ responseCode: 550 }))?.permanent).toBe(true);
    expect(rejection(error({ status: 429, retryable: true }))).toEqual({
      error: "Mail provider HTTP 429",
      permanent: false,
    });
    expect(rejection(error({ status: 422, retryable: false }))).toEqual({
      error: "Mail provider HTTP 422",
      permanent: true,
    });
    expect(rejection(error({ name: "SendRateQueueFullError" }))).toEqual({
      error: "Send rate limit reached",
      permanent: false,
    });
    expect(
      rejection(error({ name: "EmailConfigError", retryable: false })),
    ).toEqual({ error: "Mail is not configured", permanent: true });
    // Possibly accepted: a provider 5xx, or a failure with no answer.
    expect(rejection(error({ status: 503, retryable: true }))).toBeUndefined();
    expect(rejection(error({ status: null, retryable: true }))).toBeUndefined();
    expect(rejection(new Error("Connection closed"))).toBeUndefined();
  });
});
