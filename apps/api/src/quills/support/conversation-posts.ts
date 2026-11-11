import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { conversations } from "../../database/quills/schema/conversation";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import {
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { principal } from "../../database/quills/schema/auth";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { recordActivity } from "../feedback/activity";
import {
  boardVisible,
  findBoard,
  findPost,
  loadProjects,
  relatedPosts,
} from "../feedback/visibility";
import {
  conflict,
  conversationParams,
  errors,
  findConversation,
  type Conversation,
} from "./conversation-model";
import { insertReply } from "./conversation-ops";

// Conversation to feedback: track a conversation as a post by its visitor, or as the
// visitor's vote, and share a post into the thread. Board visibility comes from
// feedback/visibility.ts: a board linked to projects the caller cannot open is hidden.

const LINK_TYPE = "live_chat";
const embed = (postId: string) => ({
  type: "doc",
  content: [{ type: "quackbackEmbed", attrs: { kind: "post", id: postId } }],
});

/** The thread gets an embed card of the post, sent as an agent reply. */
const sharePostMessage = (
  db: Database,
  actor: Parameters<typeof insertReply>[1],
  conversation: Conversation,
  postId: string,
  title: string,
) => insertReply(db, actor, conversation, "", embed(postId), title);

const createPost = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/posts",
  operationId: "createQuillsPostFromConversation",
  summary: "Track a conversation as feedback",
  description:
    "Creates a post by the conversation's visitor on a visible board, or with asUpvoteOfPostId adds the visitor's vote to a visible post (sourceMessageContent becomes a private team comment). Links the post to the conversation and shares it into the thread. Test conversations return 409.",
  action: "create",
  params: conversationParams,
  body: z
    .object({
      boardId: flexibleToTypeIdSchema("board").optional(),
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().trim().max(10000).default(""),
      asUpvoteOfPostId: flexibleToTypeIdSchema("post").optional(),
      sourceMessageContent: z.string().trim().max(10000).optional(),
    })
    .refine((b) => b.asUpvoteOfPostId || (b.boardId && b.title), {
      message: "Provide boardId and title, or asUpvoteOfPostId",
    }),
  response: z.object({
    postId: z.string(),
    created: z.boolean(),
    voted: z.boolean(),
    messageId: z.string(),
  }),
  responseDescription: "The tracked post",
  errors,
  // One event per request: the post, else the vote, else the shared message. The post
  // and vote events carry `messageId`, so reply delivery must read it there too.
  event: ({ params }, result) => {
    const payload: Record<string, string> = {
      conversationId: params.conversationId,
    };
    if (!result.created && !result.voted)
      return {
        type: "message.created",
        entityType: "conversation_message",
        entityId: result.messageId,
        payload,
      };
    return {
      type: result.created ? "post.created" : "post.voted",
      entityType: "post",
      entityId: result.postId,
      payload: { ...payload, messageId: result.messageId },
    };
  },
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const visitor = conversation.visitorPrincipalId;
    const [test] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.id, visitor),
          sql`${principal.testOwnerPrincipalId} is not null`,
        ),
      );
    if (test)
      throw conflict("Test conversations cannot be tracked as feedback");
    let postId;
    let title;
    let voted = false;
    if (body.asUpvoteOfPostId) {
      const target = await findPost(db, body.asUpvoteOfPostId, projects);
      const post = target.canonicalPostId
        ? await findPost(db, target.canonicalPostId, projects)
        : target;
      const [existing] = await db
        .select({ id: postVotes.id })
        .from(postVotes)
        .where(
          and(
            eq(postVotes.principalId, visitor),
            inArray(postVotes.postId, relatedPosts(db, post.id)),
          ),
        )
        .limit(1);
      // The unique (post, principal) index decides between two parallel votes.
      voted = existing
        ? false
        : (
            await db
              .insert(postVotes)
              .values({
                postId: post.id,
                principalId: visitor,
                sourceType: LINK_TYPE,
                addedByPrincipalId: actor.principalId,
              })
              .onConflictDoNothing()
              .returning({ id: postVotes.id })
          ).length > 0;
      if (voted) {
        await db
          .update(posts)
          .set({ voteCount: sql`${posts.voteCount} + 1` })
          .where(eq(posts.id, post.id));
        await db
          .insert(postSubscriptions)
          .values({ postId: post.id, principalId: visitor, reason: "vote" })
          .onConflictDoNothing();
        await recordActivity(db, actor, post.id, {
          type: "vote.proxy",
          metadata: { voterPrincipalId: visitor, voterName: null },
        });
      }
      if (body.sourceMessageContent)
        await db.insert(postComments).values({
          postId: post.id,
          principalId: actor.principalId,
          content: `Tracked from a support conversation:\n\n${body.sourceMessageContent}`,
          isTeamMember: true,
          isPrivate: true,
        });
      postId = post.id;
      title = post.title;
    } else {
      const board = await findBoard(db, body.boardId!, projects);
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(
          and(eq(postStatuses.isDefault, true), isNull(postStatuses.deletedAt)),
        )
        .orderBy(asc(postStatuses.position))
        .limit(1);
      const [post] = await db
        .insert(posts)
        .values({
          boardId: board.id,
          title: body.title!,
          content: body.content,
          statusId: status?.id ?? null,
          principalId: visitor,
          trackedByPrincipalId: actor.principalId,
          widgetMetadata: {
            source: LINK_TYPE,
            conversationId: conversation.id,
          },
          voteCount: 1,
        })
        .returning({ id: posts.id, title: posts.title });
      await db
        .insert(postVotes)
        .values({ postId: post!.id, principalId: visitor });
      await db
        .insert(postSubscriptions)
        .values({ postId: post!.id, principalId: visitor, reason: "author" });
      await recordActivity(db, actor, post!.id, {
        type: "post.created",
        metadata: { boardName: board.name },
      });
      postId = post!.id;
      title = post!.title;
    }
    await db
      .insert(postExternalLinks)
      .values({
        postId,
        integrationType: LINK_TYPE,
        externalId: conversation.id,
        externalDisplayId: conversation.subject,
        origin: "reference",
        createdByPrincipalId: actor.principalId,
      })
      .onConflictDoNothing();
    const messageId = await sharePostMessage(
      db,
      actor,
      conversation,
      postId,
      title,
    );
    return { postId, created: !body.asUpvoteOfPostId, voted, messageId };
  },
});

