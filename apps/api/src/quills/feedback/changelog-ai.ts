import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PostId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { chatJson, requireAi, toHttp, untrusted } from "../assistant/provider";
import { logUsage } from "../assistant/runs";
import { defineQuillsRoute } from "../framework/define-route";
import { requireAll } from "./id-sets";
import { loadProjects, notTest, visiblePost } from "./visibility";

// An AI draft of a changelog entry from shipped posts (RFC 0003, feature 14). The posts are read
// in a scoped transaction, the provider runs with no transaction open, and the usage log row is
// written after. Nothing is saved or published: the teammate reviews the draft and creates the
// entry with createQuillsChangelogEntry.

const MAX_POSTS = 25;
/** Prompt and answer bounds: about 500 characters per post in, one entry out. */
const EXCERPT = 500;
const MAX_TOKENS = 1500;

const answer = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

const draft = defineQuillsRoute({
  method: "post",
  path: "/changelog/drafts",
  operationId: "draftQuillsChangelogFromPosts",
  summary: "Draft a changelog entry from shipped posts with AI",
  description:
    "Returns a title and a Markdown body for review. Saves and publishes nothing; the usage log row is its record. Every post must be one the caller may see. 409 when AI is not configured, 502 when the provider fails.",
  action: "create",
  body: z.object({
    postIds: z
      .array(flexibleToTypeIdSchema("post"))
      .min(1)
      .max(MAX_POSTS)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Each ID can appear only once",
      ),
  }),
  load: async (input) => {
    requireAi();
    return loadProjects(input);
  },
  prepare: async ({ db, body, loaded }) => {
    const ids = body.postIds as PostId[];
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        voteCount: posts.voteCount,
        board: boards.name,
        status: postStatuses.name,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(and(inArray(posts.id, ids), visiblePost(loaded)))
      .orderBy(asc(posts.title), asc(posts.id));
    requireAll(ids, rows, "Post");
    const [requesters] = await db
      .select({
        count: sql<number>`count(distinct ${postVotes.principalId})::int`,
      })
      .from(postVotes)
      .where(
        and(inArray(postVotes.postId, ids), notTest(postVotes.principalId)),
      );
    return { rows, requesterCount: requesters?.count ?? 0 };
  },
  call: async ({ rows, requesterCount }) => ({
    requesterCount,
    ...(await chatJson(
      answer,
      [
        {
          role: "system",
          content: [
            "You write a product changelog entry for customers.",
            "Use only the shipped requests that you get. Do not add features, dates, numbers or customer names.",
            "Write a short title. Write the body in Markdown: one short sentence, then one bullet for each request that says what changed and how it helps.",
            'Answer with one JSON object: {"title": string, "body": string}.',
          ].join("\n"),
        },
        {
          role: "user",
          content: untrusted(
            "requests",
            rows
              .map((row) =>
                [
                  `Title: ${row.title}`,
                  `Board: ${row.board}`,
                  `Status: ${row.status ?? "none"}`,
                  `Votes: ${row.voteCount}`,
                  `Details: ${row.content.slice(0, EXCERPT)}`,
                ].join("\n"),
              )
              .join("\n\n"),
          ),
        },
      ],
      MAX_TOKENS,
    ).catch((error) => {
      throw toHttp(error);
    })),
  }),
  response: z.object({
    title: z.string(),
    body: z.string().openapi({ description: "Markdown" }),
    postIds: z.array(z.string()),
    requesterCount: z.number().openapi({
      description: "Distinct people who voted for the posts",
    }),
  }),
  responseDescription: "The draft for review",
  errors: {
    404: "Post not found",
    409: "AI is not configured",
    502: "The AI provider failed",
  },
  event: {
    none: "A draft changes no domain data; the usage log row is its record",
  },
  handler: async ({ db, body, called }) => {
    await logUsage(db, [
      {
        step: "changelog_draft",
        callType: "chat_completion",
        usage: called.usage,
        metadata: { posts: body.postIds.length },
      },
    ]);
    return {
      title: called.value.title,
      body: called.value.body,
      postIds: body.postIds,
      requesterCount: called.requesterCount,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...draft,
);
