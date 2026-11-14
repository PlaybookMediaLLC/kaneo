import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { BoardId, PostId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { principal } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { events } from "../../database/quills/schema/events";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { ticketStatuses, tickets } from "../../database/quills/schema/tickets";
import { apiRouter, type BaseVariables } from "../../openapi";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { buildQuillsRoute } from "../framework/define-route";
import { registry } from "../framework/registry";
import { postIn } from "./seeds.fixture";
import {
  call,
  linkedProject,
  removeMembers,
  restrictedMember,
  testCustomer,
} from "./taxonomy-harness.fixture";

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
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter);

type Source = "conversation" | "ticket" | "deleted-ticket";
/**
 * A signal in `workspaceId` from a closed conversation or a resolved ticket of a new customer
 * (or of `customerId`), with one customer message as its source.
 */
async function signalIn(
  env: ContractEnv,
  workspaceId: string,
  options: {
    source?: Source;
    customerId?: string;
    matchedPostId?: PostId;
    status?: "pending" | "dismissed";
  } = {},
) {
  return env.scoped(workspaceId, async (db) => {
    const customerId =
      options.customerId ??
      (
        await db
          .insert(principal)
          .values({
            type: "user",
            role: "user",
            displayName: "Ada Customer",
            createdAt: new Date(),
          })
          .returning({ id: principal.id })
      )[0]!.id;
    const source = options.source ?? "conversation";
    let parent: { conversationId: string } | { ticketId: string };
    if (source === "conversation") {
      const [row] = await db
        .insert(conversations)
        .values({
          visitorPrincipalId: customerId as never,
          channel: "messenger",
          status: "closed",
          subject: "Night use",
        })
        .returning({ id: conversations.id });
      parent = { conversationId: row!.id };
    } else {
      const [status] = await db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(eq(ticketStatuses.isDefault, true));
      const [row] = await db
        .insert(tickets)
        .values({
          title: "Export fails",
          statusId: status!.id,
          requesterPrincipalId: customerId as never,
          resolvedAt: new Date(),
          deletedAt: source === "deleted-ticket" ? new Date() : null,
        })
        .returning({ id: tickets.id });
      parent = { ticketId: row!.id };
    }
    const [message] = await db
      .insert(conversationMessages)
      .values({
        ...(parent as object),
        principalId: customerId as never,
        senderType: "visitor",
        content: "Please add a dark mode",
      })
      .returning({ id: conversationMessages.id });
    const [signal] = await db
      .insert(feedbackSignals)
      .values({
        ...(parent as object),
        sourceMessageId: message!.id,
        principalId: customerId as never,
        excerpt: "Please add a dark mode",
        suggestedTitle: "Dark mode",
        matchedPostId: options.matchedPostId ?? null,
        status: options.status ?? "pending",
        decidedAt: options.status === "dismissed" ? new Date() : null,
      })
      .returning({ id: feedbackSignals.id });
    return { signalId: signal!.id, customerId, ...parent };
  });
}

const signalRow = (id: string) =>
  contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .select({
        status: feedbackSignals.status,
        resultingPostId: feedbackSignals.resultingPostId,
        decidedAt: feedbackSignals.decidedAt,
      })
      .from(feedbackSignals)
      .where(eq(feedbackSignals.id, id as never));
    return row;
  });
const outbox = (ids: string[]) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db
      .select({ type: events.type, entityId: events.entityId })
      .from(events)
      .where(inArray(events.entityId, ids))
      .orderBy(asc(events.id)),
  );
const list = async (user: string, query = "") =>
  (
    await call(
      app,
      contractEnv(),
      user,
      "GET",
      `/feedback-signals?limit=100${query}`,
    )
  ).body as { items: { id: string; [key: string]: unknown }[] };
const ids = (body: { items: { id: string }[] }) =>
  body.items.map((item) => item.id);

