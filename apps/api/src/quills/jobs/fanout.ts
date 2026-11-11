import {
  and,
  arrayContains,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
} from "drizzle-orm";
import type { EmailResult } from "@kaneo/email/quills";
import type { PostCommentId, PostId, PrincipalId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../database/quills/client";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { events, type EventRow } from "../../database/quills/schema/events";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { postComments, posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { webhooks } from "../../database/quills/schema/webhooks";
import { seesBoard } from "../feedback/visibility";
import {
  accessibleProjectIds,
  quillsReaders,
} from "../framework/platform-reads";
import { enqueueQuillsJob, type QuillsQueue } from "./queue";

/** Event type → the queue whose handler does the requested work after commit. */
export const eventQueues: Partial<Record<string, QuillsQueue>> = {
  "custom_domain.verification_requested": "quills.domain_check",
  "workspace.wipe_requested": "quills.wipe",
  "export.requested": "quills.transfer",
  "import.requested": "quills.transfer",
};

export type DeliveryEvent = Pick<
  EventRow,
  | "eventId"
  | "type"
  | "entityType"
  | "entityId"
  | "actorId"
  | "payload"
  | "context"
  | "occurredAt"
>;
export type NotificationContent = {
  /** Preference matrix key, for example `post_status_changed`. */
  type: string;
  title: string;
  body?: string;
  postId?: PostId;
  commentId?: PostCommentId;
};
export type MailContent = {
  /** Preference matrix key. */
  type: string;
  emailType: string;
  postId?: PostId;
  /** Uses only values read before it is returned, never the transaction. */
  send: (to: string) => Promise<EmailResult>;
};
export type Subscribers = {
  /** Principals to tell and the post they hear about. Delivery keeps only current teammates who can see the post, never the actor. */
  recipients: (
    db: Database,
    event: DeliveryEvent,
  ) => Promise<{ principalIds: PrincipalId[]; postId?: PostId }>;
  notification?: (
    db: Database,
    event: DeliveryEvent,
  ) => Promise<NotificationContent | undefined>;
  mail?: (
    db: Database,
    event: DeliveryEvent,
  ) => Promise<MailContent | undefined>;
};

const payloadOf = (event: DeliveryEvent) =>
  event.payload as Record<string, string | undefined>;
const postIdOf = (event: DeliveryEvent) =>
  (event.entityType === "post" ? event.entityId : payloadOf(event).postId) as
    | PostId
    | undefined;
const commentIdOf = (event: DeliveryEvent) =>
  (event.entityType === "comment"
    ? event.entityId
    : payloadOf(event).commentId) as PostCommentId | undefined;

async function livePost(db: Database, postId: PostId | undefined) {
  if (!postId) return undefined;
  const [post] = await db
    .select({ id: posts.id, title: posts.title, statusId: posts.statusId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  return post;
}

async function liveComment(db: Database, event: DeliveryEvent) {
  const commentId = commentIdOf(event);
  if (!commentId) return undefined;
  const [comment] = await db
    .select({
      id: postComments.id,
      postId: postComments.postId,
      content: postComments.content,
      isPrivate: postComments.isPrivate,
      author: principal.displayName,
    })
    .from(postComments)
    .innerJoin(principal, eq(principal.id, postComments.principalId))
    .where(and(eq(postComments.id, commentId), isNull(postComments.deletedAt)));
  return comment;
}

const postSubscribers =
  (flag: "notifyComments" | "notifyStatusChanges") =>
  async (db: Database, event: DeliveryEvent) => {
    const postId =
      flag === "notifyComments"
        ? (await liveComment(db, event))?.postId
        : postIdOf(event);
    if (!postId) return { principalIds: [] };
    const rows = await db
      .select({ principalId: postSubscriptions.principalId })
      .from(postSubscriptions)
      .where(
        and(
          eq(postSubscriptions.postId, postId),
          eq(postSubscriptions[flag], true),
        ),
      );
    return { principalIds: rows.map((row) => row.principalId), postId };
  };

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

/**
 * Event type → who hears about it in-app and by mail. Webhooks need no entry: each webhook lists its event types.
 * The post entries read the post from `entityId` (entity `post`) or `payload.postId`, and the comment from
 * `entityId` (entity `comment`) or `payload.commentId`.
 */
export const subscribers: Partial<Record<string, Subscribers>> = {
  "post.status_changed": {
    recipients: postSubscribers("notifyStatusChanges"),
    notification: async (db, event) => {
      const post = await livePost(db, postIdOf(event));
      if (!post?.statusId) return undefined;
      const [status] = await db
        .select({ name: postStatuses.name })
        .from(postStatuses)
        .where(eq(postStatuses.id, post.statusId));
      if (!status) return undefined;
      return {
        type: "post_status_changed",
        title: clip(`Status changed to ${status.name}`, 255),
        body: clip(`"${post.title}" moved to ${status.name}`, 500),
        postId: post.id,
      };
    },
  },
  "comment.created": {
    recipients: postSubscribers("notifyComments"),
    notification: async (db, event) => {
      const comment = await liveComment(db, event);
      if (!comment || !(await livePost(db, comment.postId))) return undefined;
      return {
        type: "comment_created",
        title: clip(`${comment.author ?? "Someone"} commented`, 255),
        body: clip(comment.content, 150),
        postId: comment.postId,
        commentId: comment.id,
      };
    },
  },
};

export async function loadEvent(db: Database, eventId: string) {
  const [event] = await db
    .select({
      eventId: events.eventId,
      type: events.type,
      entityType: events.entityType,
      entityId: events.entityId,
      actorId: events.actorId,
      payload: events.payload,
      context: events.context,
      occurredAt: events.occurredAt,
    })
    .from(events)
    .where(eq(events.eventId, eventId));
  return event;
}

/** The board an event is about, and whether it concerns a private comment. Deleted rows still count. */
async function placeOf(db: Database, event: DeliveryEvent) {
  const commentId = commentIdOf(event);
  const [comment] = commentId
    ? await db
        .select({
          postId: postComments.postId,
          isPrivate: postComments.isPrivate,
        })
        .from(postComments)
        .where(eq(postComments.id, commentId))
    : [];
  const postId = postIdOf(event) ?? comment?.postId;
  const [post] = postId
    ? await db
        .select({ boardId: posts.boardId })
        .from(posts)
        .where(eq(posts.id, postId))
    : [];
  return {
    boardId: event.entityType === "board" ? event.entityId : post?.boardId,
    isPrivate: Boolean(comment?.isPrivate),
  };
}

/**
 * Enqueues one job per webhook and per recipient. Deduplication keys make a rerun enqueue nothing new.
 * Events recorded before delivery existed carry no `deliver` mark and are never delivered.
 */
export async function fanOut(workspaceId: string, eventId: string) {
  const plan = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    if (!event || (event.context as { deliver?: unknown }).deliver !== true)
      return undefined;
    const queue = eventQueues[event.type];
    if (queue) await enqueueQuillsJob(db, queue, { eventId }, eventId, 3);
    // Private comments stay inside the workspace. A board filter applies only to events about a board.
    const { boardId, isPrivate } = await placeOf(db, event);
    const hooks = isPrivate
      ? []
      : (
          await db
            .select({ id: webhooks.id, boardIds: webhooks.boardIds })
            .from(webhooks)
            .where(
              and(
                eq(webhooks.status, "active"),
                isNull(webhooks.deletedAt),
                arrayContains(webhooks.events, [event.type]),
                // A webhook hears only events that happened after it existed.
                lte(webhooks.createdAt, event.occurredAt),
              ),
            )
        ).filter(
          (hook) =>
            !hook.boardIds?.length ||
            !boardId ||
            hook.boardIds.includes(boardId),
        );
    const entry = subscribers[event.type];
    const wanted = entry && (entry.notification || entry.mail);
    const { principalIds, postId } = wanted
      ? await entry.recipients(db, event)
      : { principalIds: [] };
    // Customers wait for the portal audience; only teammates are told today.
    const teammates = principalIds.length
      ? await db
          .select({ id: principal.id, userId: principal.kaneoUserId })
          .from(principal)
          .where(
            and(
              inArray(principal.id, principalIds),
              isNotNull(principal.kaneoUserId),
              ...(event.actorId
                ? [ne(principal.id, event.actorId as PrincipalId)]
                : []),
            ),
          )
      : [];
    const post = postId
      ? (
          await db
            .select({ boardId: posts.boardId })
            .from(posts)
            .innerJoin(boards, eq(boards.id, posts.boardId))
            .where(
              and(
                eq(posts.id, postId),
                isNull(posts.deletedAt),
                isNull(boards.deletedAt),
              ),
            )
        )[0]
      : undefined;
    const links = post
      ? await db
          .select({ projectId: boardProjects.projectId })
          .from(boardProjects)
          .where(eq(boardProjects.boardId, post.boardId))
      : [];
    return {
      hooks: hooks.map((hook) => hook.id),
      teammates: postId && !post ? [] : teammates,
      links: links.map((link) => link.projectId),
      entry,
    };
  });
  if (!plan) return;
  const readers = await quillsReaders(
    workspaceId,
    plan.teammates.map((teammate) => teammate.userId!),
  );
  const recipients: string[] = [];
  // ponytail: one project-access query per teammate; batch it if posts gain many teammate subscribers.
  for (const teammate of plan.teammates)
    if (
      readers.has(teammate.userId!) &&
      seesBoard(
        plan.links.length
          ? await accessibleProjectIds(workspaceId, teammate.userId!)
          : [],
        plan.links,
      )
    )
      recipients.push(teammate.id);
  if (!plan.hooks.length && !recipients.length) return;
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    for (const webhookId of plan.hooks)
      await enqueueQuillsJob(
        db,
        "quills.webhook",
        { eventId, webhookId },
        `${eventId}:${webhookId}`,
        5,
      );
    for (const principalId of recipients) {
      if (plan.entry?.notification)
        await enqueueQuillsJob(
          db,
          "quills.notification",
          { eventId, principalId },
          `${eventId}:${principalId}`,
          3,
        );
      if (plan.entry?.mail)
        await enqueueQuillsJob(
          db,
          "quills.mail",
          { eventId, principalId },
          `${eventId}:${principalId}`,
          5,
        );
    }
  });
}
