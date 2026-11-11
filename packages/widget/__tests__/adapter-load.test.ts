import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError, createApi } from "../src/adapter/api";
import {
  loadConversations,
  loadPost,
  loadSnapshot,
  syncConversations,
} from "../src/adapter/load";

type Reply = { status?: number; body?: unknown } | (() => never);

/** A fetch stub at the edge: "METHOD /path?query" to a JSON reply, recording each call. */
function routes(table: Record<string, Reply>) {
  const calls: Array<{ key: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const key = `${init.method} ${url.replace("https://k.test/api/quills-public/acme", "")}`;
    calls.push({ key, init });
    const reply = table[key];
    if (!reply)
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
      });
    if (typeof reply === "function") return reply();
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
    });
  });
  const api = createApi(
    "https://k.test/api/quills-public/acme",
    fetchImpl as unknown as typeof fetch,
  );
  return { api, calls };
}
const post = (id: string, stage: string | null = "open") => ({
  id,
  title: id,
  content: "",
  board: { id: "b", name: "B", slug: "b" },
  status: null,
  stage,
  author: { name: "Al", avatarUrl: null },
  voteCount: 0,
  voted: false,
  following: false,
  createdAt: "2026-11-01T00:00:00.000Z",
});
const thread = (id: string, messages: string[]) => ({
  conversation: { id, subject: id, preview: null, unreadCount: 0 },
  messages: messages.map((m, i) => ({
    id: m,
    fromVisitor: true,
    author: null,
    content: m,
    createdAt: `2026-11-01T00:0${i}:00.000Z`,
  })),
});
const allOn = { feedback: true, changelog: true, help: true, messenger: true };

