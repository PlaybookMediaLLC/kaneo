import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AuthService } from "../auth/auth-service.js";
import { KaneoClient } from "../kaneo/client.js";
import { registerTools } from "./register.js";

// The Quills tools against a mocked HTTP boundary: the real client, a stubbed fetch.

const API_KEY = "kaneo_test_secret_key_123";
type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function setup(reply: (request: Request) => Response) {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      return reply(request);
    }),
  );
  const auth = {
    usingApiKey: true,
    getAccessToken: async () => API_KEY,
    clearToken: async () => undefined,
  } as unknown as AuthService;
  const client = new KaneoClient({ baseUrl: "https://kaneo.test", auth });
  const tools = new Map<string, Handler>();
  registerTools(
    {
      registerTool: (name, _config, handler) =>
        tools.set(name, handler as Handler),
    },
    { client },
  );
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`No tool ${name}`);
    return tool(args);
  };
  return { requests, call, tools };
}
const ok = (body: unknown) => () => Response.json(body);

afterEach(() => vi.unstubAllGlobals());

describe("Quills MCP tools", () => {
  it("registers the Quills tools", () => {
    const { tools } = setup(ok({}));
    expect(
      [...tools.keys()].filter((name) => name.startsWith("quills_")),
    ).toEqual([
      "quills_list_boards",
      "quills_list_statuses",
      "quills_list_posts",
      "quills_get_post",
      "quills_create_post",
      "quills_add_proxy_vote",
      "quills_add_comment",
      "quills_set_post_status",
      "quills_list_feedback_signals",
      "quills_draft_changelog",
    ]);
  });

  it("calls the teammate REST routes with the caller's API key", async () => {
    const { requests, call } = setup(ok({ items: [] }));
    const ws = "ws_1";
    const cases: Array<
      [string, Record<string, unknown>, string, string, unknown?]
    > = [
      [
        "quills_list_boards",
        { workspaceId: ws },
        "GET",
        "/api/quills/ws_1/boards",
      ],
      [
        "quills_list_statuses",
        { workspaceId: ws, limit: 10 },
        "GET",
        "/api/quills/ws_1/statuses?limit=10",
      ],
      [
        "quills_list_posts",
        {
          workspaceId: ws,
          boardId: "board_1",
          statusId: "post_status_1",
          search: "dark mode",
          sort: "votes",
          limit: 5,
        },
        "GET",
        "/api/quills/ws_1/posts?boardIds=board_1&statusIds=post_status_1&search=dark+mode&sort=votes&limit=5",
      ],
      [
        "quills_get_post",
        { workspaceId: ws, postId: "post_1" },
        "GET",
        "/api/quills/ws_1/posts/post_1",
      ],
      [
        "quills_create_post",
        {
          workspaceId: ws,
          boardId: "board_1",
          title: "Dark mode",
          content: "Please",
        },
        "POST",
        "/api/quills/ws_1/posts",
        { boardId: "board_1", title: "Dark mode", content: "Please" },
      ],
      [
        "quills_add_proxy_vote",
        { workspaceId: ws, postId: "post_1", principalId: "principal_9" },
        "PUT",
        "/api/quills/ws_1/posts/post_1/voters/principal_9",
      ],
      [
        "quills_add_comment",
        {
          workspaceId: ws,
          postId: "post_1",
          content: "On the roadmap",
          isPrivate: false,
        },
        "POST",
        "/api/quills/ws_1/posts/post_1/comments",
        { content: "On the roadmap", isPrivate: false },
      ],
      [
        "quills_set_post_status",
        { workspaceId: ws, postId: "post_1", statusId: "post_status_2" },
        "PUT",
        "/api/quills/ws_1/posts/post_1/status",
        { statusId: "post_status_2" },
      ],
      [
        "quills_list_feedback_signals",
        {
          workspaceId: ws,
          status: "pending",
          source: "ticket",
          limit: 20,
          offset: 40,
        },
        "GET",
        "/api/quills/ws_1/feedback-signals?status=pending&source=ticket&limit=20&offset=40",
      ],
      [
        "quills_draft_changelog",
        { workspaceId: ws, postIds: ["post_1", "post_2"] },
        "POST",
        "/api/quills/ws_1/changelog/drafts",
        { postIds: ["post_1", "post_2"] },
      ],
    ];
    for (const [name, args, method, path, body] of cases) {
      const result = await call(name, args);
      expect([name, result.isError]).toEqual([name, false]);
      const request = requests.at(-1)!;
      const url = new URL(request.url);
      expect([name, request.method, `${url.pathname}${url.search}`]).toEqual([
        name,
        method,
        path,
      ]);
      expect(request.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
      if (body !== undefined) expect(await request.json()).toEqual(body);
    }
  });

  it("rejects unbounded or path-changing input before any request", async () => {
    const { requests, call } = setup(ok({}));
    const bad: Array<[string, Record<string, unknown>]> = [
      ["quills_get_post", { workspaceId: "ws_1", postId: "../boards" }],
      ["quills_get_post", { workspaceId: "ws/1", postId: "post_1" }],
      ["quills_list_posts", { workspaceId: "ws_1", limit: 1000 }],
      ["quills_list_posts", { workspaceId: "ws_1", search: "x".repeat(201) }],
      [
        "quills_create_post",
        { workspaceId: "ws_1", boardId: "board_1", title: "" },
      ],
      [
        "quills_add_comment",
        { workspaceId: "ws_1", postId: "post_1", content: "Hi" },
      ],
      [
        "quills_add_comment",
        {
          workspaceId: "ws_1",
          postId: "post_1",
          content: "x".repeat(5001),
          isPrivate: true,
        },
      ],
      [
        "quills_list_feedback_signals",
        { workspaceId: "ws_1", status: "merged" },
      ],
      ["quills_draft_changelog", { workspaceId: "ws_1", postIds: [] }],
      [
        "quills_draft_changelog",
        { workspaceId: "ws_1", postIds: ["post_1", "post_1"] },
      ],
      [
        "quills_draft_changelog",
        {
          workspaceId: "ws_1",
          postIds: Array.from({ length: 26 }, (_, i) => `post_${i}`),
        },
      ],
    ];
    for (const [name, args] of bad) {
      const result = await call(name, args);
      expect([name, result.isError]).toEqual([name, true]);
    }
    expect(requests).toHaveLength(0);
  });

  it("returns the API's denial as an error without the credential", async () => {
    const { call } = setup(() =>
      Response.json(
        { message: "Insufficient API key scope", code: "API_KEY_SCOPE" },
        { status: 403 },
      ),
    );
    const result = await call("quills_set_post_status", {
      workspaceId: "ws_1",
      postId: "post_1",
      statusId: "post_status_2",
    });
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(JSON.parse(text).error).toContain("Insufficient API key scope");
    expect(text).not.toContain(API_KEY);
  });
});
