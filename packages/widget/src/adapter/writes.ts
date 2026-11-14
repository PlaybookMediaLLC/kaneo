import type { Api } from "./api.js";
import {
  VOTE_EMOJI,
  type ApiComment,
  type ApiConversation,
  type ApiMessage,
  type ApiPost,
  type ApiReaction,
} from "./map.js";

// The widget's writes, as the API takes them. Idempotency keys go in the body: the routes read
// no Idempotency-Key header (support/customer/ROUTES.md, portal/feedback/ROUTES.md).

export type Sent = { conversation: ApiConversation; message: ApiMessage };
const id = encodeURIComponent;

export const writes = (api: Api) => ({
  /** `context`: attached file IDs and the page metadata (RFC 0003 feature 6). */
  createPost: (
    content: string,
    idempotencyKey: string,
    boardId?: string,
    signal?: AbortSignal,
    context: {
      attachmentIds?: string[];
      metadata?: Record<string, string>;
    } = {},
  ) =>
    api.request<ApiPost>(
      "POST",
      "/widget/posts",
      {
        content,
        idempotencyKey,
        ...(boardId && { boardId }),
        ...(context.attachmentIds?.length && {
          attachmentIds: context.attachmentIds,
        }),
        ...(context.metadata && { metadata: context.metadata }),
      },
      signal,
    ),
  /** Desired state, not a toggle: a retry changes nothing. */
  vote: (postId: string, voted: boolean, signal?: AbortSignal) =>
    api.request<{ postId: string; voted: boolean; voteCount?: number }>(
      "PUT",
      `/widget/posts/${id(postId)}/vote`,
      { voted },
      signal,
    ),
  follow: (postId: string, following: boolean, signal?: AbortSignal) =>
    api.request<{ following: boolean }>(
      "PUT",
      `/widget/posts/${id(postId)}/follow`,
      { following },
      signal,
    ),
  comment: (
    postId: string,
    content: string,
    idempotencyKey: string,
    parentId?: string,
    signal?: AbortSignal,
  ) =>
    api.request<ApiComment>(
      "POST",
      `/widget/posts/${id(postId)}/comments`,
      { content, idempotencyKey, ...(parentId && { parentId }) },
      signal,
    ),
  voteComment: (commentId: string, voted: boolean, signal?: AbortSignal) =>
    api.request<{ reactions: ApiComment["reactions"] }>(
      "PUT",
      `/widget/comments/${id(commentId)}/reactions`,
      { emoji: VOTE_EMOJI, reacted: voted },
      signal,
    ),
  articleFeedback: (
    articleId: string,
    helpful: boolean,
    signal?: AbortSignal,
  ) =>
    api.request<{ helpful: boolean }>(
      "PUT",
      `/widget/help/articles/${id(articleId)}/feedback`,
      { helpful },
      signal,
    ),
  startConversation: (
    content: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) =>
    api.request<Sent>(
      "POST",
      "/widget/conversations",
      { content, idempotencyKey },
      signal,
    ),
  reply: (
    conversationId: string,
    content: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) =>
    api.request<Sent>(
      "POST",
      `/widget/conversations/${id(conversationId)}/messages`,
      { content, idempotencyKey },
      signal,
    ),
  /** The watermark only moves forward on the server. */
  markRead: (
    conversationId: string,
    throughMessageId: string,
    signal?: AbortSignal,
  ) =>
    api.request<{ unreadCount: number }>(
      "PUT",
      `/widget/conversations/${id(conversationId)}/read`,
      { throughMessageId },
      signal,
    ),
  /** Desired state: one reaction per visitor, update and emoji. */
  reactToUpdate: (
    entryId: string,
    emoji: string,
    reacted: boolean,
    signal?: AbortSignal,
  ) =>
    api.request<{ reactions: ApiReaction[] }>(
      "PUT",
      `/widget/changelog/${id(entryId)}/reactions`,
      { emoji, reacted },
      signal,
    ),
  /** Moves the visitor's read mark to now: every update is read. */
  readUpdates: (signal?: AbortSignal) =>
    api.request<{ lastReadAt: string }>(
      "PUT",
      "/widget/changelog/read",
      undefined,
      signal,
    ),
  updatesUnread: (signal?: AbortSignal) =>
    api.request<{ count: number }>(
      "GET",
      "/widget/changelog/unread",
      undefined,
      signal,
    ),
  unread: (signal?: AbortSignal) =>
    api.request<{ unreadCount: number }>(
      "GET",
      "/widget/unread",
      undefined,
      signal,
    ),
});
