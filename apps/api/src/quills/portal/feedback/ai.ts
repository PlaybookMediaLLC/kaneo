import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../openapi";
import {
  chatJson,
  requireAi,
  toHttp,
  untrusted,
} from "../../assistant/provider";
import { logUsage } from "../../assistant/runs";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { notFound } from "../../feedback/visibility";
import {
  capabilities,
  forbidden,
  viewerFor,
  visibleBoards,
  type Viewer,
} from "./viewer";

// AI help for the portal composer (RFC 0003, feature 4). The model rewrites only the customer's
// own words into a title and a problem statement and picks a board. Nothing is stored: the
// customer accepts or ignores the suggestion. The provider call holds no database connection.

const answer = z.object({
  title: z.string().min(1),
  problem: z.string(),
  boardId: z.string().nullable().optional(),
});

/** The boards that take the caller's posts. A given board must be one of them. */
async function submittable(db: Database, viewer: Viewer, boardId?: string) {
  const visible = await visibleBoards(db, viewer);
  const boards = visible.filter(
    (board) => capabilities(viewer, board.access).canSubmit,
  );
  if (boardId && !visible.some((board) => board.id === boardId))
    throw notFound("Board");
  if (boardId && !boards.some((board) => board.id === boardId))
    throw forbidden("Submissions are not open to you on this board");
  if (!boards.length) throw forbidden("Submissions are not open to you");
  return boards;
}

const improve = defineQuillsRoute({
  audience: "portal",
  method: "post",
  path: "/portal/post-draft/improve",
  operationId: "improveQuillsPortalPostDraft",
  summary:
    "Suggest a clearer title, problem statement and board for a draft post",
  description:
    "The model rewrites only the customer's text and picks one of the boards that take the caller's posts. Nothing is saved. 409 when AI is not configured, 502 when the provider fails.",
  action: "create",
  rateLimit: { limit: 10, windowSeconds: 600, per: "caller" },
  body: z
    .object({
      title: z.string().trim().max(200),
      details: z.string().trim().max(4000),
      boardId: flexibleToTypeIdSchema("board").optional(),
    })
    .refine((body) => body.title || body.details, {
      message: "Provide a title or details",
    }),
  prepare: async ({ db, caller, body }) => {
    // A closed portal is 404 before the AI check, like every portal route.
    const viewer = await viewerFor(db, "portal", caller);
    const boards = await submittable(db, viewer, body.boardId);
    requireAi();
    // ponytail: the first 50 boards by name reach the prompt; send a shortlist if workspaces have more.
    return boards.slice(0, 50).map((board) => ({
      id: board.id,
      name: board.name,
      description: board.description?.slice(0, 200) ?? null,
    }));
  },
  call: (boards, { body }) =>
    chatJson(
      answer,
      [
        {
          role: "system",
          content: [
            "You help a customer write a feedback post. Use only what the customer wrote: keep their meaning and their voice, and never add facts, features, numbers or claims that are not in their text.",
            "Write a short, clear title (at most 200 characters) and a problem statement (at most 1000 characters) that says what the customer wants to do and what stops them, in the language of their text.",
            "Pick the board that fits best by its id, or null.",
            'Answer with one JSON object: {"title": string, "problem": string, "boardId": string | null}.',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            untrusted(
              "draft",
              JSON.stringify({ title: body.title, details: body.details }),
            ),
            untrusted("boards", JSON.stringify(boards)),
          ].join("\n"),
        },
      ],
      800,
    ).catch((error) => {
      throw toHttp(error);
    }),
  response: z.object({
    title: z.string().max(200),
    problem: z.string().max(1000),
    boardId: z.string().nullable(),
  }),
  responseDescription: "The suggestion; nothing is saved",
  errors: {
    403: "Blocked account, no portal access, or submissions are not open to you",
    404: "Board not found",
    409: "AI is not configured",
    502: "The AI provider failed",
  },
  event: {
    none: "A suggestion changes no domain data; the usage log row is its record",
  },
  handler: async ({ db, caller, body, called }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const boards = await submittable(db, viewer, body.boardId);
    await logUsage(db, [
      {
        step: "portal_post_draft",
        callType: "chat_completion",
        usage: called.usage,
      },
    ]);
    const chosen = boards.find((board) => board.id === called.value.boardId);
    return {
      title: called.value.title.trim().slice(0, 200),
      problem: called.value.problem.trim().slice(0, 1000),
      // Only a board that takes the caller's posts, never one the model made up.
      boardId: chosen?.id ?? body.boardId ?? null,
    };
  },
});

export default apiRouter().openapi(...improve);
