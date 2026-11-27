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
      title?: string;
      customFields?: Record<string, string | number | boolean | string[]>;
    } = {},
  ) =>
    api.request<ApiPost>(
      "POST",
      "/widget/posts",
      {
        content,
        idempotencyKey,
        ...(context.title && { title: context.title }),
        ...(boardId && { boardId }),
        ...(context.customFields && { customFields: context.customFields }),
        ...(context.attachmentIds?.length && {
          attachmentIds: context.attachmentIds,
        }),
        ...(context.metadata && { metadata: context.metadata }),
      },
      signal,
    ),
  /** A suggested title and board for the visitor's words (issue #106). Saves nothing. */
  draftPost: (details: string, signal?: AbortSignal) =>
    api.request<{
      title: string;
      boardId: string | null;
      boardName: string | null;
    }>(
      "POST",
      "/widget/post-draft/improve",
      { title: "", details: details.slice(0, 4000) },
      signal,
    ),
  /** Visible posts with a title like the text, best match first. */
  similarPosts: (title: string, signal?: AbortSignal) =>
    api.request<{
      items: Array<{ id: string; title: string; voteCount?: number }>;
    }>(
      "GET",
      `/widget/posts/similar?title=${encodeURIComponent(title.slice(0, 200))}&limit=5`,
      undefined,
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
  searchHelp: (queryText: string, locale?: string, signal?: AbortSignal) =>
    api.request<{
      locale: string;
      queryId: string | null;
      articles: Array<{
        id: string;
        title: string;
        description: string | null;
        snippet: string;
        category: { id: string; slug: string; name: string };
      }>;
    }>(
      "POST",
      "/widget/kb-search",
      { query: queryText, ...(locale && { locale }), limit: 15, record: true },
      signal,
    ),
  recordHelpSearchClick: (queryId: string, articleId: string) =>
    api.request<{ recorded: true }>(
      "POST",
      `/widget/kb-search/${id(queryId)}/click`,
      { articleId },
    ),
  /** `metadata`: the host page context, kept with the message for the team. */
  startConversation: (
    content: string,
    idempotencyKey: string,
    signal?: AbortSignal,
    metadata?: Record<string, string>,
    attachmentIds: string[] = [],
  ) =>
    api.request<Sent>(
      "POST",
      "/widget/conversations",
      {
        content,
        idempotencyKey,
        ...(metadata && { metadata }),
        ...(attachmentIds.length && { attachmentIds }),
      },
      signal,
    ),
  reply: (
    conversationId: string,
    content: string,
    idempotencyKey: string,
    signal?: AbortSignal,
    metadata?: Record<string, string>,
    attachmentIds: string[] = [],
  ) =>
    api.request<Sent>(
      "POST",
      `/widget/conversations/${id(conversationId)}/messages`,
      {
        content,
        idempotencyKey,
        ...(metadata && { metadata }),
        ...(attachmentIds.length && { attachmentIds }),
      },
      signal,
    ),
  /** A short-lived download URL of a file that a teammate sent in the conversation. */
  fileUrl: (conversationId: string, fileId: string, signal?: AbortSignal) =>
    api
      .request<{ downloadUrl: string }>(
        "GET",
        `/widget/conversations/${id(conversationId)}/files/${id(fileId)}`,
        undefined,
        signal,
      )
      .then((file) => file.downloadUrl),
  /** The watermark only moves forward on the server. */
  /** Marks the assistant's proposed request as submitted with the visitor's post. */
  confirmFeedbackCard: (
    conversationId: string,
    messageId: string,
    postId: string,
    signal?: AbortSignal,
  ) =>
    api.request<{ message: ApiMessage }>(
      "PUT",
      `/widget/conversations/${id(conversationId)}/messages/${id(messageId)}/feedback-card`,
      { postId },
      signal,
    ),
  /** Immediately hand off the conversation to a human teammate (zero LLM call, #299). */
  handoffConversation: (conversationId: string, signal?: AbortSignal) =>
    api.request<{ handedOff: true; message: ApiMessage }>(
      "POST",
      `/widget/conversations/${id(conversationId)}/handoff`,
      undefined,
      signal,
    ),
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
  /** Moves the visitor's announced mark to now: the launcher showed the newest update (#108). */
  announced: (signal?: AbortSignal) =>
    api.request<{ announcedAt: string }>(
      "PUT",
      "/widget/changelog/announced",
      undefined,
      signal,
    ),
  updatesUnread: (signal?: AbortSignal) =>
    api.request<{
      count: number;
      announce: { id: string; title: string } | null;
      autoOpen: boolean;
    }>("GET", "/widget/changelog/unread", undefined, signal),
  unread: (signal?: AbortSignal) =>
    api.request<{ unreadCount: number }>(
      "GET",
      "/widget/unread",
      undefined,
      signal,
    ),
});
