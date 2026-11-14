import { useEffect, useRef, useState } from "react";
import { ApiError, type Api } from "./api.js";
import {
  emptySnapshot,
  loadArticle,
  loadPost,
  loadSnapshot,
  loadUpdate,
  resolveBoard,
  syncConversations,
  unavailable,
  type Snapshot,
  type Surfaces,
} from "./load.js";
import {
  mergeMessages,
  toComment,
  toConversation,
  toMessage,
  toPost,
  toReactions,
  VOTE_EMOJI,
} from "./map.js";
import { postMetadata } from "./post-context.js";
import { uploadImage } from "./uploads.js";
import { writes, type Sent } from "./writes.js";
import type { EventMap } from "../core/protocol.js";
import type {
  FeedbackPost,
  SubmissionOptions,
  WidgetTab,
  WidgetViewProps,
} from "../ui/types.js";

export interface HostEvents {
  event<K extends "post:created" | "vote" | "comment:created">(
    name: K,
    payload: EventMap[K],
  ): void;
  unread(count: number): void;
  /** The API answered 401: this session ended. */
  expired(session: number | null): void;
}

interface Options {
  api: Api;
  /** Changes with each new widget session; null before one exists. */
  session: number | null;
  /** The panel has opened. Before that only the unread count is polled, for the launcher. */
  active: boolean;
  surfaces: Surfaces;
  locale?: string;
  board?: string;
  host: HostEvents;
  pollIntervalMs: number;
  /** The host app's metadata and the page URL from the SDK, sent with a new post. */
  context?: Record<string, string>;
}

/** Replaces the item with the same ID, or adds it at `where`. */
const upsert = <T extends { id: string }>(
  list: readonly T[],
  item: T,
  where: "start" | "end",
) =>
  list.some((entry) => entry.id === item.id)
    ? list.map((entry) => (entry.id === item.id ? item : entry))
    : where === "start"
      ? [item, ...list]
      : [...list, item];

/**
 * The widget's data and actions over the real routes, in the shape of WidgetViewProps. Each
 * action resolves only after the API saved it and the snapshot shows the result.
 */
