import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../openapi";
import { contentTranslations } from "../../database/quills/schema/content-translations";
import {
  AiError,
  chatJson,
  requireAi,
  toHttp,
  untrusted,
} from "../assistant/provider";
import { logUsage } from "../assistant/runs";
import { hashToken, type QuillsCaller } from "../framework/audience";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { findComment } from "./feedback/comments";
import { findPost, viewerFor, visibleBoards } from "./feedback/viewer";

// Machine translation of a post or a comment for a portal viewer (RFC 0003, feature 18, D10).
// The cache row is keyed by the entity, the locale and the SHA-256 of the source text, so an
// edited text never gets an old translation. The provider call holds no database connection.

/**
 * The language that the cache keys on: `de-AT` and `de-DE` are `de`, so a region never causes a
 * second AI call. Chinese keeps its script, as in the help-center locales (`zh-cn`, `zh-tw`).
 */
export function language(tag: string) {
  const lower = tag.toLowerCase();
  const primary = lower.split("-")[0]!;
  if (primary !== "zh") return primary;
  return /-(hant|tw|hk|mo)(-|$)/.test(lower) ? "zh-tw" : "zh-cn";
}

const body = z
  .object({
    postId: flexibleToTypeIdSchema("post").optional(),
    commentId: flexibleToTypeIdSchema("post_comment").optional(),
    locale: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Use a BCP 47 language tag")
      .transform(language),
  })
  .refine((value) => Boolean(value.postId) !== Boolean(value.commentId), {
    message: "Provide a post ID or a comment ID",
  });
type Target = z.output<typeof body>;

const answer = z.object({
  title: z.string().nullable().optional(),
  content: z.string(),
});

/** The text that the caller may see. 404 when it is hidden, deleted or in another workspace. */
async function sourceOf(db: Database, caller: QuillsCaller, target: Target) {
  const viewer = await viewerFor(db, "portal", caller);
  const boards = await visibleBoards(db, viewer);
  if (target.commentId) {
    const comment = await findComment(db, viewer, boards, target.commentId);
    return { postId: comment.postId, title: null, content: comment.content };
  }
  const post = await findPost(db, viewer, boards, target.postId!);
  return { postId: post.id, title: post.title, content: post.content };
}

/** SHA-256 (hex) of the source text. */
const hashOf = (source: { title: string | null; content: string }) =>
  hashToken(JSON.stringify([source.title, source.content]));

const translate = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "post",
  path: "/portal/translations",
  operationId: "translateQuillsPortalContent",
  summary: "Translate a post or a comment into the viewer's language",
  description:
    "Exactly one of postId and commentId. Only content that the caller may see. A cached translation of the same text is returned without an AI call. 409 when AI is not configured and nothing is cached, 502 when the provider fails.",
  action: "read",
  rateLimit: { limit: 60, windowSeconds: 600, per: "caller" },
  body,
  prepare: async ({ db, caller, body }) => {
    const source = await sourceOf(db, caller, body);
    const hash = hashOf(source);
    const [cached] = await db
      .select({
        title: contentTranslations.title,
        content: contentTranslations.content,
      })
      .from(contentTranslations)
      .where(
        and(
          body.commentId
            ? eq(contentTranslations.commentId, body.commentId)
            : eq(contentTranslations.postId, body.postId!),
          eq(contentTranslations.locale, body.locale),
          eq(contentTranslations.sourceHash, hash),
        ),
      )
      .limit(1);
    return { source, hash, cached };
  },
  call: async ({ source, hash, cached }, { body }) => {
    if (cached) return { hash, translation: cached, usage: null };
    requireAi();
    const { value, usage } = await chatJson(
      answer,
      [
        {
          role: "system",
          content: [
            `Translate customer feedback into the language with the BCP 47 tag "${body.locale}". Keep the meaning, Markdown, links, code and product names. Do not add or remove information.`,
            'Answer with one JSON object: {"title": string | null, "content": string}. The title is null when the text has no title.',
          ].join("\n"),
        },
        {
          role: "user",
          content: untrusted(
            "feedback",
            JSON.stringify({ title: source.title, content: source.content }),
          ),
        },
      ],
      8000,
    ).catch((error) => {
      throw toHttp(error);
    });
    // An empty answer for a text is no translation: never cache it for every viewer.
    if (source.content.trim() && !value.content.trim())
      throw toHttp(new AiError("bad_response"));
    const title =
      source.title === null ? null : value.title?.trim() || source.title;
    return {
      hash,
      translation: {
        title: title?.slice(0, 400) ?? null,
        content: value.content.slice(0, 20000),
      },
      usage,
    };
  },
  response: z.object({
    title: z.string().max(400).nullable(),
    content: z.string().max(20000),
  }),
  responseDescription: "The translated title (null for a comment) and content",
  errors: {
    403: "Blocked account or no portal access",
    404: "Post or comment not found",
    409: "AI is not configured, or the text changed during the request",
    502: "The AI provider failed",
  },
  event: {
    none: "A cached translation is derived data; the usage log row records the AI call",
  },
  handler: async ({ db, caller, body, called }) => {
    // A cache hit made no provider call: `prepare` checked the text in this request.
    if (!called.usage) return called.translation;
    // The text may have changed or left the caller's sight while the provider answered.
    const source = await sourceOf(db, caller, body);
    if (hashOf(source) !== called.hash)
      throw new HTTPException(409, {
        message: "The text changed during the request; retry",
      });
    if (called.usage) {
      // Two requests that both missed store one row: the unique key keeps the first.
      await db
        .insert(contentTranslations)
        .values({
          postId: body.postId,
          commentId: body.commentId,
          locale: body.locale,
          sourceHash: called.hash,
          ...called.translation,
        })
        .onConflictDoNothing();
      await logUsage(db, [
        {
          step: "portal_translation",
          callType: "chat_completion",
          usage: called.usage,
          postId: source.postId,
          metadata: { locale: body.locale },
        },
      ]);
    }
    return called.translation;
  },
});

export default apiRouter().openapi(...translate);
