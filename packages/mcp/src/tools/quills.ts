import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { run } from "../utils/mcp-result.js";
import type { ToolClient } from "./register.js";

// RFC 0003 D14: Quills feedback tools. Each tool calls the teammate REST API with the caller's
// own credential (a Kaneo API key or the device-flow token). The API checks the workspace, the
// Quills permission and the key's scope, so these tools add no server authority.

type RegisterTool = <S extends z.ZodObject>(
  name: string,
  config: { description: string; inputSchema: S },
  callback: (args: z.output<S>) => Promise<CallToolResult>,
) => unknown;

/** A Kaneo or Quills ID: no slash or dot, so it cannot leave its path segment. */
const id = (what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, `Expected a ${what} ID`)
    .describe(`${what} ID`);
const workspaceId = id("Workspace");
const page = {
  limit: z.number().int().min(1).max(100).optional().describe("At most 100"),
  offset: z.number().int().min(0).max(100_000).optional(),
};

const query = (values: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) qs.set(key, String(value));
  const text = qs.toString();
  return text ? `?${text}` : "";
};

export function registerQuillsTools(
  registerTool: RegisterTool,
  client: ToolClient,
): void {
  const quills = (ws: string, path: string) =>
    `/api/quills/${encodeURIComponent(ws)}${path}`;
  const post = (ws: string, postId: string, rest = "") =>
    quills(ws, `/posts/${encodeURIComponent(postId)}${rest}`);

  registerTool(
    "quills_list_boards",
    {
      description:
        "List the Quills feedback boards that you can see in a workspace, with their IDs.",
      inputSchema: z.object({ workspaceId, ...page }),
    },
    async ({ workspaceId: ws, limit, offset }) =>
      run(() => client.json(quills(ws, `/boards${query({ limit, offset })}`))),
  );

  registerTool(
    "quills_list_statuses",
    {
      description:
        "List the Quills post statuses of a workspace, with their IDs. quills_set_post_status takes one of these IDs.",
      inputSchema: z.object({ workspaceId, ...page }),
    },
    async ({ workspaceId: ws, limit, offset }) =>
      run(() =>
        client.json(quills(ws, `/statuses${query({ limit, offset })}`)),
      ),
  );

  registerTool(
    "quills_list_posts",
    {
      description:
        "List or search Quills feedback posts that you can see. Filter by board and status; search matches the title and the content. Merged and test-customer posts are left out.",
      inputSchema: z.object({
        workspaceId,
        boardId: id("Board").optional(),
        statusId: id("Status").optional(),
        search: z.string().trim().min(1).max(200).optional(),
        sort: z.enum(["newest", "oldest", "votes"]).optional(),
        limit: page.limit,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          quills(
            args.workspaceId,
            `/posts${query({
              boardIds: args.boardId,
              statusIds: args.statusId,
              search: args.search,
              sort: args.sort,
              limit: args.limit,
            })}`,
          ),
        ),
      ),
  );

  registerTool(
    "quills_get_post",
    {
      description:
        "Get one Quills feedback post, with its tags, whether you voted, and the page and browser that the widget sent with it.",
      inputSchema: z.object({ workspaceId, postId: id("Post") }),
    },
    async ({ workspaceId: ws, postId }) =>
      run(() => client.json(post(ws, postId))),
  );

  registerTool(
    "quills_create_post",
    {
      description:
        "Create a Quills feedback post on a board. You are the author and its first voter. Without statusId the post gets the default status.",
      inputSchema: z.object({
        workspaceId,
        boardId: id("Board"),
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().max(10_000).optional(),
        statusId: id("Status").optional(),
      }),
    },
    async ({ workspaceId: ws, boardId, title, content, statusId }) =>
      run(() =>
        client.json(quills(ws, "/posts"), {
          method: "POST",
          body: JSON.stringify({
            boardId,
            title,
            ...(content !== undefined && { content }),
            ...(statusId && { statusId }),
          }),
        }),
      ),
  );

  registerTool(
    "quills_add_proxy_vote",
    {
      description:
        "Vote on a Quills post on behalf of a person, for example a customer who asked for it in a call. Idempotent. The vote records you as the teammate who added it.",
      inputSchema: z.object({
        workspaceId,
        postId: id("Post"),
        principalId: id("Person (principal)"),
      }),
    },
    async ({ workspaceId: ws, postId, principalId }) =>
      run(() =>
        client.json(
          post(ws, postId, `/voters/${encodeURIComponent(principalId)}`),
          { method: "PUT" },
        ),
      ),
  );

  registerTool(
    "quills_add_comment",
    {
      description:
        "Comment on a Quills post as yourself. isPrivate is required: true keeps the comment inside the team, false shows it to every customer who can see the post.",
      inputSchema: z.object({
        workspaceId,
        postId: id("Post"),
        content: z.string().trim().min(1).max(5000),
        isPrivate: z.boolean(),
        parentId: id("Parent comment").optional(),
      }),
    },
    async ({ workspaceId: ws, postId, content, isPrivate, parentId }) =>
      run(() =>
        client.json(post(ws, postId, "/comments"), {
          method: "POST",
          body: JSON.stringify({
            content,
            isPrivate,
            ...(parentId && { parentId }),
          }),
        }),
      ),
  );

  registerTool(
    "quills_set_post_status",
    {
      description:
        "Set the status of a Quills post. Get the status IDs with quills_list_statuses. Followers and voters get the usual status notifications.",
      inputSchema: z.object({
        workspaceId,
        postId: id("Post"),
        statusId: id("Status"),
      }),
    },
    async ({ workspaceId: ws, postId, statusId }) =>
      run(() =>
        client.json(post(ws, postId, "/status"), {
          method: "PUT",
          body: JSON.stringify({ statusId }),
        }),
      ),
  );

  registerTool(
    "quills_list_feedback_signals",
    {
      description:
        "List the feature requests and bug reports that the Quills autopilot found in closed conversations and resolved tickets, newest first. Pending signals wait for a teammate decision.",
      inputSchema: z.object({
        workspaceId,
        status: z.enum(["pending", "accepted", "dismissed"]).optional(),
        source: z.enum(["conversation", "ticket"]).optional(),
        ...page,
      }),
    },
    async ({ workspaceId: ws, ...filters }) =>
      run(() => client.json(quills(ws, `/feedback-signals${query(filters)}`))),
  );

  registerTool(
    "quills_draft_changelog",
    {
      description:
        "Draft a changelog entry (a title and a Markdown body) from shipped Quills posts with AI. It saves and publishes nothing: review the draft first. Fails when the workspace has no AI provider.",
      inputSchema: z.object({
        workspaceId,
        postIds: z
          .array(id("Post"))
          .min(1)
          .max(25)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Each post ID can appear only once",
          ),
      }),
    },
    async ({ workspaceId: ws, postIds }) =>
      run(() =>
        client.json(quills(ws, "/changelog/drafts"), {
          method: "POST",
          body: JSON.stringify({ postIds }),
        }),
      ),
  );
}