export function useWidgetData({
  api,
  session,
  active,
  surfaces,
  locale,
  board,
  host,
  pollIntervalMs,
  context = {},
}: Options): Partial<WidgetViewProps> {
  const [state, setState] = useState({
    session,
    data: emptySnapshot,
    loadState: "loading" as "loading" | "ready" | "error",
  });
  const [connection, setConnection] = useState<"online" | "reconnecting">(
    "online",
  );
  const send = writes(api);
  const abort = useRef(new AbortController());
  const boardId = useRef<string | undefined>(undefined);
  const current = state.session === session;
  const data = useRef(state.data);
  data.current = current ? state.data : emptySnapshot;
  const events = useRef(host);
  events.current = host;
  const page = useRef(context);
  page.current = context;
  /** A retry sends the files that an earlier attempt uploaded, so its idempotency key still fits. */
  const uploaded = useRef(new WeakMap<File, string>());
  const unread = useRef(-1);
  /** Unread changelog updates; the launcher badge shows them with the unread replies. */
  const updatesUnread = useRef(0);
  const badge = () =>
    events.current.unread(Math.max(0, unread.current) + updatesUnread.current);
  /** The threads are loaded; until then a poll only reports the unread count. */
  const loaded = useRef(false);
  /** The unread count changed since the threads were last read. */
  const stale = useRef(false);

  const patch = (signal: AbortSignal, change: (data: Snapshot) => Snapshot) => {
    if (!signal.aborted)
      setState((value) => ({ ...value, data: change(value.data) }));
  };
  const updatePost = (
    signal: AbortSignal,
    id: string,
    change: (post: FeedbackPost) => FeedbackPost,
  ) =>
    patch(signal, (value) => ({
      ...value,
      feedback: value.feedback.map((post) =>
        post.id === id ? change(post) : post,
      ),
    }));
  /** Runs one call for the current session; a 401 ends the session. */
  const run = async <T>(work: (signal: AbortSignal) => Promise<T>) => {
    const signal = abort.current.signal;
    try {
      return await work(signal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && !signal.aborted)
        events.current.expired(session);
      throw error;
    }
  };
  const reportUnread = async (signal: AbortSignal) => {
    const { unreadCount } = await send.unread(signal);
    if (!signal.aborted && unreadCount !== unread.current) {
      unread.current = unreadCount;
      badge();
    }
    return unreadCount;
  };
  // ponytail: read once per session and after a mark, not polled; updates ship rarely.
  const reportUpdatesUnread = async (signal: AbortSignal) => {
    const { count } = await send.updatesUnread(signal);
    if (!signal.aborted) {
      updatesUnread.current = count;
      badge();
    }
  };
  const load = (signal: AbortSignal) =>
    run(async () => {
      if (board && surfaces.feedback && boardId.current === undefined)
        boardId.current =
          (await resolveBoard(api, board, signal).catch((error) => {
            if (!unavailable(error)) throw error;
          })) ?? "";
      // Read the count first: a reply that lands during the load makes the next poll read again.
      if (surfaces.messenger)
        await reportUnread(signal).catch((error) => {
          if (!unavailable(error)) throw error;
        });
      const next = await loadSnapshot(
        api,
        { surfaces, locale, boardId: boardId.current || undefined },
        signal,
      );
      if (!signal.aborted) {
        setState({ session, data: next, loadState: "ready" });
        loaded.current = true;
        stale.current = false;
      }
    }).catch((error) => {
      if (!signal.aborted) {
        setState((value) => ({ ...value, loadState: "error" }));
        throw error;
      }
    });
  const sent = (signal: AbortSignal, result: Sent) =>
    patch(signal, (value) => {
      const known = value.conversations.find(
        (item) => item.id === result.conversation.id,
      );
      return {
        ...value,
        conversations: upsert(
          value.conversations,
          {
            ...toConversation(result.conversation, []),
            messages: mergeMessages(known?.messages ?? [], [
              toMessage(result.message),
            ]),
          },
          "end",
        ),
      };
    });

  useEffect(() => {
    if (session === null) return;
    const controller = new AbortController();
    abort.current = controller;
    unread.current = -1;
    updatesUnread.current = 0;
    loaded.current = false;
    stale.current = false;
    if (active) {
      setState({ session, data: emptySnapshot, loadState: "loading" });
      void load(controller.signal).catch(() => {});
    }
    if (surfaces.changelog)
      void reportUpdatesUnread(controller.signal).catch(() => {});
    if (!surfaces.messenger) return () => controller.abort();
    if (!active) void reportUnread(controller.signal).catch(() => {});
    // No push channel for widget visitors: poll the unread count, then read only what changed.
    const timer = setInterval(() => {
      if (
        document.visibilityState === "hidden" ||
        (loaded.current && !data.current.available.messenger)
      )
        return;
      void (async () => {
        const before = unread.current;
        if ((await reportUnread(controller.signal)) !== before)
          stale.current = true;
        if (loaded.current && stale.current) {
          const threads = await syncConversations(
            api,
            data.current.conversations,
            controller.signal,
          );
          // Keep what the visitor sent while the sync ran: merge, never replace.
          patch(controller.signal, (value) => ({
            ...value,
            conversations: [
              ...threads.map((thread) => {
                const now = value.conversations.find(
                  (item) => item.id === thread.id,
                );
                return now
                  ? {
                      ...thread,
                      messages: mergeMessages(now.messages, thread.messages),
                    }
                  : thread;
              }),
              ...value.conversations.filter(
                (item) => !threads.some((thread) => thread.id === item.id),
              ),
            ],
          }));
          stale.current = false;
        }
        if (!controller.signal.aborted) setConnection("online");
      })().catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401)
          events.current.expired(session);
        else if (error instanceof ApiError && error.status === 0)
          setConnection("reconnecting");
      });
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
    // A new session or the first open restarts this; the other inputs are fixed per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, active]);

  // Actions only for surfaces that loaded: a denied surface stays hidden instead of failing.
  const { available, ...snapshot } = current ? state.data : emptySnapshot;
  return {
    ...snapshot,
    loadState: current ? state.loadState : "loading",
    connection,
    onRetryLoad: () => load(abort.current.signal),
    // Lists leave out discussions and article bodies, and a deep link can point past the
    // first page: read the item when it opens.
    onOpenItem: (tab: WidgetTab, id: string) => {
      if (tab === "feedback" && available.feedback)
        void run(async (signal) => {
          const post = await loadPost(api, id, signal);
          if (post)
            patch(signal, (value) => ({
              ...value,
              feedback: upsert(value.feedback, post, "start"),
            }));
        }).catch(() => {});
      if (
        tab === "updates" &&
        available.changelog &&
        !data.current.updates.some((item) => item.id === id)
      )
        void run(async (signal) => {
          const entry = await loadUpdate(api, id, signal);
          patch(signal, (value) => ({
            ...value,
            updates: upsert(value.updates, entry, "end"),
          }));
        }).catch(() => {});
      if (tab === "help" && available.help)
        void run(async (signal) => {
          const article = await loadArticle(api, id, locale, signal);
          patch(signal, (value) => ({
            ...value,
            articles: upsert(value.articles, article, "start"),
          }));
        }).catch(() => {});
    },
    ...(available.feedback && {
      onSubmitFeedback: (body: string, options: SubmissionOptions) =>
        run(async (signal) => {
          const attachmentIds: string[] = [];
          for (const file of options.attachments ?? []) {
            let id = uploaded.current.get(file);
            if (!id) {
              id = await uploadImage(api, file, signal);
              uploaded.current.set(file, id);
            }
            attachmentIds.push(id);
          }
          const created = await send.createPost(
            // A post needs a title: a screenshot alone gets a plain one.
            body || (attachmentIds.length ? "Screenshot" : body),
            options.idempotencyKey,
            boardId.current || undefined,
            signal,
            {
              attachmentIds,
              metadata: postMetadata(page.current, navigator.userAgent),
            },
          );
          const post = toPost(created);
          if (post)
            patch(signal, (value) => ({
              ...value,
              feedback: upsert(value.feedback, post, "start"),
            }));
          events.current.event("post:created", {
            id: created.id,
            title: created.title,
            board: created.board,
            statusId: created.status?.id ?? null,
          });
        }),
      onVoteFeedback: (postId: string, voted: boolean) =>
        run(async (signal) => {
          const result = await send.vote(postId, voted, signal);
          updatePost(signal, postId, (post) => ({
            ...post,
            voted: result.voted,
            votes: result.voteCount,
          }));
          events.current.event("vote", {
            postId,
            voted: result.voted,
            voteCount: result.voteCount,
          });
        }),
      onFollowFeedback: (postId: string, following: boolean) =>
        run(async (signal) => {
          const result = await send.follow(postId, following, signal);
          updatePost(signal, postId, (post) => ({
            ...post,
            following: result.following,
          }));
        }),
      onCommentFeedback: (
        postId: string,
        body: string,
        options: SubmissionOptions & { parentId?: string },
      ) =>
        run(async (signal) => {
          const created = await send.comment(
            postId,
            body,
            options.idempotencyKey,
            options.parentId,
            signal,
          );
          updatePost(signal, postId, (post) => ({
            ...post,
            comments: upsert(post.comments ?? [], toComment(created), "end"),
          }));
          events.current.event("comment:created", {
            postId,
            commentId: created.id,
            parentId: created.parentId,
          });
        }),
      onVoteComment: (postId: string, commentId: string, voted: boolean) =>
        run(async (signal) => {
          const { reactions } = await send.voteComment(
            commentId,
            voted,
            signal,
          );
          const vote = reactions.find((item) => item.emoji === VOTE_EMOJI);
          updatePost(signal, postId, (post) => ({
            ...post,
            comments: post.comments?.map((comment) =>
              comment.id === commentId
                ? {
                    ...comment,
                    votes: vote?.count ?? 0,
                    voted: vote?.reacted ?? false,
                  }
                : comment,
            ),
          }));
        }),
    }),
    ...(available.changelog && {
      onReactToUpdate: (entryId: string, emoji: string) =>
        run(async (signal) => {
          const reacted = !data.current.updates
            .find((item) => item.id === entryId)
            ?.reactions?.find((reaction) => reaction.emoji === emoji)?.reacted;
          const result = await send.reactToUpdate(
            entryId,
            emoji,
            reacted,
            signal,
          );
          patch(signal, (value) => ({
            ...value,
            updates: value.updates.map((item) =>
              item.id === entryId
                ? { ...item, reactions: toReactions(result.reactions) }
                : item,
            ),
          }));
        }),
      // The read mark covers every update, so one read clears them all.
      onReadUpdate: () =>
        run(async (signal) => {
          await send.readUpdates(signal);
          patch(signal, (value) => ({
            ...value,
            updates: value.updates.map((item) => ({ ...item, unread: false })),
          }));
          await reportUpdatesUnread(signal);
        }),
    }),
    ...(available.help && {
      onArticleFeedback: (articleId: string, helpful: boolean) =>
        run(async (signal) => {
          const result = await send.articleFeedback(articleId, helpful, signal);
          patch(signal, (value) => ({
            ...value,
            articles: value.articles.map((article) =>
              article.id === articleId
                ? { ...article, helpful: result.helpful }
                : article,
            ),
          }));
        }),
    }),
    ...(available.messenger && {
      // ponytail: SubmissionOptions.articleId is dropped; the API has no article context field.
      onSendMessage: (body: string, options: SubmissionOptions) =>
        run(async (signal) =>
          sent(
            signal,
            await send.startConversation(body, options.idempotencyKey, signal),
          ),
        ),
      onReplyMessage: (
        conversationId: string,
        body: string,
        options: SubmissionOptions,
      ) =>
        run(async (signal) =>
          sent(
            signal,
            await send.reply(
              conversationId,
              body,
              options.idempotencyKey,
              signal,
            ),
          ),
        ),
      onReadConversation: (conversationId: string, throughMessageId: string) =>
        run(async (signal) => {
          const result = await send.markRead(
            conversationId,
            throughMessageId,
            signal,
          );
          patch(signal, (value) => ({
            ...value,
            conversations: value.conversations.map((item) =>
              item.id === conversationId
                ? { ...item, unreadCount: result.unreadCount }
                : item,
            ),
          }));
          await reportUnread(signal);
        }),
    }),
  };
}
