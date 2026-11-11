import { ApiError, type Api } from "./api.js";
import {
  mergeMessages,
  toArticle,
  toComment,
  toConversation,
  toMessage,
  toPost,
  toUpdate,
  type ApiArticle,
  type ApiChangelogEntry,
  type ApiComment,
  type ApiConversation,
  type ApiMessage,
  type ApiPost,
} from "./map.js";
import type {
  Conversation,
  FeedbackPost,
  HelpArticle,
  UpdateEntry,
} from "../ui/types.js";

/** The widget tabs that the workspace turned on (config.json `tabs`). */
export interface Surfaces {
  feedback: boolean;
  changelog: boolean;
  help: boolean;
  messenger: boolean;
}
export interface Snapshot {
  feedback: FeedbackPost[];
  updates: UpdateEntry[];
  articles: HelpArticle[];
  conversations: Conversation[];
  /** The surfaces that loaded for this visitor; the view gets actions only for these. */
  available: Surfaces;
}
const none: Surfaces = {
  feedback: false,
  changelog: false,
  help: false,
  messenger: false,
};
export const emptySnapshot: Snapshot = {
  feedback: [],
  updates: [],
  articles: [],
  conversations: [],
  available: none,
};
type Thread = { conversation: ApiConversation; messages: ApiMessage[] };

// ponytail: one page per list (50 posts and updates, 100 articles, 20 conversations with
// their latest 30 messages, 100 comments). The view has no "load more" control yet.
const LIMITS = { posts: 50, updates: 50, articles: 100, conversations: 20 };

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, String(value));
  return `?${params}`;
};

/**
 * A surface that is off for this visitor: 404 when its module switch is off, 403 when a
 * private portal admits only identified visitors (portal/feedback/ROUTES.md).
 */
export const unavailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 403 || error.status === 404);

/** Null when the surface is off, so it is hidden instead of failing the whole load. */
async function surface<T>(enabled: boolean, load: () => Promise<T[]>) {
  if (!enabled) return null;
  try {
    return await load();
  } catch (error) {
    if (unavailable(error)) return null;
    throw error;
  }
}

/** The ID of the init `defaultBoard` (an ID or slug) when the visitor can see it. */
export async function resolveBoard(
  api: Api,
  ref: string,
  signal?: AbortSignal,
) {
  const { items } = await api.request<{
    items: Array<{ id: string; slug: string }>;
  }>("GET", "/widget/boards", undefined, signal);
  return items.find((board) => board.id === ref || board.slug === ref)?.id;
}

export async function loadConversations(api: Api, signal?: AbortSignal) {
  const { items } = await api.request<{ items: ApiConversation[] }>(
    "GET",
    `/widget/conversations${query({ limit: LIMITS.conversations })}`,
    undefined,
    signal,
  );
  const threads = await Promise.all(
    items.map((item) =>
      api.request<Thread>(
        "GET",
        `/widget/conversations/${encodeURIComponent(item.id)}`,
        undefined,
        signal,
      ),
    ),
  );
  // The API lists newest activity first; the view reads oldest first.
  return threads
    .map((thread) => toConversation(thread.conversation, thread.messages))
    .reverse();
}

export async function loadSnapshot(
  api: Api,
  options: { surfaces: Surfaces; locale?: string; boardId?: string },
  signal?: AbortSignal,
): Promise<Snapshot> {
  const { surfaces, locale, boardId } = options;
  const [feedback, updates, articles, conversations] = await Promise.all([
    surface(surfaces.feedback, async () => {
      const { items } = await api.request<{ items: ApiPost[] }>(
        "GET",
        `/widget/posts${query({ limit: LIMITS.posts, boardId })}`,
        undefined,
        signal,
      );
      return items.flatMap((item) => toPost(item) ?? []);
    }),
    surface(surfaces.changelog, async () => {
      const { entries } = await api.request<{ entries: ApiChangelogEntry[] }>(
        "GET",
        `/widget/changelog${query({ limit: LIMITS.updates })}`,
        undefined,
        signal,
      );
      return entries.map(toUpdate);
    }),
    surface(surfaces.help, async () => {
      const { articles } = await api.request<{ articles: ApiArticle[] }>(
        "GET",
        `/widget/help/articles${query({ limit: LIMITS.articles, locale })}`,
        undefined,
        signal,
      );
      return articles.map(toArticle);
    }),
    surface(surfaces.messenger, () => loadConversations(api, signal)),
  ]);
  return {
    feedback: feedback ?? [],
    updates: updates ?? [],
    articles: articles ?? [],
    conversations: conversations ?? [],
    available: {
      feedback: feedback !== null,
      changelog: updates !== null,
      help: articles !== null,
      messenger: conversations !== null,
    },
  };
}

/** A post with its comments: the list leaves the discussion out. Null when it is closed. */
export async function loadPost(api: Api, id: string, signal?: AbortSignal) {
  const [post, comments] = await Promise.all([
    api.request<ApiPost>(
      "GET",
      `/widget/posts/${encodeURIComponent(id)}`,
      undefined,
      signal,
    ),
    api.request<{ items: ApiComment[] }>(
      "GET",
      `/widget/posts/${encodeURIComponent(id)}/comments${query({ limit: 100 })}`,
      undefined,
      signal,
    ),
  ]);
  return toPost(post, comments.items.map(toComment));
}

/** One changelog entry: a deep link can point past the first page. */
export async function loadUpdate(api: Api, id: string, signal?: AbortSignal) {
  return toUpdate(
    await api.request<ApiChangelogEntry>(
      "GET",
      `/widget/changelog/${encodeURIComponent(id)}`,
      undefined,
      signal,
    ),
  );
}

/** An article with its body, by ID or slug. */
export async function loadArticle(
  api: Api,
  ref: string,
  locale?: string,
  signal?: AbortSignal,
) {
  return toArticle(
    await api.request<ApiArticle>(
      "GET",
      `/widget/help/articles/${encodeURIComponent(ref)}${query({ locale })}`,
      undefined,
      signal,
    ),
  );
}

/**
 * Brings threads up to date without a push channel: a changed conversation reads only the
 * messages after its newest one (`?after=`), a new one reads its latest page.
 */
export async function syncConversations(
  api: Api,
  current: readonly Conversation[],
  signal?: AbortSignal,
) {
  const { items } = await api.request<{
    items: Array<ApiConversation & { lastMessageAt: string }>;
  }>(
    "GET",
    `/widget/conversations${query({ limit: LIMITS.conversations })}`,
    undefined,
    signal,
  );
  const next = await Promise.all(
    items.map(async (item): Promise<Conversation> => {
      const known = current.find((thread) => thread.id === item.id);
      const last = known?.messages[known.messages.length - 1];
      if (!known || !last) {
        const thread = await api.request<Thread>(
          "GET",
          `/widget/conversations/${encodeURIComponent(item.id)}`,
          undefined,
          signal,
        );
        return toConversation(thread.conversation, thread.messages);
      }
      const fresh = toConversation(item, []);
      // Unchanged only when no new team message is unread and nothing is newer than our copy.
      if (
        known.unreadCount === item.unreadCount &&
        (last.sentAt ?? "") >= item.lastMessageAt
      )
        return { ...fresh, messages: known.messages };
      const page = await api.request<{ items: ApiMessage[] }>(
        "GET",
        `/widget/conversations/${encodeURIComponent(item.id)}/messages${query({ after: last.id, limit: 100 })}`,
        undefined,
        signal,
      );
      return {
        ...fresh,
        messages: mergeMessages(known.messages, page.items.map(toMessage)),
      };
    }),
  );
  return next.reverse();
}