describe.skipIf(!url)("Quills feedback signals", () => {
  let board: BoardId;
  let post: PostId;
  let member: string;
  let viewer: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    const env = await startContract(pool, url!);
    ({ boardId: board, postId: post } = await postIn(env, env.a));
    // The built-in member role holds quills read, create and update. This member opens no project.
    member = await restrictedMember(env, []);
    viewer = await restrictedMember(env, [], "viewer");
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  });

  it("lists only readable signals of the workspace, with the source, the customer and a visible match", async () => {
    const env = contractEnv();
    const hidden = await postIn(env, env.a);
    await linkedProject(env, hidden.boardId);
    const shown = await signalIn(env, env.a, { matchedPostId: post });
    const ticket = await signalIn(env, env.a, {
      source: "ticket",
      matchedPostId: hidden.postId,
    });
    const deleted = await signalIn(env, env.a, { source: "deleted-ticket" });
    const tester = await signalIn(env, env.a, {
      customerId: await testCustomer(env),
    });
    const foreign = await signalIn(env, env.b);

    const all = await list(env.owner);
    expect(ids(all)).toEqual(
      expect.arrayContaining([shown.signalId, ticket.signalId]),
    );
    for (const id of [deleted.signalId, tester.signalId, foreign.signalId])
      expect(ids(all)).not.toContain(id);
    expect(all.items.find((item) => item.id === shown.signalId)).toEqual({
      id: shown.signalId,
      status: "pending",
      source: {
        type: "conversation",
        id: shown.conversationId,
        title: "Night use",
        number: null,
      },
      customer: { principalId: shown.customerId, displayName: "Ada Customer" },
      excerpt: "Please add a dark mode",
      suggestedTitle: "Dark mode",
      matchedPost: {
        id: post,
        title: "Contract post",
        voteCount: 0,
        boardName: "Contract",
        statusName: null,
      },
      resultingPost: null,
      createdAt: expect.any(String),
      decidedAt: null,
    });
    expect(all.items.find((item) => item.id === ticket.signalId)).toMatchObject(
      {
        source: { type: "ticket", title: "Export fails" },
        matchedPost: { id: hidden.postId },
      },
    );

    const tickets = await list(env.owner, "&source=ticket");
    expect(ids(tickets)).toContain(ticket.signalId);
    expect(ids(tickets)).not.toContain(shown.signalId);
    expect(ids(await list(env.owner, "&status=dismissed"))).not.toContain(
      shown.signalId,
    );
    // A member who cannot open the linked project sees the signal without its match.
    const forMember = await list(member);
    expect(
      forMember.items.find((item) => item.id === ticket.signalId),
    ).toMatchObject({ matchedPost: null });
  });

  it("accepts a signal as a new post by the customer, with post.created and signal.accepted", async () => {
    const env = contractEnv();
    const signal = await signalIn(env, env.a, { matchedPostId: post });
    const res = await call(
      app,
      env,
      member,
      "POST",
      `/feedback-signals/${signal.signalId}/post`,
      { boardId: board, title: "  Dark mode  " },
    );
    expect(res).toEqual({
      status: 200,
      body: {
        id: signal.signalId,
        status: "accepted",
        resultingPostId: expect.any(String),
      },
    });
    const postId = res.body.resultingPostId as PostId;
    const [created] = await env.scoped(env.a, (db) =>
      db
        .select({
          title: posts.title,
          content: posts.content,
          principalId: posts.principalId,
          trackedBy: posts.trackedByPrincipalId,
          voteCount: posts.voteCount,
        })
        .from(posts)
        .where(eq(posts.id, postId)),
    );
    expect(created).toMatchObject({
      title: "Dark mode",
      content: "Please add a dark mode",
      principalId: signal.customerId,
      voteCount: 1,
    });
    expect(created!.trackedBy).not.toBeNull();
    expect(await signalRow(signal.signalId)).toMatchObject({
      status: "accepted",
      resultingPostId: postId,
    });
    expect(await outbox([signal.signalId, postId])).toEqual([
      { type: "post.created", entityId: postId },
      { type: "signal.accepted", entityId: signal.signalId },
    ]);
    const accepted = await list(env.owner, "&status=accepted");
    expect(
      accepted.items.find((item) => item.id === signal.signalId),
    ).toMatchObject({ resultingPost: { id: postId, title: "Dark mode" } });
  });

  it("accepts a signal as the customer's vote on the matched post, then refuses a second decision", async () => {
    const env = contractEnv();
    const target = await postIn(env, env.a);
    const signal = await signalIn(env, env.a, {
      matchedPostId: target.postId,
    });
    const path = `/feedback-signals/${signal.signalId}`;
    const res = await call(app, env, member, "POST", `${path}/vote`, {
      postId: target.postId,
    });
    expect(res).toEqual({
      status: 200,
      body: {
        id: signal.signalId,
        status: "accepted",
        resultingPostId: target.postId,
        voteAdded: true,
        voterPrincipalId: signal.customerId,
      },
    });
    const votes = await env.scoped(env.a, (db) =>
      db
        .select({
          principalId: postVotes.principalId,
          sourceType: postVotes.sourceType,
        })
        .from(postVotes)
        .where(eq(postVotes.postId, target.postId)),
    );
    expect(votes).toEqual([
      { principalId: signal.customerId, sourceType: "proxy" },
    ]);
    expect(await outbox([signal.signalId, target.postId])).toEqual([
      { type: "post.voted", entityId: target.postId },
      { type: "signal.accepted", entityId: signal.signalId },
    ]);

    for (const [suffix, body] of [
      ["vote", { postId: target.postId }],
      ["post", { boardId: board, title: "Again" }],
      ["dismiss", undefined],
      ["restore", undefined],
    ] as const)
      expect(
        (await call(app, env, member, "POST", `${path}/${suffix}`, body))
          .status,
      ).toBe(409);
    expect(
      await outbox([signal.signalId, target.postId]).then(
        (rows) => rows.length,
      ),
    ).toBe(2);
  });

  it("rolls back the post, the vote and the decision when the request fails after its writes", async () => {
    const env = contractEnv();
    const signal = await signalIn(env, env.a, { matchedPostId: post });
    const declared = [...registry.keys()].find(
      (d) => d.operationId === "acceptQuillsFeedbackSignalAsPost",
    )!;
    const failing = contractApp(
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({
          ...declared,
          handler: async (input) => {
            await declared.handler(input);
            throw new Error("Injected failure after the accept writes");
          },
        }),
      ),
    );
    const before = await env.scoped(env.a, (db) =>
      db.$count(posts, eq(posts.principalId, signal.customerId as never)),
    );
    const res = await call(
      failing,
      env,
      env.owner,
      "POST",
      `/feedback-signals/${signal.signalId}/post`,
      { boardId: board, title: "Dark mode" },
    );
    expect(res.status).toBe(500);
    expect(
      await env.scoped(env.a, (db) =>
        db.$count(posts, eq(posts.principalId, signal.customerId as never)),
      ),
    ).toBe(before);
    expect(await signalRow(signal.signalId)).toEqual({
      status: "pending",
      resultingPostId: null,
      decidedAt: null,
    });
    expect(await outbox([signal.signalId])).toEqual([]);
  });

  it("dismisses and restores a signal, with signal.dismissed and signal.restored", async () => {
    const env = contractEnv();
    const signal = await signalIn(env, env.a);
    const path = `/feedback-signals/${signal.signalId}`;
    expect(
      (await call(app, env, member, "POST", `${path}/restore`)).status,
    ).toBe(409);
    expect(await call(app, env, member, "POST", `${path}/dismiss`)).toEqual({
      status: 200,
      body: { id: signal.signalId, status: "dismissed", resultingPostId: null },
    });
    expect(await signalRow(signal.signalId)).toMatchObject({
      status: "dismissed",
      decidedAt: expect.any(Date),
    });
    expect(ids(await list(env.owner, "&status=dismissed"))).toContain(
      signal.signalId,
    );
    expect(
      (
        await call(app, env, member, "POST", `${path}/vote`, {
          postId: post,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(app, env, member, "POST", `${path}/dismiss`)).status,
    ).toBe(409);
    expect(await call(app, env, member, "POST", `${path}/restore`)).toEqual({
      status: 200,
      body: { id: signal.signalId, status: "pending", resultingPostId: null },
    });
    expect(await signalRow(signal.signalId)).toEqual({
      status: "pending",
      resultingPostId: null,
      decidedAt: null,
    });
    expect(await outbox([signal.signalId])).toEqual([
      { type: "signal.dismissed", entityId: signal.signalId },
      { type: "signal.restored", entityId: signal.signalId },
    ]);
  });

  it("answers 404 for another workspace's IDs and a hidden signal, and changes nothing", async () => {
    const env = contractEnv();
    const signal = await signalIn(env, env.a, { matchedPostId: post });
    const deleted = await signalIn(env, env.a, { source: "deleted-ticket" });
    const foreign = await signalIn(env, env.b);
    const other = await postIn(env, env.b);
    const send = (id: string, suffix: string, body?: unknown) =>
      call(
        app,
        env,
        env.owner,
        "POST",
        `/feedback-signals/${id}/${suffix}`,
        body,
      );
    for (const id of [foreign.signalId, deleted.signalId]) {
      expect(
        (await send(id, "post", { boardId: board, title: "X" })).status,
      ).toBe(404);
      expect((await send(id, "vote", { postId: post })).status).toBe(404);
      expect((await send(id, "dismiss")).status).toBe(404);
    }
    expect(
      (
        await send(signal.signalId, "post", {
          boardId: other.boardId,
          title: "X",
        })
      ).status,
    ).toBe(404);
    expect(
      (await send(signal.signalId, "vote", { postId: other.postId })).status,
    ).toBe(404);
    expect(await signalRow(signal.signalId)).toMatchObject({
      status: "pending",
    });
    expect(
      await env.scoped(env.b, (db) =>
        db.$count(
          feedbackSignals,
          and(
            eq(feedbackSignals.id, foreign.signalId as never),
            eq(feedbackSignals.status, "pending"),
          ),
        ),
      ),
    ).toBe(1);
    expect(await outbox([signal.signalId, deleted.signalId])).toEqual([]);
  });

  it("refuses a decision without the action, by role or by API-key scope", async () => {
    const env = contractEnv();
    const signal = await signalIn(env, env.a, { matchedPostId: post });
    const path = `/feedback-signals/${signal.signalId}`;
    expect(ids(await list(viewer))).toContain(signal.signalId);
    for (const [suffix, body] of [
      ["post", { boardId: board, title: "X" }],
      ["vote", { postId: post }],
      ["dismiss", undefined],
    ] as const)
      expect(
        (await call(app, env, viewer, "POST", `${path}/${suffix}`, body))
          .status,
      ).toBe(403);
    const res = await app.request(`/quills/${env.a}${path}/vote`, {
      method: "POST",
      headers: {
        "x-test-user": env.owner,
        "x-test-scope": JSON.stringify({
          workspace: ["read"],
          quills: ["read", "update"],
        }),
        "content-type": "application/json",
      },
      body: JSON.stringify({ postId: post }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "API_KEY_SCOPE" });
    expect(await signalRow(signal.signalId)).toMatchObject({
      status: "pending",
    });
  });
});
