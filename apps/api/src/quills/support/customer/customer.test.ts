import { createHmac, randomUUID } from "node:crypto";
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
import { and, desc, eq, isNull, like, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PrincipalId } from "@kaneo/ids";
import { settings } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { emailLog } from "../../../database/quills/schema/email-log";
import { events } from "../../../database/quills/schema/events";
import { kvStore } from "../../../database/quills/schema/kv";
import { inAppNotifications } from "../../../database/quills/schema/notifications";
import {
  postComments,
  posts,
  postVotes,
} from "../../../database/quills/schema/posts";
import { statusComponents } from "../../../database/quills/schema/status";
import { postStatuses } from "../../../database/quills/schema/statuses";
import {
  tickets,
  ticketStatuses,
} from "../../../database/quills/schema/tickets";
import * as kaneo from "../../../database/schema";
import { broadcastToUserAndWait } from "../../../ws";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import { openPublic, statusContentIn } from "../../content/public/seed.fixture";
import quillsRouter from "../../index";
import { fanOut } from "../../jobs/fanout";
import { drainQuillsWorkspace } from "../../jobs/worker";
import {
  accountEmail,
  customerPost,
  enablePortal,
  verifyEmail,
} from "../../portal/customer-seed.fixture";
import { contactEmailCode } from "../../framework/signed";
import publicRouter from "../../public";
import {
  anonymousVisitor,
  contactEmailOf,
} from "../../widget/contact-email.fixture";
import { signIdentity } from "../../widget/seed.fixture";
import { withinOfficeHours } from "../../widget/support/presence";
import { mintCsatToken } from "./csat-email";
import {
  conversationOf,
  enableMessenger,
  plainCustomer,
  ticketOf,
  ticketTypesIn,
} from "./seed.fixture";

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
// The WebSocket edge: the test reads what the worker hands to the user socket.
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));
const broadcast = vi.mocked(broadcastToUserAndWait);

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

// The SMTP edge: a loopback sink that accepts every message and keeps it.
let mail: { to: string[]; data: string }[] = [];
const sockets = new Set<Socket>();
const sink = createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 sink\r\n");
  let pending = "";
  let data: string[] | null = null;
  let to: string[] = [];
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
        if (line !== ".") {
          data.push(line);
          continue;
        }
        mail.push({ to, data: data.join("\n") });
        data = null;
        to = [];
        socket.write("250 queued\r\n");
      } else if (line.startsWith("EHLO") || line.startsWith("HELO"))
        socket.write("250 sink\r\n");
      else if (line.startsWith("RCPT TO")) {
        to.push(line.slice(line.indexOf("<") + 1, line.lastIndexOf(">")));
        socket.write("250 ok\r\n");
      } else if (line === "DATA") {
        data = [];
        socket.write("354 go ahead\r\n");
      } else if (line === "QUIT") socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
});
/** The message text with base64 and quoted-printable bodies decoded, for content checks. */
const readable = (data: string) => {
  const unfolded = data.replace(/=\n/g, "");
  const decoded = unfolded
    .split(/\n\n/)
    .map((part) =>
      /^[A-Za-z0-9+/=\n]+$/.test(part.trim()) && part.trim().length > 20
        ? Buffer.from(part.replace(/\n/g, ""), "base64").toString("utf8")
        : part,
    )
    .join("\n");
  return `${unfolded}\n${decoded}`;
};

