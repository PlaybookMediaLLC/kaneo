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
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PrincipalId } from "@kaneo/ids";
import { settings } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { events } from "../../../database/quills/schema/events";
import { kvStore } from "../../../database/quills/schema/kv";
import { inAppNotifications } from "../../../database/quills/schema/notifications";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import * as kaneo from "../../../database/schema";
import { broadcastToUserAndWait } from "../../../ws";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import quillsRouter from "../../index";
import { drainQuillsWorkspace } from "../../jobs/worker";
import {
  customerPost,
  enablePortal,
  verifyEmail,
} from "../../portal/customer-seed.fixture";
import publicRouter from "../../public";
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