const sharePost = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/share-post",
  operationId: "shareQuillsPost",
  summary: "Share a feedback post in a conversation",
  description:
    "Sends an agent reply that embeds the post. The post must be on a board the caller can see.",
  action: "update",
  params: conversationParams,
  body: z.object({ postId: flexibleToTypeIdSchema("post") }),
  response: z.object({ messageId: z.string(), conversationId: z.string() }),
  responseDescription: "The reply",
  errors,
  event: (_input, result) => ({
    type: "message.created",
    entityType: "conversation_message",
    entityId: result.messageId,
    payload: { conversationId: result.conversationId },
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const post = await findPost(db, body.postId, projects);
    const messageId = await sharePostMessage(
      db,
      actor,
      conversation,
      post.id,
      post.title,
    );
    return { messageId, conversationId: conversation.id };
  },
});

const linkedPosts = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/posts",
  operationId: "getQuillsLinkedPostsForConversation",
  summary: "List the posts tracked from a conversation",
  description: "Live posts on boards the caller can see.",
  action: "read",
  params: conversationParams,
  response: z.object({
    items: z.array(
      z.object({
        postId: z.string(),
        title: z.string(),
        boardId: z.string(),
        boardSlug: z.string(),
      }),
    ),
  }),
  responseDescription: "Posts",
  errors,
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    const conversation = await findConversation(db, params.conversationId);
    const items = await db
      .select({
        postId: posts.id,
        title: posts.title,
        boardId: boards.id,
        boardSlug: boards.slug,
      })
      .from(postExternalLinks)
      .innerJoin(posts, eq(posts.id, postExternalLinks.postId))
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(
          eq(postExternalLinks.integrationType, LINK_TYPE),
          eq(postExternalLinks.externalId, conversation.id),
          eq(postExternalLinks.status, "active"),
          isNull(posts.deletedAt),
          boardVisible(projects),
        ),
      )
      .orderBy(asc(postExternalLinks.createdAt))
      .limit(100);
    return { items };
  },
});

const linkedConversations = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/conversations",
  operationId: "getQuillsLinkedConversationsForPost",
  summary: "List the conversations a post was tracked from",
  description: "The post must be on a board the caller can see.",
  action: "read",
  params: z.object({ postId: flexibleToTypeIdSchema("post") }),
  response: z.object({
    items: z.array(
      z.object({
        conversationId: z.string(),
        subject: z.string().nullable(),
        status: z.string(),
      }),
    ),
  }),
  responseDescription: "Conversations",
  errors,
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const links = await db
      .select({ externalId: postExternalLinks.externalId })
      .from(postExternalLinks)
      .where(
        and(
          eq(postExternalLinks.postId, post.id),
          eq(postExternalLinks.integrationType, LINK_TYPE),
          eq(postExternalLinks.status, "active"),
        ),
      )
      .limit(100);
    // The external ID is text: only well-formed conversation IDs reach the uuid column.
    const ids = links.flatMap(
      (link) =>
        flexibleToTypeIdSchema("conversation").safeParse(link.externalId)
          .data ?? [],
    );
    const items = ids.length
      ? await db
          .select({
            conversationId: conversations.id,
            subject: conversations.subject,
            status: conversations.status,
          })
          .from(conversations)
          .where(inArray(conversations.id, ids))
          .orderBy(asc(conversations.createdAt))
      : [];
    return { items };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...createPost)
  .openapi(...sharePost)
  .openapi(...linkedPosts)
  .openapi(...linkedConversations);
