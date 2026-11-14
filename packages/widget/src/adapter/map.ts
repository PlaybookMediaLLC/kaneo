import { blocksText, markdownBlocks } from "./markdown.js";
import type {
  Conversation,
  FeedbackComment,
  FeedbackPost,
  HelpArticle,
  UpdateEntry,
} from "../ui/types.js";

// API shapes that the widget reads from /api/quills-public/{workspace}/widget/... The route
// tables in apps/api (portal/feedback, content/public, support/customer ROUTES.md) record how
// they differ from the RFC shapes that the view uses.

type Stage = "open" | "planned" | "in_progress" | "shipped";
type Person = { name: string | null; avatarUrl: string | null };

export interface ApiPost {
  id: string;
  title: string;
  content: string;
  board: { id: string; name: string; slug: string };
  status: { id: string } | null;
  stage: Stage | null;
  author: Person;
  voteCount: number;
  voted: boolean;
  following: boolean;
  createdAt: string;
}
export interface ApiComment {
  id: string;
  parentId: string | null;
  content: string;
  author: Person | null;
  deleted: boolean;
  createdAt: string;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
}
export interface ApiChangelogEntry {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  author: { name: string; avatarUrl: string | null } | null;
  linkedPosts: Array<{ id: string }>;
  requesterCount: number;
  /** RFC 0003: the caller's reactions and read mark. Missing from an older API. */
  reactions?: ApiReaction[];
  unread?: boolean;
}
export type ApiReaction = { emoji: string; count: number; reacted: boolean };
export interface ApiArticle {
  id: string;
  title: string;
  description: string | null;
  updatedAt: string;
  author: { name: string } | null;
  category: { name: string };
  content?: string;
  helpful?: boolean | null;
}
export interface ApiConversation {
  id: string;
  subject: string | null;
  preview: string | null;
  unreadCount: number;
}
export interface ApiMessage {
  id: string;
  fromVisitor: boolean;
  author: Person | null;
  content: string;
  createdAt: string;
}

/** The widget's comment vote is the 👍 reaction (portal/feedback/ROUTES.md). */
export const VOTE_EMOJI = "👍";

const optional = (value: string | null | undefined) => value ?? undefined;

/** Null for a closed status: the view has no closed stage, and "open" would be untrue. */
export function toPost(
  post: ApiPost,
  comments?: FeedbackPost["comments"],
): FeedbackPost | null {
  if (!post.stage) return null;
  return {
    id: post.id,
    title: post.title,
    body: post.content,
    author: post.author.name ?? "Anonymous",
    avatarUrl: optional(post.author.avatarUrl),
    votes: post.voteCount,
    voted: post.voted,
    following: post.following,
    status: post.stage,
    createdAt: post.createdAt,
    ...(comments && { comments }),
  };
}

export function toComment(comment: ApiComment): FeedbackComment {
  const vote = comment.reactions.find((item) => item.emoji === VOTE_EMOJI);
  return {
    id: comment.id,
    body: comment.deleted ? "This comment was deleted." : comment.content,
    author: comment.author?.name ?? "Anonymous",
    avatarUrl: optional(comment.author?.avatarUrl),
    createdAt: comment.createdAt,
    parentId: optional(comment.parentId),
    votes: vote?.count ?? 0,
    voted: vote?.reacted ?? false,
  };
}

/** The changelog reactions that the API accepts, in display order. */
export const UPDATE_EMOJI = ["👍", "❤️", "🎉", "😄", "😕", "👀", "🚀"];
/** Offered on every update; the other emoji show once someone used them. */
const OFFERED = new Set(["👍", "❤️", "🎉"]);

/** The offered emoji and every used one, in the API's order. */
export const toReactions = (reactions: readonly ApiReaction[]) =>
  UPDATE_EMOJI.map((emoji) => ({
    emoji,
    count: 0,
    reacted: false,
    ...reactions.find((reaction) => reaction.emoji === emoji),
  })).filter((reaction) => OFFERED.has(reaction.emoji) || reaction.count > 0);

export function toUpdate(entry: ApiChangelogEntry): UpdateEntry {
  const blocks = markdownBlocks(entry.content);
  return {
    id: entry.id,
    title: entry.title,
    body: blocksText(blocks),
    blocks,
    // The view shows `date` as text; the copy is English, like the rest of the view.
    date: new Date(entry.publishedAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    author: entry.author?.name ?? "Team",
    avatarUrl: optional(entry.author?.avatarUrl),
    relatedPostIds: entry.linkedPosts.map((post) => post.id),
    requesterCount: entry.requesterCount,
    unread: entry.unread ?? false,
    reactions: toReactions(entry.reactions ?? []),
  };
}

/** Lists leave out the body: until the article is read, body is its description. */
export function toArticle(article: ApiArticle): HelpArticle {
  const blocks =
    article.content === undefined ? undefined : markdownBlocks(article.content);
  return {
    id: article.id,
    category: article.category.name,
    title: article.title,
    body: blocks ? blocksText(blocks) : (article.description ?? ""),
    ...(blocks && { blocks }),
    ...(article.author && { author: { name: article.author.name } }),
    updatedAt: article.updatedAt,
    ...(typeof article.helpful === "boolean" && { helpful: article.helpful }),
  };
}

export function toMessage(
  message: ApiMessage,
): Conversation["messages"][number] {
  return {
    id: message.id,
    body: message.content,
    author: message.fromVisitor ? "You" : (message.author?.name ?? "Team"),
    sentAt: message.createdAt,
    fromVisitor: message.fromVisitor,
  };
}

export function toConversation(
  conversation: ApiConversation,
  messages: readonly ApiMessage[],
): Conversation {
  return {
    id: conversation.id,
    title: conversation.subject ?? conversation.preview ?? "Conversation",
    unreadCount: conversation.unreadCount,
    messages: messages.map(toMessage),
  };
}

/**
 * Merges messages into a thread by ID, in time order. `after` also returns the 30 seconds
 * before its cursor (support/customer/ROUTES.md), so duplicates are expected.
 */
export function mergeMessages(
  current: Conversation["messages"],
  incoming: Conversation["messages"],
): Conversation["messages"] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) =>
      (a.sentAt ?? "").localeCompare(b.sentAt ?? "") ||
      a.id.localeCompare(b.id),
  );
}