describe("widget API client", () => {
  it("sends the session as a Bearer token, JSON bodies and never cookies", async () => {
    const { api, calls } = routes({
      "PUT /widget/posts/p1/vote": { body: {} },
    });
    api.setToken("tok");
    await api.request("PUT", "/widget/posts/p1/vote", { voted: true });
    expect(calls[0]!.init).toMatchObject({
      method: "PUT",
      credentials: "omit",
      headers: {
        authorization: "Bearer tok",
        "content-type": "application/json",
      },
      body: '{"voted":true}',
    });
  });

  it("turns API errors into ApiError with status and message, and transport failures into status 0", async () => {
    const { api } = routes({
      "POST /widget/posts": {
        status: 429,
        body: { message: "Too many attempts, try again later" },
      },
      "GET /widget/unread": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(
      api.request("POST", "/widget/posts", {}),
    ).rejects.toMatchObject({
      status: 429,
      message: "Too many attempts, try again later",
    });
    const offline = await api.request("GET", "/widget/unread").catch((e) => e);
    expect(offline).toBeInstanceOf(ApiError);
    expect(offline.status).toBe(0);
  });

  it("returns the session tokens without keeping them until the host sets one", async () => {
    const { api, calls } = routes({
      "POST /widget/anonymous-session": {
        body: { sessionToken: "anon", principalId: "p" },
      },
      "POST /widget/identify": {
        body: {
          sessionToken: "known",
          user: { id: "u", name: "Ada", email: null, avatarUrl: null },
        },
      },
    });
    expect(await api.mintAnonymous()).toBe("anon");
    expect(api.hasSession()).toBe(false);
    expect(await api.identify("signed.jwt.token")).toMatchObject({
      token: "known",
      user: { name: "Ada" },
    });
    expect(calls[1]!.init.body).toBe('{"ssoToken":"signed.jwt.token"}');
  });
});

describe("snapshot loading", () => {
  it("loads each enabled surface, leaves out closed posts and orders threads oldest first", async () => {
    const { api, calls } = routes({
      "GET /widget/posts?limit=50": {
        body: { items: [post("p1"), post("p2", null)] },
      },
      "GET /widget/changelog?limit=50": { body: { entries: [] } },
      "GET /widget/help/articles?limit=100&locale=de": {
        body: { articles: [] },
      },
      "GET /widget/conversations?limit=20": {
        body: { items: [{ id: "c2" }, { id: "c1" }] },
      },
      "GET /widget/conversations/c2": { body: thread("c2", ["m2"]) },
      "GET /widget/conversations/c1": { body: thread("c1", ["m1"]) },
    });
    const snapshot = await loadSnapshot(api, { surfaces: allOn, locale: "de" });
    expect(snapshot.feedback.map((item) => item.id)).toEqual(["p1"]);
    expect(snapshot.conversations.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(calls).toHaveLength(6);
  });

  it("hides a surface that a private portal denies (403) and keeps the rest", async () => {
    const { api } = routes({
      "GET /widget/posts?limit=50": {
        status: 403,
        body: { message: "Portal access required" },
      },
      "GET /widget/conversations?limit=20": { body: { items: [{ id: "c1" }] } },
      "GET /widget/conversations/c1": { body: thread("c1", ["m1"]) },
    });
    const snapshot = await loadSnapshot(api, {
      surfaces: { ...allOn, changelog: false, help: false },
    });
    expect(snapshot.feedback).toEqual([]);
    expect(snapshot.conversations.map((item) => item.id)).toEqual(["c1"]);
    expect(snapshot.available).toEqual({
      feedback: false,
      changelog: false,
      help: false,
      messenger: true,
    });
  });

  it("skips a tab that is off and treats a module's 404 as an empty surface", async () => {
    const { api, calls } = routes({
      "GET /widget/posts?limit=50&boardId=board_1": { body: { items: [] } },
      // help: no route answers, so the stub's 404 stands for a disabled help-center module
    });
    const snapshot = await loadSnapshot(api, {
      surfaces: {
        feedback: true,
        changelog: false,
        help: true,
        messenger: false,
      },
      boardId: "board_1",
    });
    expect(snapshot.articles).toEqual([]);
    expect(snapshot.available).toMatchObject({ feedback: true, help: false });
    expect(calls.map((call) => call.key)).toEqual([
      "GET /widget/posts?limit=50&boardId=board_1",
      "GET /widget/help/articles?limit=100",
    ]);
  });

  it("fails the load on any other error instead of showing a false empty state", async () => {
    const { api } = routes({
      "GET /widget/posts?limit=50": {
        status: 401,
        body: { message: "Valid widget session required" },
      },
    });
    await expect(
      loadSnapshot(api, {
        surfaces: { ...allOn, changelog: false, help: false, messenger: false },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("reads a post with its discussion when it opens", async () => {
    const { api } = routes({
      "GET /widget/posts/p1": { body: post("p1") },
      "GET /widget/posts/p1/comments?limit=100": {
        body: {
          items: [
            {
              id: "c1",
              parentId: null,
              content: "Hi",
              author: null,
              deleted: false,
              createdAt: "2026-11-01T00:00:00.000Z",
              reactions: [],
            },
          ],
        },
      },
    });
    expect((await loadPost(api, "p1"))?.comments).toEqual([
      expect.objectContaining({ id: "c1", body: "Hi", votes: 0 }),
    ]);
  });
});

describe("conversation polling", () => {
  it("reads only messages after the newest one for a changed thread, and a new thread in full", async () => {
    const { api, calls } = routes({
      "GET /widget/conversations?limit=20": {
        body: {
          items: [
            {
              id: "c3",
              subject: "New",
              preview: null,
              unreadCount: 1,
              lastMessageAt: "2026-11-01T00:09:00.000Z",
            },
            {
              id: "c1",
              subject: "Old",
              preview: null,
              unreadCount: 1,
              lastMessageAt: "2026-11-01T00:05:00.000Z",
            },
            {
              id: "c2",
              subject: "Same",
              preview: null,
              unreadCount: 0,
              lastMessageAt: "2026-11-01T00:00:00.000Z",
            },
          ],
        },
      },
      "GET /widget/conversations/c3": { body: thread("c3", ["n1"]) },
      "GET /widget/conversations/c1/messages?after=m1&limit=100": {
        body: {
          items: [
            {
              id: "m1",
              fromVisitor: true,
              author: null,
              content: "m1",
              createdAt: "2026-11-01T00:00:00.000Z",
            },
            {
              id: "m9",
              fromVisitor: false,
              author: { name: "Ana", avatarUrl: null },
              content: "reply",
              createdAt: "2026-11-01T00:05:00.000Z",
            },
          ],
        },
      },
    });
    const current = await loadConversations(
      routes({
        "GET /widget/conversations?limit=20": {
          body: { items: [{ id: "c2" }, { id: "c1" }] },
        },
        "GET /widget/conversations/c1": { body: thread("c1", ["m1"]) },
        "GET /widget/conversations/c2": { body: thread("c2", ["k1"]) },
      }).api,
    );
    const next = await syncConversations(api, current);
    expect(
      next.map((item) => [item.id, item.messages.map((m) => m.id)]),
    ).toEqual([
      ["c2", ["k1"]],
      ["c1", ["m1", "m9"]],
      ["c3", ["n1"]],
    ]);
    expect(next.find((item) => item.id === "c1")?.unreadCount).toBe(1);
    expect(calls.map((call) => call.key)).toEqual([
      "GET /widget/conversations?limit=20",
      "GET /widget/conversations/c3",
      "GET /widget/conversations/c1/messages?after=m1&limit=100",
    ]);
  });

  it("still reads a thread whose newest local message is the visitor's, when a team reply is unread", async () => {
    // The visitor read the thread (unread 0 here), a reply came, then the visitor sent m2.
    const { api, calls } = routes({
      "GET /widget/conversations?limit=20": {
        body: {
          items: [
            {
              id: "c1",
              subject: "Old",
              preview: null,
              unreadCount: 1,
              lastMessageAt: "2026-11-01T00:01:00.000Z",
            },
          ],
        },
      },
      "GET /widget/conversations/c1/messages?after=m2&limit=100": {
        body: {
          items: [
            {
              id: "r1",
              fromVisitor: false,
              author: { name: "Ana", avatarUrl: null },
              content: "reply",
              createdAt: "2026-11-01T00:00:30.000Z",
            },
          ],
        },
      },
    });
    const [current] = await loadConversations(
      routes({
        "GET /widget/conversations?limit=20": {
          body: { items: [{ id: "c1" }] },
        },
        "GET /widget/conversations/c1": { body: thread("c1", ["m1", "m2"]) },
      }).api,
    );
    const [next] = await syncConversations(api, [
      { ...current!, unreadCount: 0 },
    ]);
    expect(next!.messages.map((m) => m.id)).toEqual(["m1", "r1", "m2"]);
    expect(calls).toHaveLength(2);
  });
});