/** A request under /quills (teammate) or /quills-public (portal session or widget bearer). */
async function call(
  method: string,
  path: string,
  options: {
    user?: string;
    bearer?: string;
    body?: unknown;
    teammate?: boolean;
    workspace?: string;
  } = {},
) {
  const env = contractEnv();
  const base = options.teammate ? "/quills" : "/quills-public";
  const res = await app.request(
    `${base}/${options.workspace ?? env.a}${path}`,
    {
      method,
      headers: {
        "x-test-user": options.user ?? "",
        "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
        ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
        ...(options.body !== undefined && {
          "content-type": "application/json",
        }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}
const key = () => `key_${Date.now().toString(36)}_${++client}`;
const drain = () => drainQuillsWorkspace(contractEnv().a);
const eventsOf = (entityId: string) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db
      .select({ eventId: events.eventId, type: events.type })
      .from(events)
      .where(eq(events.entityId, entityId)),
  );
/** Delivers every pending event and forgets what it sent, so a test sees only its own deliveries. */
const settle = async () => {
  await drain();
  await drain();
  mail = [];
  broadcast.mockClear();
};

let mateUser = "";
let mate: PrincipalId;

const INBOUND_KEY = Buffer.from("customer-test-inbound-key").toString("base64");
/** A Resend inbound mail through the signed route, Svix-signed with the test key. */
async function inbound(
  to: string,
  from: string,
  messageId: string,
  text: string,
  headers: Record<string, string> = {},
) {
  const raw = JSON.stringify({
    type: "email.received",
    data: {
      from,
      to: [to],
      subject: "Help",
      text,
      headers: { "message-id": messageId, ...headers },
    },
  });
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(INBOUND_KEY, "base64"))
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  const res = await app.request("/quills-public/signed/chat/email/inbound", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: raw,
  });
  return { status: res.status, body: await res.json() };
}
/** A header of a raw message from the SMTP sink, unfolded. */
const headerOf = (data: string, name: string) =>
  new RegExp(`^${name}:[ \\t]*(.*(?:\\n[ \\t].*)*)`, "im")
    .exec(data)?.[1]
    ?.replace(/\n[ \t]+/g, " ")
    .trim();
const customerCalls = () =>
  broadcast.mock.calls.filter(
    ([, message]) => message.type === "QUILLS_CUSTOMER_CHANGED",
  );

describe.skipIf(!url)("Quills customer support routes and delivery", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    const env = await startContract(pool, url!);
    sink.listen(0, "127.0.0.1");
    await once(sink, "listening");
    for (const name of [
      "EMAIL_SES_ACCESS_KEY_ID",
      "EMAIL_SES_SECRET_ACCESS_KEY",
      "EMAIL_RESEND_API_KEY",
      "RESEND_API_KEY",
    ])
      vi.stubEnv(name, "");
    vi.stubEnv("EMAIL_SMTP_HOST", "127.0.0.1");
    vi.stubEnv("EMAIL_SMTP_PORT", String((sink.address() as AddressInfo).port));
    vi.stubEnv("EMAIL_FROM", "Quills <quills@example.test>");
    // Inbound mail is on: reply mail carries a signed Reply-To and threads by Message-ID.
    vi.stubEnv("EMAIL_INBOUND_SIGNING_SECRET", `whsec_${INBOUND_KEY}`);
    vi.stubEnv("EMAIL_INBOUND_DOMAIN", "in.example.test");
    // A second teammate with Quills read: the mention and watcher recipient.
    mateUser = `${env.a}_mate`;
    await env.db.insert(kaneo.userTable).values({
      id: mateUser,
      name: mateUser,
      email: `${mateUser}@example.test`,
    });
    await env.db.insert(kaneo.workspaceUserTable).values({
      workspaceId: env.a,
      userId: mateUser,
      role: "member",
      joinedAt: new Date(),
    });
    mate = await env.scoped(
      env.a,
      async (_db, actor) => actor.principalId,
      mateUser,
    );
    await enableMessenger(env, env.a);
    await enablePortal(env, env.a);
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const socket of sockets) socket.destroy();
    sink.close();
    if (mateUser)
      await pool.query("DELETE FROM public.workspace_member WHERE user_id=$1", [
        mateUser,
      ]);
    await stopContract();
    if (mateUser) {
      const cleanup = new Pool({ connectionString: url, max: 1 });
      await cleanup.query('DELETE FROM public."user" WHERE id=$1', [mateUser]);
      await cleanup.end();
    }
  });
  beforeEach(() => {
    mail = [];
    broadcast.mockClear();
  });

  it("keeps each widget visitor to their own conversations, messages and tickets, without internal notes", async () => {
    const env = contractEnv();
    const a = await env.widgetVisitor(env.a);
    const b = await env.widgetVisitor(env.a);
    const started = await call("POST", "/widget/conversations", {
      bearer: a.token,
      body: { content: "My export fails", idempotencyKey: key() },
    });
    expect(started.status).toBe(200);
    const id = started.body.conversation.id as string;
    const reply = await call("POST", `/conversations/${id}/reply`, {
      user: env.owner,
      teammate: true,
      body: { content: "ReplyMarker-one" },
    });
    expect(reply.status).toBe(200);
    const note = await call("POST", `/conversations/${id}/note`, {
      user: env.owner,
      teammate: true,
      body: { content: "NoteMarker-secret" },
    });
    expect(note.status).toBe(200);

    // A reads the thread: the reply is there, the note is not, in any read.
    const thread = await call("GET", `/widget/conversations/${id}`, {
      bearer: a.token,
    });
    expect(thread.status).toBe(200);
    const after = await call(
      "GET",
      `/widget/conversations/${id}/messages?after=${started.body.message.id}`,
      { bearer: a.token },
    );
    const list = await call("GET", "/widget/conversations", {
      bearer: a.token,
    });
    for (const res of [thread, after, list])
      expect(JSON.stringify(res.body)).not.toContain("NoteMarker-secret");
    expect(
      thread.body.messages.map((m: { content: string }) => m.content),
    ).toEqual(["My export fails", "ReplyMarker-one"]);
    expect(after.body.items.map((m: { content: string }) => m.content)).toEqual(
      ["ReplyMarker-one"],
    );
    expect(thread.body.messages[0].fromVisitor).toBe(true);
    // The teammate's display name shows; the teammate's principal ID never does.
    const ownerPrincipal = await env.scoped(
      env.a,
      async (_db, actor) => actor.principalId,
    );
    expect(JSON.stringify(thread.body)).not.toContain(ownerPrincipal);

    // B, another visitor of the same workspace, sees nothing of A's and changes nothing.
    const before = await env.scoped(env.a, (db) =>
      db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, id as never)),
    );
    const replyId = reply.body.message.id as string;
    const denied = await Promise.all([
      call("GET", `/widget/conversations/${id}`, { bearer: b.token }),
      call("GET", `/widget/conversations/${id}/messages`, { bearer: b.token }),
      call("POST", `/widget/conversations/${id}/messages`, {
        bearer: b.token,
        body: { content: "Hijack", idempotencyKey: key() },
      }),
      call("PUT", `/widget/conversations/${id}/read`, {
        bearer: b.token,
        body: { throughMessageId: replyId },
      }),
      call("POST", `/widget/conversations/${id}/csat`, {
        bearer: b.token,
        body: { rating: 1 },
      }),
      call("POST", `/widget/conversations/${id}/typing`, { bearer: b.token }),
      call("GET", `/widget/conversations/${id}/ticket`, { bearer: b.token }),
    ]);
    expect(denied.map((res) => res.status)).toEqual([
      404, 404, 404, 404, 404, 404, 404,
    ]);
    const others = await call("GET", "/widget/conversations", {
      bearer: b.token,
    });
    expect(others.body.items).toEqual([]);
    expect(
      await env.scoped(env.a, (db) =>
        db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, id as never)),
      ),
    ).toEqual(before);
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ csat: conversations.csatRating })
        .from(conversations)
        .where(eq(conversations.id, id as never)),
    );
    expect(row!.csat).toBeNull();

    // Tickets: A files one; B cannot list, watch or read it.
    const ticket = await call("POST", "/widget/tickets", {
      bearer: a.token,
      body: { title: "Billing question", description: "TicketMarker-a" },
    });
    expect(ticket.status).toBe(200);
    expect(
      (await call("GET", "/widget/tickets", { bearer: a.token })).body.items,
    ).toHaveLength(1);
    expect(
      (await call("GET", "/widget/tickets", { bearer: b.token })).body.items,
    ).toEqual([]);
    expect(
      (
        await call("PUT", `/widget/tickets/${ticket.body.id}/watch`, {
          bearer: b.token,
        })
      ).status,
    ).toBe(404);
    const pair = await call(
      "GET",
      `/widget/conversations/${ticket.body.conversationId}/ticket`,
      { bearer: a.token },
    );
    expect(pair.body.ticket.id).toBe(ticket.body.id);
    expect(
      (
        await call(
          "GET",
          `/widget/conversations/${ticket.body.conversationId}`,
          { bearer: b.token },
        )
      ).status,
    ).toBe(404);
  });

  it("moves the read watermark only forward and counts only team messages after it", async () => {
    const env = contractEnv();
    const a = await env.widgetVisitor(env.a);
    const started = await call("POST", "/widget/conversations", {
      bearer: a.token,
      body: { content: "Hello", idempotencyKey: key() },
    });
    const id = started.body.conversation.id as string;
    const reply = (content: string) =>
      call("POST", `/conversations/${id}/reply`, {
        user: env.owner,
        teammate: true,
        body: { content },
      });
    const r1 = await reply("First answer");
    await call("POST", `/conversations/${id}/note`, {
      user: env.owner,
      teammate: true,
      body: { content: "Not counted" },
    });
    const unread = async () =>
      (await call("GET", "/widget/unread", { bearer: a.token })).body
        .unreadCount;
    expect(await unread()).toBe(1);
    await reply("Second answer");
    expect(await unread()).toBe(2);
    const read = (messageId: string) =>
      call("PUT", `/widget/conversations/${id}/read`, {
        bearer: a.token,
        body: { throughMessageId: messageId },
      });
    const first = await read(r1.body.message.id);
    expect(first.body).toEqual({ unreadCount: 1, changed: true });
    // A late acknowledgment of the visitor's own older message changes nothing.
    const late = await read(started.body.message.id);
    expect(late.body).toEqual({ unreadCount: 1, changed: false });
    expect(await unread()).toBe(1);
  });

  it("returns the first result for a repeated idempotency key, refuses other text and holds under concurrency", async () => {
    const env = contractEnv();
    const a = await env.widgetVisitor(env.a);
    const started = await call("POST", "/widget/conversations", {
      bearer: a.token,
      body: { content: "Start", idempotencyKey: key() },
    });
    const id = started.body.conversation.id as string;
    const k = key();
    const send = (content: string) =>
      call("POST", `/widget/conversations/${id}/messages`, {
        bearer: a.token,
        body: { content, idempotencyKey: k },
      });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => send("Same text")),
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(results.map((res) => res.body.message.id)).size).toBe(1);
    expect(results.filter((res) => !res.body.replayed)).toHaveLength(1);
    const again = await send("Same text");
    expect(again.body).toMatchObject({
      replayed: true,
      message: { id: results[0]!.body.message.id },
    });
    expect((await send("Other text")).status).toBe(409);
    const rows = await env.scoped(env.a, (db) =>
      db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, id as never),
            eq(conversationMessages.content, "Same text"),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
    const created = (await eventsOf(rows[0]!.id)).filter(
      (event) => event.type === "message.created",
    );
    expect(created).toHaveLength(1);
  });

  it("closes the portal routes while the portal is off and applies the private-portal gate", async () => {
    const env = contractEnv();
    const setPortal = (config: object) =>
      env.scoped(env.a, (db) =>
        db.update(settings).set({ portalConfig: JSON.stringify(config) }),
      );
    try {
      await setPortal({ enabled: false });
      expect(
        (await call("GET", "/support/conversations", { user: env.customerA }))
          .status,
      ).toBe(404);
      await setPortal({ enabled: true, access: { visibility: "private" } });
      // Customer B has no verified address, invite or grant.
      expect(
        (await call("GET", "/support/tickets", { user: env.customerB })).status,
      ).toBe(403);
      expect(
        (
          await call("POST", "/support/conversations", {
            user: env.customerB,
            body: { content: "Let me in", idempotencyKey: key() },
          })
        ).status,
      ).toBe(403);
    } finally {
      await setPortal({ enabled: true });
    }
  });

  it("tells only the owning portal customer about their conversation over the user socket, never about notes", async () => {
    const env = contractEnv();
    await settle();
    const started = await call("POST", "/support/conversations", {
      user: env.customerA,
      body: { content: "Portal question", idempotencyKey: key() },
    });
    expect(started.status).toBe(200);
    const id = started.body.conversation.id as string;
    await settle();
    const reply = await call("POST", `/conversations/${id}/reply`, {
      user: env.owner,
      teammate: true,
      body: { content: "Portal answer" },
    });
    await drain();
    const customerCalls = broadcast.mock.calls.filter(
      ([, message]) => message.type === "QUILLS_CUSTOMER_CHANGED",
    );
    expect(customerCalls).toEqual([
      [
        env.customerA,
        expect.objectContaining({
          type: "QUILLS_CUSTOMER_CHANGED",
          workspaceId: env.a,
          conversationId: id,
        }),
      ],
    ]);
    expect(JSON.stringify(customerCalls)).not.toContain("Portal answer");
    expect(reply.status).toBe(200);

    broadcast.mockClear();
    await call("POST", `/conversations/${id}/note`, {
      user: env.owner,
      teammate: true,
      body: { content: "Internal only" },
    });
    await drain();
    expect(
      broadcast.mock.calls.filter(
        ([user, message]) =>
          message.type === "QUILLS_CUSTOMER_CHANGED" || user === env.customerA,
      ),
    ).toEqual([]);
    expect(broadcast.mock.calls.some(([user]) => user === env.customerB)).toBe(
      false,
    );
  });

  it("mails a teammate reply on an email conversation to the customer once, and never a note", async () => {
    const env = contractEnv();
    const visitor = await plainCustomer(env, env.a);
    const thread = await conversationOf(
      env,
      env.a,
      visitor.principalId,
      "email",
    );
    const [{ address }] = (await env.scoped(env.a, (db) =>
      db
        .select({ address: conversations.visitorEmail })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    )) as [{ address: string }];
    await settle();
    const reply = await call(
      "POST",
      `/conversations/${thread.conversationId}/reply`,
      {
        user: env.owner,
        teammate: true,
        body: { content: "ReplyMarker-mail" },
      },
    );
    expect(reply.status).toBe(200);
    await call("POST", `/conversations/${thread.conversationId}/note`, {
      user: env.owner,
      teammate: true,
      body: { content: "NoteMarker-mail" },
    });
    await drain();
    await drain();
    const toCustomer = mail.filter((m) => m.to.includes(address));
    expect(toCustomer).toHaveLength(1);
    expect(readable(toCustomer[0]!.data)).toContain("ReplyMarker-mail");
    for (const m of mail)
      expect(readable(m.data)).not.toContain("NoteMarker-mail");

    // A messenger conversation's reply is not mailed: the widget reads it.
    const plain = await conversationOf(env, env.a, visitor.principalId);
    await settle();
    await call("POST", `/conversations/${plain.conversationId}/reply`, {
      user: env.owner,
      teammate: true,
      body: { content: "Messenger reply" },
    });
    await drain();
    expect(mail).toHaveLength(0);
  });

  it("notifies a mentioned teammate and a ticket watcher, never the author", async () => {
    const env = contractEnv();
    const visitor = await plainCustomer(env, env.a);
    const thread = await conversationOf(env, env.a, visitor.principalId);
    await settle();
    const note = await call(
      "POST",
      `/conversations/${thread.conversationId}/note`,
      {
        user: env.owner,
        teammate: true,
        body: { content: "Can you look?", mentionPrincipalIds: [mate] },
      },
    );
    expect(note.status).toBe(200);
    await drain();
    await drain();
    const notices = () =>
      env.scoped(env.a, (db) =>
        db
          .select({
            type: inAppNotifications.type,
            title: inAppNotifications.title,
          })
          .from(inAppNotifications)
          .where(eq(inAppNotifications.principalId, mate)),
      );
    expect((await notices()).map((n) => n.type)).toEqual(["note_mention"]);
    expect(mail.map((m) => m.to)).toEqual([[`${mateUser}@example.test`]]);

    const ticket = await ticketOf(
      env,
      env.a,
      visitor.principalId,
      thread.conversationId,
    );
    expect(
      (
        await call("PUT", `/tickets/${ticket.ticketId}/watch`, {
          user: mateUser,
          teammate: true,
        })
      ).status,
    ).toBe(200);
    await settle();
    await call("POST", `/tickets/${ticket.ticketId}/reply`, {
      user: env.owner,
      teammate: true,
      body: { content: "On it" },
    });
    await drain();
    await drain();
    expect((await notices()).map((n) => n.type).sort()).toEqual([
      "note_mention",
      "ticket_watch",
    ]);
    // The author watches too (the reply subscribes the replier) but hears nothing.
    const [owner] = await env.scoped(env.a, async (_db, actor) => [
      actor.principalId,
    ]);
    const ownNotices = await env.scoped(env.a, (db) =>
      db
        .select({ id: inAppNotifications.id })
        .from(inAppNotifications)
        .where(eq(inAppNotifications.principalId, owner!)),
    );
    expect(ownNotices).toEqual([]);
  });

  it("mails a customer subscriber about a post only while the portal still shows them the post", async () => {
    const env = contractEnv();
    const { postId } = await customerPost(env, env.a);
    await env.scoped(env.a, async (db) => {
      const [post] = await db
        .select({ boardId: posts.boardId })
        .from(posts)
        .where(eq(posts.id, postId));
      await db
        .update(boards)
        .set({
          access: {
            view: "anonymous",
            vote: "anonymous",
            submit: "anonymous",
            comment: "anonymous",
          } as never,
        })
        .where(eq(boards.id, post!.boardId));
    });
    expect(
      (
        await call("PUT", `/posts/${postId}/subscription`, {
          user: env.customerA,
          body: { level: "all" },
        })
      ).status,
    ).toBe(200);
    const statuses = await env.scoped(env.a, (db) =>
      db.select({ id: postStatuses.id }).from(postStatuses),
    );
    const move = (index: number) =>
      call("PUT", `/posts/${postId}/status`, {
        user: env.owner,
        teammate: true,
        body: { statusId: statuses[index]!.id },
      });
    // An unverified account address may be someone else's: no mail until the account verifies it.
    await settle();
    expect((await move(1)).status).toBe(200);
    await drain();
    await drain();
    expect(mail).toEqual([]);
    await verifyEmail(env, env.customerA);
    expect((await move(0)).status).toBe(200);
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[`${env.customerA}@example.test`]]);

    // A private portal that does not admit customer A: decided at send time, no mail.
    mail = [];
    await env.scoped(env.a, (db) =>
      db.update(settings).set({
        portalConfig: JSON.stringify({
          enabled: true,
          access: { visibility: "private" },
        }),
      }),
    );
    try {
      expect((await move(2)).status).toBe(200);
      await drain();
      await drain();
      expect(mail).toEqual([]);
    } finally {
      await enablePortal(env, env.a);
    }

    // A board whose view tier no longer admits customers: the post is hidden at send time.
    await env.scoped(env.a, async (db) => {
      const [post] = await db
        .select({ boardId: posts.boardId })
        .from(posts)
        .where(eq(posts.id, postId));
      await db
        .update(boards)
        .set({ access: { view: "team" } as never })
        .where(eq(boards.id, post!.boardId));
    });
    expect((await move(1)).status).toBe(200);
    await drain();
    await drain();
    expect(mail).toEqual([]);
  });

  it("mails a customer subscriber a public comment, never a private or held one", async () => {
    const env = contractEnv();
    await verifyEmail(env, env.customerA);
    const { postId } = await customerPost(env, env.a);
    expect(
      (
        await call("PUT", `/posts/${postId}/subscription`, {
          user: env.customerA,
          body: { level: "all" },
        })
      ).status,
    ).toBe(200);
    const comment = (body: object) =>
      call("POST", `/posts/${postId}/comments`, {
        user: env.owner,
        teammate: true,
        body,
      });
    await settle();
    expect(
      (await comment({ content: "PrivateMarker-team", isPrivate: true }))
        .status,
    ).toBe(200);
    await drain();
    await drain();
    expect(mail).toEqual([]);
    // A comment that waits for moderation is not public yet.
    const held = await comment({ content: "HeldMarker-later" });
    expect(held.status).toBe(200);
    await env.scoped(env.a, (db) =>
      db
        .update(postComments)
        .set({ moderationState: "pending" })
        .where(eq(postComments.id, held.body.id)),
    );
    await drain();
    await drain();
    expect(mail).toEqual([]);
    expect((await comment({ content: "PublicMarker-hello" })).status).toBe(200);
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[`${env.customerA}@example.test`]]);
    expect(readable(mail[0]!.data)).toContain("PublicMarker-hello");
  });

  it("mails the requester of an email-paired ticket a teammate reply and tells a portal requester over the socket", async () => {
    const env = contractEnv();
    const visitor = await plainCustomer(env, env.a);
    const thread = await conversationOf(
      env,
      env.a,
      visitor.principalId,
      "email",
    );
    const [{ address }] = (await env.scoped(env.a, (db) =>
      db
        .select({ address: conversations.visitorEmail })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    )) as [{ address: string }];
    const ticket = await ticketOf(
      env,
      env.a,
      visitor.principalId,
      thread.conversationId,
    );
    await settle();
    expect(
      (
        await call("POST", `/tickets/${ticket.ticketId}/reply`, {
          user: env.owner,
          teammate: true,
          body: { content: "TicketReplyMarker-one" },
        })
      ).status,
    ).toBe(200);
    await call("POST", `/tickets/${ticket.ticketId}/note`, {
      user: env.owner,
      teammate: true,
      body: { content: "TicketNoteMarker-secret" },
    });
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[address]]);
    expect(readable(mail[0]!.data)).toContain("TicketReplyMarker-one");
    for (const m of mail)
      expect(readable(m.data)).not.toContain("TicketNoteMarker-secret");
    // The pair reply ran the conversation reply path: claimed, read and no longer waiting.
    const [pairState] = await env.scoped(env.a, (db) =>
      db
        .select({
          assignee: conversations.assignedAgentPrincipalId,
          waitingSince: conversations.waitingSince,
          agentLastReadAt: conversations.agentLastReadAt,
          preview: conversations.lastMessagePreview,
        })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    );
    expect(pairState).toMatchObject({
      assignee: expect.any(String),
      waitingSince: null,
      agentLastReadAt: expect.any(Date),
      preview: expect.stringContaining("TicketReplyMarker-one"),
    });

    // A portal requester hears about the ticket on the user socket, with no text.
    const portal = await env.portalCustomer(env.a, env.customerA);
    const pair = await conversationOf(
      env,
      env.a,
      portal.principalId as PrincipalId,
    );
    const own = await ticketOf(
      env,
      env.a,
      portal.principalId as PrincipalId,
      pair.conversationId,
    );
    await settle();
    await call("POST", `/tickets/${own.ticketId}/reply`, {
      user: env.owner,
      teammate: true,
      body: { content: "Portal ticket answer" },
    });
    await drain();
    const customerCalls = broadcast.mock.calls.filter(
      ([, message]) => message.type === "QUILLS_CUSTOMER_CHANGED",
    );
    expect(customerCalls).toEqual([
      [
        env.customerA,
        expect.objectContaining({
          ticketId: own.ticketId,
          conversationId: pair.conversationId,
        }),
      ],
    ]);
    expect(JSON.stringify(customerCalls)).not.toContain("Portal ticket answer");
  });

  it("stops socket invalidations when the private portal no longer admits the customer", async () => {
    const env = contractEnv();
    const started = await call("POST", "/support/conversations", {
      user: env.customerA,
      body: { content: "Before the gate", idempotencyKey: key() },
    });
    expect(started.status).toBe(200);
    await settle();
    await env.scoped(env.a, (db) =>
      db.update(settings).set({
        portalConfig: JSON.stringify({
          enabled: true,
          access: { visibility: "private" },
        }),
      }),
    );
    try {
      // Customer A's address is verified, but no domain, segment or invite admits it.
      await call(
        "POST",
        `/conversations/${started.body.conversation.id}/reply`,
        { user: env.owner, teammate: true, body: { content: "Gated" } },
      );
      await drain();
      expect(
        broadcast.mock.calls.filter(
          ([, message]) => message.type === "QUILLS_CUSTOMER_CHANGED",
        ),
      ).toEqual([]);
    } finally {
      await enablePortal(env, env.a);
    }
  });

  it("fans a tracker's reply-all and status move out to each linked requester once", async () => {
    const env = contractEnv();
    const visitor = await plainCustomer(env, env.a);
    const thread = await conversationOf(
      env,
      env.a,
      visitor.principalId,
      "email",
    );
    const [{ address }] = (await env.scoped(env.a, (db) =>
      db
        .select({ address: conversations.visitorEmail })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    )) as [{ address: string }];
    const emailTicket = await ticketOf(
      env,
      env.a,
      visitor.principalId,
      thread.conversationId,
    );
    const portal = await env.portalCustomer(env.a, env.customerA);
    const pair = await conversationOf(
      env,
      env.a,
      portal.principalId as PrincipalId,
    );
    const portalTicket = await ticketOf(
      env,
      env.a,
      portal.principalId as PrincipalId,
      pair.conversationId,
    );
    const teammate = { user: env.owner, teammate: true };
    const tracker = await call("POST", "/tickets", {
      ...teammate,
      body: { type: "tracker", title: "Export outage" },
    });
    expect(tracker.status).toBe(200);
    const trackerId = tracker.body.id as string;
    for (const linked of [emailTicket, portalTicket])
      expect(
        (
          await call(
            "PUT",
            `/tickets/${linked.ticketId}/tracker/${trackerId}`,
            teammate,
          )
        ).status,
      ).toBe(200);
    await settle();

    // A tracker reply without reply-all stays on the tracker.
    await call("POST", `/tickets/${trackerId}/reply`, {
      ...teammate,
      body: { content: "Tracker-only note to the team" },
    });
    await drain();
    await drain();
    expect(mail).toEqual([]);
    expect(customerCalls()).toEqual([]);

    // The email requester's conversation is closed and unassigned: reply-all neither reopens nor claims it.
    await env.scoped(env.a, (db) =>
      db
        .update(conversations)
        .set({ status: "closed", assignedAgentPrincipalId: null })
        .where(eq(conversations.id, thread.conversationId)),
    );
    await call("POST", `/tickets/${trackerId}/reply`, {
      ...teammate,
      body: { content: "ReplyAllMarker-fixed", replyAll: true },
    });
    await drain();
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[address]]);
    expect(readable(mail[0]!.data)).toContain("ReplyAllMarker-fixed");
    const [kept] = await env.scoped(env.a, (db) =>
      db
        .select({
          status: conversations.status,
          assignee: conversations.assignedAgentPrincipalId,
        })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    );
    expect(kept).toEqual({ status: "closed", assignee: null });
    expect(customerCalls()).toEqual([
      [
        env.customerA,
        expect.objectContaining({
          ticketId: portalTicket.ticketId,
          conversationId: pair.conversationId,
        }),
      ],
    ]);
    // One event names the tracker; running its fan-out again queues nothing new.
    const replied = (await eventsOf(trackerId)).filter(
      (e) => e.type === "ticket.replied",
    );
    expect(replied).toHaveLength(2);
    for (const event of replied) await fanOut(env.a, event.eventId);
    await drain();
    await drain();
    expect(mail).toHaveLength(1);

    // The status cascade tells the linked portal requester.
    await settle();
    const [current] = await env.scoped(env.a, (db) =>
      db
        .select({ statusId: tickets.statusId })
        .from(tickets)
        .where(eq(tickets.id, trackerId as never)),
    );
    const [category] = await env.scoped(env.a, (db) =>
      db
        .select({ category: ticketStatuses.category })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.id, current!.statusId)),
    );
    const [target] = await env.scoped(env.a, (db) =>
      db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(
          and(
            ne(ticketStatuses.category, category!.category),
            ne(ticketStatuses.category, "closed"),
            isNull(ticketStatuses.deletedAt),
          ),
        )
        .limit(1),
    );
    expect(
      (
        await call("POST", `/tickets/${trackerId}/status`, {
          ...teammate,
          body: { statusId: target!.id },
        })
      ).status,
    ).toBe(200);
    await drain();
    expect(customerCalls()).toEqual([
      [
        env.customerA,
        expect.objectContaining({ ticketId: portalTicket.ticketId }),
      ],
    ]);
    expect(mail).toEqual([]);
  });

  it("threads a reply mail and routes the customer's answer back through its signed Reply-To", async () => {
    const env = contractEnv();
    const from = `ada-${randomUUID()}@customer.test`;
    const first = `<${randomUUID()}@customer.test>`;
    const opened = await inbound(
      `${env.a}@in.example.test`,
      `Ada <${from}>`,
      first,
      "My invoice is wrong",
    );
    expect(opened.body.status).toBe("received");
    const [{ conversationId }] = (await env.scoped(env.a, (db) =>
      db
        .select({ conversationId: conversationMessages.conversationId })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, opened.body.messageId)),
    )) as [{ conversationId: string }];
    await settle();
    const reply = await call("POST", `/conversations/${conversationId}/reply`, {
      user: env.owner,
      teammate: true,
      body: { content: "ThreadMarker-reply" },
    });
    expect(reply.status).toBe(200);
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[from]]);
    const data = mail[0]!.data;
    expect(headerOf(data, "In-Reply-To")).toBe(first);
    expect(headerOf(data, "References")).toBe(first);
    expect(headerOf(data, "Message-ID")).toBe(
      `<${reply.body.message.id}@in.example.test>`,
    );
    const replyTo = headerOf(data, "Reply-To")!;
    expect(replyTo).toMatch(
      new RegExp(`^${env.a}\\+c[0-9a-z]{38}@in\\.example\\.test$`),
    );

    // The customer's answer to the Reply-To address, without threading headers, joins the thread.
    const answer = await inbound(
      replyTo,
      from,
      `<${randomUUID()}@customer.test>`,
      "Thanks, now it is right",
    );
    expect(answer.body.status).toBe("received");
    const thread = await env.scoped(env.a, (db) =>
      db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          eq(conversationMessages.conversationId, conversationId as never),
        ),
    );
    expect(thread.map((m) => m.id)).toContain(answer.body.messageId);
    // An answer that quotes only our Message-ID joins it too.
    const quoted = await inbound(
      `${env.a}@in.example.test`,
      from,
      `<${randomUUID()}@customer.test>`,
      "One more thing",
      { "in-reply-to": `<${reply.body.message.id}@in.example.test>` },
    );
    const [joined] = await env.scoped(env.a, (db) =>
      db
        .select({ conversationId: conversationMessages.conversationId })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, quoted.body.messageId)),
    );
    expect(joined!.conversationId).toBe(conversationId);
    // A forged tag opens a new conversation instead of joining this one.
    const at = replyTo.indexOf("@");
    const forged = await inbound(
      `${replyTo.slice(0, at - 1)}${replyTo[at - 1] === "0" ? "1" : "0"}${replyTo.slice(at)}`,
      from,
      `<${randomUUID()}@customer.test>`,
      "Forged",
    );
    const [elsewhere] = await env.scoped(env.a, (db) =>
      db
        .select({ conversationId: conversationMessages.conversationId })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, forged.body.messageId)),
    );
    expect(elsewhere!.conversationId).not.toBe(conversationId);
  });

  it("asks an email customer for a CSAT rating once when the conversation closes", async () => {
    const env = contractEnv();
    const visitor = await plainCustomer(env, env.a);
    const thread = await conversationOf(
      env,
      env.a,
      visitor.principalId,
      "email",
    );
    const [{ address }] = (await env.scoped(env.a, (db) =>
      db
        .select({ address: conversations.visitorEmail })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    )) as [{ address: string }];
    const teammate = { user: env.owner, teammate: true };
    const status = (value: string) =>
      call("POST", `/conversations/${thread.conversationId}/status`, {
        ...teammate,
        body: { status: value },
      });
    await settle();
    expect((await status("closed")).status).toBe(200);
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[address]]);
    const body = readable(mail[0]!.data).replace(/=3D/gi, "=");
    // The links open the portal's rating page, which checks the token and POSTs the rating.
    const token = new RegExp(
      `/portal/${env.a}/csat\\?token=([A-Za-z0-9_-]+)(?:&amp;|&)rating=1`,
    ).exec(body)?.[1];
    expect(token).toBeTruthy();
    for (const rating of [2, 3, 4, 5])
      expect(body).toMatch(
        new RegExp(`token=${token}(?:&amp;|&)rating=${rating}`),
      );
    expect(
      (await call("GET", `/support/csat-email?token=${token}`)).body,
    ).toEqual({ valid: true });
    const [logged] = await env.scoped(env.a, (db) =>
      db
        .select({ conversationId: emailLog.conversationId })
        .from(emailLog)
        .where(eq(emailLog.emailType, "CsatRequestEmail"))
        .orderBy(desc(emailLog.createdAt))
        .limit(1),
    );
    expect(logged!.conversationId).toBe(thread.conversationId);

    // Reopened and closed again: no second request for the same conversation.
    mail = [];
    expect((await status("open")).status).toBe(200);
    expect((await status("closed")).status).toBe(200);
    await drain();
    await drain();
    expect(mail).toEqual([]);

    // A messenger conversation is rated in the widget, not by mail.
    const plain = await conversationOf(env, env.a, visitor.principalId);
    await settle();
    await call("POST", `/conversations/${plain.conversationId}/status`, {
      ...teammate,
      body: { status: "closed" },
    });
    await drain();
    await drain();
    expect(mail).toEqual([]);

    // An email conversation ended as spam, or already rated, is not asked.
    const spam = await conversationOf(env, env.a, visitor.principalId, "email");
    const rated = await conversationOf(
      env,
      env.a,
      visitor.principalId,
      "email",
    );
    await env.scoped(env.a, (db) =>
      db
        .update(conversations)
        .set({ csatRating: 4 })
        .where(eq(conversations.id, rated.conversationId)),
    );
    await settle();
    expect(
      (
        await call("POST", `/conversations/${spam.conversationId}/end`, {
          ...teammate,
          body: { reason: "spam" },
        })
      ).status,
    ).toBe(200);
    await call("POST", `/conversations/${rated.conversationId}/status`, {
      ...teammate,
      body: { status: "closed" },
    });
    await drain();
    await drain();
    expect(mail).toEqual([]);
  });

  it("mails status subscribers what they may see, once, and honors the page switch, audience and component gates", async () => {
    const env = contractEnv();
    await openPublic(env);
    await verifyEmail(env, env.customerA);
    await verifyEmail(env, env.customerB);
    const content = await statusContentIn(env, env.a);
    expect(
      (
        await call("PUT", "/status/subscription", {
          user: env.customerA,
          body: { scope: "page" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("PUT", "/status/subscription", {
          user: env.customerB,
          body: { scope: "components", componentIds: [content.componentId] },
        })
      ).status,
    ).toBe(200);
    const teammate = { user: env.owner, teammate: true };
    const publish = (title: string, componentId: string) =>
      call("POST", "/status/incidents", {
        ...teammate,
        body: {
          kind: "incident",
          title,
          status: "investigating",
          affectedComponents: [
            { componentId, componentStatus: "major_outage" },
          ],
          body: `${title} details`,
        },
      });
    await settle();
    // Only on a component behind a segment neither customer is in: nobody may see it.
    expect(
      (await publish("GatedMarker", content.gatedComponentId)).status,
    ).toBe(200);
    await drain();
    await drain();
    expect(mail).toEqual([]);

    const shown = await publish("OutageMarker", content.componentId);
    expect(shown.status).toBe(200);
    await drain();
    await drain();
    await drain();
    expect(mail.map((m) => m.to).sort()).toEqual(
      [[accountEmail(env.customerA)], [accountEmail(env.customerB)]].sort(),
    );
    for (const m of mail) {
      expect(readable(m.data)).toContain("OutageMarker");
      expect(readable(m.data)).not.toContain(
        `${content.label} gated component`,
      );
    }
    // The unsubscribe link carries the one token format; the status route spends it.
    const token = /unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(
      readable(mail[0]!.data),
    )?.[1];
    expect(token).toBeTruthy();
    expect(
      (await call("POST", "/status/unsubscribe", { body: { token } })).body,
    ).toEqual({ changed: true });

    // An update reaches the remaining subscriber once.
    const remaining = mail.find((m) => !readable(m.data).includes(token!))!.to;
    mail = [];
    const updated = await call(
      "POST",
      `/status/incidents/${shown.body.id}/updates`,
      { ...teammate, body: { status: "identified", body: "UpdateMarker" } },
    );
    expect(updated.status).toBe(200);
    await drain();
    await drain();
    expect(mail.map((m) => m.to)).toEqual([remaining]);
    expect(readable(mail[0]!.data)).toContain("UpdateMarker");

    // Closed page, or an audience that no longer admits them: decided at send time, no mail.
    const update = () =>
      call("POST", `/status/incidents/${shown.body.id}/updates`, {
        ...teammate,
        body: { status: "monitoring", body: "Hidden update" },
      });
    for (const statusSettings of [
      { enabled: false },
      { enabled: true, audience: "segments", allowedSegmentIds: [] },
    ]) {
      await env.scoped(env.a, async (db) => {
        const [row] = await db
          .select({ metadata: settings.metadata })
          .from(settings);
        await db.update(settings).set({
          metadata: JSON.stringify({
            ...JSON.parse(row!.metadata || "{}"),
            statusSettings,
          }),
        });
      });
      mail = [];
      expect((await update()).status).toBe(200);
      await drain();
      await drain();
      expect(mail).toEqual([]);
    }
    await openPublic(env);
  });

  it("shows customers only the customer intake types and fields, and refuses a back-office type", async () => {
    const env = contractEnv();
    const a = await env.widgetVisitor(env.a);
    const types = await ticketTypesIn(env, env.a);
    const form = await call("GET", "/widget/ticket-form", { bearer: a.token });
    expect(form.status).toBe(200);
    const text = JSON.stringify(form.body);
    expect(text).not.toContain(types.hiddenLabel);
    expect(text).not.toContain(types.backOfficeName);
    const intake = form.body.types.find(
      (type: { id: string }) => type.id === types.intakeTypeId,
    );
    expect(intake.fields.map((f: { key: string }) => f.key)).toEqual([
      "browser",
    ]);
    // The hidden required field is the team's to fill: a customer files without it.
    expect(
      (
        await call("POST", "/widget/tickets", {
          bearer: a.token,
          body: { title: "Typed", ticketTypeId: types.intakeTypeId },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", "/widget/tickets", {
          bearer: a.token,
          body: { title: "Back office", ticketTypeId: types.backOfficeTypeId },
        })
      ).status,
    ).toBe(404);
  });

  it("passes typing markers both ways and lets them lapse", async () => {
    const env = contractEnv();
    const a = await env.widgetVisitor(env.a);
    const started = await call("POST", "/widget/conversations", {
      bearer: a.token,
      body: { content: "Typing test", idempotencyKey: key() },
    });
    const id = started.body.conversation.id as string;
    const teamTyping = async () =>
      (await call("GET", `/widget/conversations/${id}`, { bearer: a.token }))
        .body.teamTyping;
    const visitorTyping = async () =>
      (
        await call("GET", `/conversations/${id}/typing`, {
          user: env.owner,
          teammate: true,
        })
      ).body.visitorTyping;
    expect(await teamTyping()).toBe(false);
    expect(await visitorTyping()).toBe(false);
    await call("POST", `/widget/conversations/${id}/typing`, {
      bearer: a.token,
    });
    await call("PUT", `/conversations/${id}/typing`, {
      user: env.owner,
      teammate: true,
    });
    expect(await teamTyping()).toBe(true);
    expect(await visitorTyping()).toBe(true);
    // A marker past its time reads as not typing.
    await env.scoped(env.a, (db) =>
      db
        .update(kvStore)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(like(kvStore.key, `support:typing:${id}:%`)),
    );
    expect(await teamTyping()).toBe(false);
    expect(await visitorTyping()).toBe(false);
  });

  it("checks a CSAT email link without spending it, records once and never across workspaces", async () => {
    const env = contractEnv();
    const visitor = await plainCustomer(env, env.a);
    const thread = await conversationOf(env, env.a, visitor.principalId);
    const token = await env.scoped(env.a, (db) =>
      mintCsatToken(db, thread.conversationId, visitor.principalId),
    );
    const check = (workspace?: string) =>
      call("GET", `/support/csat-email?token=${token}`, { workspace });
    expect((await check()).body).toEqual({ valid: true });
    expect((await check()).body).toEqual({ valid: true });
    expect((await check(env.b)).body).toEqual({ valid: false });
    const foreign = await call("POST", "/support/csat-email", {
      workspace: env.b,
      body: { token, rating: 1 },
    });
    expect(foreign.body).toMatchObject({ recorded: false });
    const rated = await call("POST", "/support/csat-email", {
      body: { token, rating: 5, comment: "Great" },
    });
    expect(rated.body).toEqual({
      recorded: true,
      conversationId: thread.conversationId,
      rating: 5,
      changed: true,
    });
    const reused = await call("POST", "/support/csat-email", {
      body: { token, rating: 1 },
    });
    expect(reused.body).toMatchObject({ recorded: false });
    expect((await check()).body).toEqual({ valid: false });
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({
          rating: conversations.csatRating,
          comment: conversations.csatComment,
        })
        .from(conversations)
        .where(eq(conversations.id, thread.conversationId)),
    );
    expect(row).toEqual({ rating: 5, comment: "Great" });

    // The link works while the portal is off: an email-only workspace may never turn it on.
    const second = await env.scoped(env.a, (db) =>
      mintCsatToken(db, thread.conversationId, visitor.principalId),
    );
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ portalConfig: JSON.stringify({ enabled: false }) }),
    );
    try {
      expect(
        (await call("GET", `/support/csat-email?token=${second}`)).body,
      ).toEqual({ valid: true });
    } finally {
      await enablePortal(env, env.a);
    }
  });

  it("mails status subscribers by scope, hides gated components, mails a maintenance start and honors the notify switch", async () => {
    const env = contractEnv();
    await openPublic(env);
    await verifyEmail(env, env.customerA);
    await verifyEmail(env, env.customerB);
    const content = await statusContentIn(env, env.a);
    const [extra] = await env.scoped(env.a, (db) =>
      db
        .insert(statusComponents)
        .values({ name: `${content.label} extra component` })
        .returning({ id: statusComponents.id }),
    );
    for (const [user, body] of [
      [env.customerA, { scope: "page" }],
      [env.customerB, { scope: "components", componentIds: [extra!.id] }],
    ] as const)
      expect(
        (await call("PUT", "/status/subscription", { user, body })).status,
      ).toBe(200);
    const teammate = { user: env.owner, teammate: true };
    const publish = (body: Record<string, unknown>) =>
      call("POST", "/status/incidents", { ...teammate, body });
    const incident = (
      title: string,
      componentIds: string[],
      more: Record<string, unknown> = {},
    ) =>
      publish({
        kind: "incident",
        title,
        status: "investigating",
        affectedComponents: componentIds.map((componentId) => ({
          componentId,
          componentStatus: "major_outage",
        })),
        body: `${title} details`,
        ...more,
      });
    const sent = async () => {
      await drain();
      await drain();
      const out = mail.map((m) => ({ to: m.to[0], text: readable(m.data) }));
      mail = [];
      return out;
    };
    await settle();

    // A public and a gated component: the page subscriber hears, without the gated one's name;
    // the components subscriber picked neither.
    expect(
      (
        await incident("MixedMarker", [
          content.componentId,
          content.gatedComponentId,
        ])
      ).status,
    ).toBe(200);
    const mixed = await sent();
    expect(mixed.map((m) => m.to)).toEqual([accountEmail(env.customerA)]);
    expect(mixed[0]!.text).toContain(`${content.label} public component`);
    expect(mixed[0]!.text).not.toContain(`${content.label} gated component`);

    // Its own component reaches the components subscriber too.
    await incident("ExtraMarker", [extra!.id]);
    expect((await sent()).map((m) => m.to).sort()).toEqual(
      [accountEmail(env.customerA), accountEmail(env.customerB)].sort(),
    );

    // notifySubscribers false sends nothing.
    await incident("QuietMarker", [extra!.id], { notifySubscribers: false });
    expect(await sent()).toEqual([]);

    // A scheduled window mails when it starts, not when it is published.
    const start = new Date(Date.now() + 3600_000).toISOString();
    const window = await publish({
      kind: "maintenance",
      title: "WindowMarker",
      status: "scheduled",
      affectedComponents: [
        {
          componentId: content.componentId,
          componentStatus: "under_maintenance",
        },
      ],
      body: "Window details",
      scheduledStartAt: start,
      scheduledEndAt: new Date(Date.now() + 7200_000).toISOString(),
    });
    expect(window.status).toBe(200);
    expect(await sent()).toEqual([]);
    expect(
      (
        await call(
          "POST",
          `/status/incidents/${window.body.id}/start`,
          teammate,
        )
      ).status,
    ).toBe(200);
    const started = await sent();
    expect(started.map((m) => m.to)).toEqual([accountEmail(env.customerA)]);
    expect(started[0]!.text).toContain("WindowMarker");
    expect(mail).toEqual([]);
  });

  it("moves an anonymous widget session's conversations and votes to the identified visitor, only for its own session", async () => {
    const env = contractEnv();
    const anon = await anonymousVisitor(env, env.a);
    const other = await anonymousVisitor(env, env.a);
    const foreign = await anonymousVisitor(env, env.b);
    const thread = await conversationOf(
      env,
      env.a,
      anon.principalId as PrincipalId,
    );
    const { postId } = await customerPost(env, env.a);
    await env.scoped(env.a, (db) =>
      db.insert(postVotes).values({ postId, principalId: anon.principalId }),
    );
    const label = env.id("merge").toLowerCase();
    const claims = {
      sub: label,
      email: `${label}@example.test`,
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    const identify = (bearer: string, previousToken: string) =>
      call("POST", "/widget/identify", {
        bearer,
        body: { ssoToken: signIdentity(claims, anon.secret), previousToken },
      });
    // Another session's token in the body, or workspace B's session as the Bearer: nothing moves.
    const first = await identify(anon.token, other.token);
    expect(first.body.mergedPrincipalId).toBeNull();
    expect(
      (await identify(foreign.token, foreign.token)).body.mergedPrincipalId,
    ).toBeNull();
    // The identified person voted on the same post: two vote rows, a count of 2.
    await env.scoped(env.a, async (db) => {
      await db
        .insert(postVotes)
        .values({ postId, principalId: first.body.principalId });
      await db.update(posts).set({ voteCount: 2 }).where(eq(posts.id, postId));
    });
    const owner = async () =>
      (
        await env.scoped(env.a, (db) =>
          db
            .select({ visitor: conversations.visitorPrincipalId })
            .from(conversations)
            .where(eq(conversations.id, thread.conversationId)),
        )
      )[0]!.visitor;
    expect(await owner()).toBe(anon.principalId);

    const merged = await identify(anon.token, anon.token);
    expect(merged.status).toBe(200);
    expect(merged.body.mergedPrincipalId).toBe(anon.principalId);
    expect(await owner()).toBe(merged.body.principalId);
    expect(merged.body.votedPostIds).toContain(postId);
    // The duplicate anonymous vote is dropped, and the count with it.
    const [counted] = await env.scoped(env.a, (db) =>
      db
        .select({ voteCount: posts.voteCount })
        .from(posts)
        .where(eq(posts.id, postId)),
    );
    expect(counted!.voteCount).toBe(1);
    const leftover = await env.scoped(env.a, (db) =>
      db
        .select({ id: postVotes.postId })
        .from(postVotes)
        .where(eq(postVotes.principalId, anon.principalId as never)),
    );
    expect(leftover).toEqual([]);
    // The anonymous session ended; identifying again moves nothing.
    expect(
      (await call("GET", "/widget/session", { bearer: anon.token })).status,
    ).toBe(401);
    expect(
      (await identify(anon.token, anon.token)).body.mergedPrincipalId,
    ).toBeNull();
    const lead = (await eventsOf(merged.body.principalId)).filter(
      (event) => event.type === "user.lead_merged",
    );
    expect(lead).toHaveLength(1);
  });

  it("changes an anonymous visitor's contact address only with the mailed codes", async () => {
    const env = contractEnv();
    const anon = await anonymousVisitor(env, env.a);
    const codeFor = async (purpose: "current" | "change") => {
      const [row] = await env.scoped(env.a, (db) =>
        db
          .select({ value: kvStore.value })
          .from(kvStore)
          .where(
            eq(kvStore.key, `contact-email:${purpose}:${anon.principalId}`),
          ),
      );
      const value = row!.value as { email: string; nonce: string };
      return contactEmailCode(anon.secret, {
        principalId: anon.principalId,
        purpose,
        email: value.email,
        nonce: value.nonce,
      });
    };
    const first = `first-${env.id("addr").toLowerCase()}@example.test`;
    await settle();
    const asked = await call("POST", "/widget/contact-email", {
      bearer: anon.token,
      body: { email: first },
    });
    expect(asked.body).toMatchObject({ ok: true, reason: null });
    expect(mail).toEqual([]);
    await drain();
    await drain();
    const code = await codeFor("change");
    expect(mail.map((m) => m.to)).toEqual([[first]]);
    expect(readable(mail[0]!.data)).toContain(code);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(
      (
        await call("POST", "/widget/contact-email/confirm", {
          bearer: anon.token,
          body: { email: first, code: wrong },
        })
      ).body,
    ).toMatchObject({ ok: false });
    expect(await contactEmailOf(env, anon.principalId)).toBeNull();
    expect(
      (
        await call("POST", "/widget/contact-email/confirm", {
          bearer: anon.token,
          body: { email: first, code },
        })
      ).body,
    ).toMatchObject({ ok: true, email: first });
    expect(await contactEmailOf(env, anon.principalId)).toBe(first);
    // Spent: the same code does not work twice.
    expect(
      (
        await call("POST", "/widget/contact-email/confirm", {
          bearer: anon.token,
          body: { email: first, code },
        })
      ).body.ok,
    ).toBe(false);

    // With an address set, the current address proves itself first.
    const second = `second-${env.id("addr").toLowerCase()}@example.test`;
    expect(
      (
        await call("POST", "/widget/contact-email", {
          bearer: anon.token,
          body: { email: second },
        })
      ).body,
    ).toMatchObject({ ok: false, reason: "current_code_required" });
    mail = [];
    await call("POST", "/widget/contact-email/current-code", {
      bearer: anon.token,
    });
    await drain();
    expect(mail.map((m) => m.to)).toEqual([[first]]);
    const current = await codeFor("current");
    expect(readable(mail[0]!.data)).toContain(current);
    expect(
      (
        await call("POST", "/widget/contact-email", {
          bearer: anon.token,
          body: { email: second, currentCode: current },
        })
      ).body,
    ).toMatchObject({ ok: true });
    // Five wrong tries end the request; the right code then fails too.
    const next = await codeFor("change");
    for (let i = 0; i < 5; i++)
      await call("POST", "/widget/contact-email/confirm", {
        bearer: anon.token,
        body: { email: second, code: next === "000000" ? "111111" : "000000" },
      });
    expect(
      (
        await call("POST", "/widget/contact-email/confirm", {
          bearer: anon.token,
          body: { email: second, code: next },
        })
      ).body.ok,
    ).toBe(false);
    expect(await contactEmailOf(env, anon.principalId)).toBe(first);

    // An identified visitor's address comes from the host's signed token.
    const identified = await env.widgetVisitor(env.a);
    expect(
      (
        await call("POST", "/widget/contact-email", {
          bearer: identified.token,
          body: { email: second },
        })
      ).status,
    ).toBe(403);
  });

  it("reads office hours in the workspace timezone, past midnight and on holidays", () => {
    const hours = {
      enabled: true,
      timezone: "America/New_York",
      intervals: [
        { day: 1, start: "09:00", end: "17:00" },
        { day: 5, start: "22:00", end: "02:00" },
      ],
      holidays: [{ date: "2026-12-25", recurringAnnual: true }],
    };
    // Monday 2026-11-09 10:00 in New York is 15:00 UTC.
    expect(withinOfficeHours(hours, new Date("2026-11-09T15:00:00Z"))).toBe(
      true,
    );
    expect(withinOfficeHours(hours, new Date("2026-11-09T23:00:00Z"))).toBe(
      false,
    );
    // Saturday 01:00 in New York belongs to Friday's overnight interval.
    expect(withinOfficeHours(hours, new Date("2026-11-14T06:00:00Z"))).toBe(
      true,
    );
    // A recurring holiday on a Monday in a later year.
    expect(withinOfficeHours(hours, new Date("2028-12-25T15:00:00Z"))).toBe(
      false,
    );
    expect(withinOfficeHours({ enabled: false }, new Date())).toBe(true);
    expect(
      withinOfficeHours(
        { enabled: true, timezone: "Nowhere/Zone" },
        new Date(),
      ),
    ).toBe(true);
  });
});
