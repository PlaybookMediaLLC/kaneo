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
import {
  sendNewCommentEmail,
  sendPortalInviteEmail,
  sendPostUpdateEmail,
  sendStatusChangeEmail,
  sendVerifyAddressEmail,
  type EmailResult,
  type SealedEmail,
} from "@kaneo/email/quills";
import type { InviteId, PostCommentId, PostId, PrincipalId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../database/quills/client";
import { principal, settings } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { events, type EventRow } from "../../database/quills/schema/events";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { postUpdates } from "../../database/quills/schema/post-updates";
import { postComments, posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { webhooks } from "../../database/quills/schema/webhooks";
import { enqueueWorkflowRuns } from "../automation/engine";
import { assistantWork } from "../assistant/engine/index";
import { seesBoard } from "../feedback/visibility";
import {
  accessibleProjectIds,
  quillsReaders,
} from "../framework/platform-reads";
import { pendingCode } from "../widget/contact-email";
import { inviteUrl, mintInviteToken } from "../portal/invite-token";
import { portalPaths } from "../portal/paths";
import {
  mintUnsubscribeToken,
  unsubscribePageUrl,
  unsubscribeUrl,
} from "../portal/unsubscribe-token";
import { crmNoteDue } from "../integrations/crm-notes";
import { taskRuleDue } from "../integrations/task-rule-job";
import { updateMailDue } from "./handlers/update-mail";
import { taskFailureMessages } from "../integrations/post-task";
import type { TaskFailure } from "../framework/platform-reads";
import { githubCommentDue } from "./handlers/github-comment";
import { shippedSubscribers } from "./handlers/shipped-mail";
import { statusSubscribers } from "./handlers/status-mail";
import { supportSubscribers } from "./handlers/support-mail";
import {
  enqueueQuillsJob,
  enqueueQuillsJobs,
  type QuillsJobInput,
  type QuillsQueue,
} from "./queue";
import { postReplyAddress } from "../framework/signed";
import { recipientDirection } from "./handlers/recipient-language";

/** Event type → the queue whose handler does the requested work after commit. */
export const eventQueues: Partial<Record<string, QuillsQueue>> = {
  "custom_domain.verification_requested": "quills.domain_check",
  "workspace.wipe_requested": "quills.wipe",
  "export.requested": "quills.transfer",
  "import.requested": "quills.transfer",
  // Assistant work (assistant/engine/index.ts). Without a provider the job finishes with no work.
  ...Object.fromEntries(
    Object.keys(assistantWork).map((type) => [type, "quills.ai" as const]),
  ),
};

export type DeliveryEvent = Pick<
  EventRow,
  | "eventId"
  | "type"
  | "entityType"
  | "entityId"
  | "actorId"
  | "actorType"
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
  /** A comment mail: a customer recipient gets it only while the comment is one they may read. */
  commentId?: PostCommentId;
  /** Direct mail only: the one address the event concerns, for example an invitee. */
  to?: string;
  /**
   * A customer recipient's address, decided at send time outside the transaction. Without it a
   * customer gets post mail through handlers/support-mail.ts#customerPostAddress.
   */
  customerAddress?: (
    workspaceId: string,
    principalId: PrincipalId,
  ) => Promise<string | undefined>;
  /**
   * The delivery ledger key when one send must cover more than this event, for example one CSAT
   * request per conversation. Default `mail:{eventId}:{recipient}`.
   */
  ledgerKey?: string;
  /** Recorded on the `email_log` row. */
  conversationId?: string;
  /**
   * Loads what `send` needs (such as attachment bytes) outside any transaction and before the
   * delivery claim. A throw fails the job, so it retries; a throw inside `send` would leave the
   * mail uncertain and never sent again.
   */
  prepare?: () => Promise<void>;
  /** Uses only values read before it is returned, never the transaction. */
  send: (to: string) => Promise<EmailResult>;
};
export type Subscribers = {
  /**
   * Principals to tell and the post they hear about. Delivery keeps current teammates who can see the post
   * (and customers, by mail, when `customers` is set), never the actor.
   */
  recipients: (
    db: Database,
    event: DeliveryEvent,
  ) => Promise<{ principalIds: PrincipalId[]; postId?: PostId }>;
  /**
   * Mail goes to the one address that `mail` returns in `to`, not to principals. A function
   * decides at fan-out whether this event has such mail at all.
   */
  direct?: true | ((db: Database, event: DeliveryEvent) => Promise<boolean>);
  /** Seconds the direct mail job waits before it runs; `mail` decides again when it does. */
  directDelay?: (db: Database, event: DeliveryEvent) => Promise<number>;
  /**
   * Direct mail about other messages than the event's own: one mail job per message ID returned,
   * for example the copies a tracker's reply-all wrote on its linked tickets. `mail` gets the
   * message ID as its `target`; the mail handler checks again that this returns it.
   */
  copies?: (
    db: Database,
    event: DeliveryEvent,
    /** Check this one message only (a copy mail job). */
    only?: string,
  ) => Promise<string[]>;
  /**
   * Customers among the recipients are mailed too (no in-app notice). The mail handler decides at
   * send time whether the customer may still see the post (handlers/support-mail.ts), or asks
   * the content's `customerAddress`.
   */
  customers?: true;
  notification?: (
    db: Database,
    event: DeliveryEvent,
  ) => Promise<NotificationContent | undefined>;
  /**
   * Called once per recipient, with its principal, once with null for a direct entry, and once
   * per copy with null and the copy's message ID.
   */
  mail?: (
    db: Database,
    event: DeliveryEvent,
    principalId: PrincipalId | null,
    target?: string,
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
    .select({
      id: posts.id,
      title: posts.title,
      statusId: posts.statusId,
      authorId: posts.principalId,
    })
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
      authorKaneoUserId: principal.kaneoUserId,
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

/** The workspace's Kaneo ID and display name. */
async function workspaceOf(db: Database) {
  const [row] = await db
    .select({
      id: settings.workspaceId,
      name: settings.name,
      slug: settings.slug,
    })
    .from(settings)
    .limit(1);
  return row;
}

const postUrl = (workspaceId: string, postId: string) =>
  portalPaths.post(workspaceId, postId);

/** An invite mail with a new link. `withMessage`: the sender's note goes with the first send only. */
const inviteMail =
  (withMessage: boolean): NonNullable<Subscribers["mail"]> =>
  async (db, event) => {
    // ponytail: a replay of a finished delivery also mints a token it never sends; at most 20 stay valid.
    const minted = await mintInviteToken(db, event.entityId as InviteId);
    const workspace = minted && (await workspaceOf(db));
    if (!minted || !workspace) return undefined;
    const inviteLink = inviteUrl(workspace.id, event.entityId, minted.token);
    return {
      type: "portal_invite",
      emailType: "PortalInviteEmail",
      to: minted.email,
      send: (to) =>
        sendPortalInviteEmail({
          // Sealed: the exact address the token was minted for, read from the invite row.
          to: to as SealedEmail,
          workspaceName: workspace.name,
          inviteLink,
          personalMessage: withMessage
            ? (minted.message ?? undefined)
            : undefined,
        }),
    };
  };

const noRecipients = async () => ({ principalIds: [] as PrincipalId[] });

/**
 * Event type → who hears about it in-app and by mail. Webhooks need no entry: each webhook lists its event types.
 * The post entries read the post from `entityId` (entity `post`) or `payload.postId`, and the comment from
 * `entityId` (entity `comment`) or `payload.commentId`.
 */
export const subscribers: Partial<Record<string, Subscribers>> = {
  "post.status_changed": {
    recipients: postSubscribers("notifyStatusChanges"),
    customers: true,
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
    mail: async (db, event, principalId) => {
      const post = await livePost(db, postIdOf(event));
      const [status] = post?.statusId
        ? await db
            .select({ name: postStatuses.name })
            .from(postStatuses)
            .where(eq(postStatuses.id, post.statusId))
        : [];
      const workspace = await workspaceOf(db);
      if (!post || !status || !workspace || !principalId) return undefined;
      const token = await mintUnsubscribeToken(
        db,
        principalId,
        "unsubscribe_post",
        post.id,
      );
      const dir = await recipientDirection(db, principalId);
      return {
        type: "post_status_changed",
        emailType: "StatusChangeEmail",
        postId: post.id,
        send: (to) =>
          sendStatusChangeEmail({
            to,
            // A reply by mail becomes the subscriber's comment (inbound/email.ts).
            replyTo: postReplyAddress(workspace, post.id) ?? undefined,
            dir,
            postTitle: post.title,
            postUrl: postUrl(workspace.id, post.id),
            // The event records only the new status.
            previousStatus: "",
            newStatus: status.name,
            workspaceName: workspace.name,
            unsubscribeUrl: unsubscribePageUrl(workspace.id, token),
            oneClickUnsubscribeUrl: unsubscribeUrl(workspace.id, token),
            // Only the author reads "your feedback"; a follower gets their own copy.
            yours: post.authorId === principalId,
          }),
      };
    },
  },
  "comment.created": {
    recipients: postSubscribers("notifyComments"),
    customers: true,
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
    mail: async (db, event, principalId) => {
      // An update's page comment (#92): its own mail went to the followers that the sender chose.
      if (payloadOf(event).update) return undefined;
      const comment = await liveComment(db, event);
      const post = comment && (await livePost(db, comment.postId));
      const workspace = await workspaceOf(db);
      if (!comment || !post || !workspace || !principalId) return undefined;
      const token = await mintUnsubscribeToken(
        db,
        principalId,
        "unsubscribe_post",
        post.id,
      );
      const dir = await recipientDirection(db, principalId);
      return {
        type: "comment_created",
        emailType: "NewCommentEmail",
        postId: post.id,
        commentId: comment.id,
        send: (to) =>
          sendNewCommentEmail({
            to,
            replyTo: postReplyAddress(workspace, post.id) ?? undefined,
            dir,
            postTitle: post.title,
            postUrl: postUrl(workspace.id, post.id),
            commenterName: comment.author ?? "Someone",
            commentPreview: clip(comment.content, 150),
            isTeamMember: comment.authorKaneoUserId !== null,
            workspaceName: workspace.name,
            unsubscribeUrl: unsubscribePageUrl(workspace.id, token),
            oneClickUnsubscribeUrl: unsubscribeUrl(workspace.id, token),
          }),
      };
    },
  },
  // RFC 0005, 5.2: only the teammate whose status change the board rule could not turn into a task.
  "post.task_create_failed": {
    recipients: async (_db, event) => {
      const { principalId } = payloadOf(event);
      return {
        principalIds: principalId ? [principalId as PrincipalId] : [],
        postId: postIdOf(event),
      };
    },
    notification: async (db, event) => {
      const post = await livePost(db, postIdOf(event));
      const reason = payloadOf(event).reason as TaskFailure | undefined;
      if (!post || !reason || !(reason in taskFailureMessages))
        return undefined;
      return {
        type: "task_create_failed",
        title: clip(`No task was created for "${post.title}"`, 255),
        body: clip(taskFailureMessages[reason], 500),
        postId: post.id,
      };
    },
  },
  // #92: handlers/update-mail.ts queues the followers' mail jobs in pages; this entry writes each mail.
  "post.update_sent": {
    recipients: noRecipients,
    customers: true,
    mail: async (db, event, principalId) => {
      const [update] = await db
        .select({ postId: postUpdates.postId, body: postUpdates.body })
        .from(postUpdates)
        .where(eq(postUpdates.id, payloadOf(event).updateId ?? ""));
      const post = update && (await livePost(db, update.postId));
      const workspace = await workspaceOf(db);
      if (!update || !post || !workspace || !principalId) return undefined;
      const token = await mintUnsubscribeToken(
        db,
        principalId,
        "unsubscribe_post",
        post.id,
      );
      return {
        type: "post_update",
        emailType: "PostUpdateEmail",
        postId: post.id,
        send: (to) =>
          sendPostUpdateEmail({
            to,
            postTitle: post.title,
            postUrl: postUrl(workspace.id, post.id),
            body: update.body,
            workspaceName: workspace.name,
            unsubscribeUrl: unsubscribePageUrl(workspace.id, token),
            oneClickUnsubscribeUrl: unsubscribeUrl(workspace.id, token),
          }),
      };
    },
  },
  "portal.invite_sent": {
    recipients: noRecipients,
    direct: true,
    mail: inviteMail(true),
  },
  "portal.invite_resent": {
    recipients: noRecipients,
    direct: true,
    mail: inviteMail(false),
  },
  // An anonymous visitor's address code (widget/contact-email.ts): read from the live request at
  // send time, so a request that ended or was replaced mails its current state or nothing.
  "user.contact_email_code_requested": {
    recipients: noRecipients,
    direct: true,
    mail: async (db, event) => {
      const request = await pendingCode(
        db,
        payloadOf(event).purpose ?? "",
        event.entityId as PrincipalId,
      );
      const workspace = request && (await workspaceOf(db));
      if (!request || !workspace) return undefined;
      return {
        type: "contact_email_code",
        emailType: "VerifyAddressEmail",
        to: request.email,
        send: (to) =>
          sendVerifyAddressEmail({
            to,
            code: request.code,
            workspaceName: workspace.name,
          }),
      };
    },
  },
  ...supportSubscribers,
  ...statusSubscribers,
  ...shippedSubscribers,
};

export async function loadEvent(db: Database, eventId: string) {
  const [event] = await db
    .select({
      eventId: events.eventId,
      type: events.type,
      entityType: events.entityType,
      entityId: events.entityId,
      actorId: events.actorId,
      actorType: events.actorType,
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
    // Anti-spam guard (#320): spam-ended conversations or blocked visitors NEVER consume
    // AI tokens, trigger teammate notifications, or send outbound email/webhooks.
    if (
      event.type === "conversation.created" ||
      event.type === "message.created" ||
      event.type === "conversation.email_received"
    ) {
      const { conversationMessages, conversations } =
        await import("../../database/quills/schema/conversation");
      const { isSpamBlocked } = await import("../framework/anti-spam");
      const payload = (event.payload ?? {}) as Record<string, string>;
      let convId: string | null =
        event.entityType === "conversation"
          ? event.entityId
          : (payload.conversationId ?? null);
      if (!convId && event.entityType === "conversation_message") {
        const [msg] = await db
          .select({ conversationId: conversationMessages.conversationId })
          .from(conversationMessages)
          .where(eq(conversationMessages.id, event.entityId as never))
          .limit(1);
        convId = msg?.conversationId ?? null;
      }
      if (convId) {
        const [conv] = await db
          .select({
            endReason: conversations.endReason,
            visitorPrincipalId: conversations.visitorPrincipalId,
            visitorEmail: conversations.visitorEmail,
          })
          .from(conversations)
          .where(eq(conversations.id, convId as never))
          .limit(1);
        if (conv?.endReason === "spam") return undefined;
        if (conv?.visitorPrincipalId) {
          const [visitor] = await db
            .select({ blockedAt: principal.blockedAt })
            .from(principal)
            .where(eq(principal.id, conv.visitorPrincipalId))
            .limit(1);
          if (visitor?.blockedAt) return undefined;
        }
        if (conv && (conv.visitorPrincipalId || conv.visitorEmail)) {
          const blocked = await isSpamBlocked(db, {
            principalId: conv.visitorPrincipalId,
            email: conv.visitorEmail,
          });
          if (blocked.blocked) return undefined;
        }
      }
    }
    const queue = eventQueues[event.type];
    if (queue) await enqueueQuillsJob(db, queue, { eventId }, eventId, 3);
    // A reply on a GitHub conversation, or its retry, becomes an issue comment.
    if (await githubCommentDue(db, event))
      await enqueueQuillsJob(
        db,
        "quills.webhook",
        { eventId },
        `${eventId}:github`,
        5,
      );
    // RFC 0003 lane L6: a critical vote or a link to a CRM company becomes a CRM note.
    if (await crmNoteDue(db, event))
      await enqueueQuillsJob(
        db,
        "quills.webhook",
        { eventId, crm: "note" },
        `${eventId}:crm-note`,
        5,
      );
    await enqueueWorkflowRuns(db, event);
    // RFC 0005: a teammate's status change can create a Kaneo task or comment on the linked tasks.
    await taskRuleDue(db, event);
    // #92: an update's mail goes out in pages.
    await updateMailDue(db, event);
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
    // Teammates; customers follow below, by mail and in-app, for entries that set `customers`.
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
    // Customer subscribers; the mail handler decides at send time whether each may still see the post.
    const customers =
      entry?.customers && entry.mail && principalIds.length
        ? await db
            .select({ id: principal.id })
            .from(principal)
            .where(
              and(
                inArray(principal.id, principalIds),
                isNull(principal.kaneoUserId),
                isNull(principal.blockedAt),
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
    const direct =
      typeof entry?.direct === "function"
        ? await entry.direct(db, event)
        : Boolean(entry?.direct);
    return {
      hooks: hooks.map((hook) => hook.id),
      teammates: postId && !post ? [] : teammates,
      // An entry about a post mails customers only while the post is live.
      customers: postId && !post ? [] : customers.map((row) => row.id),
      links: links.map((link) => link.projectId),
      entry,
      direct,
      directDelay:
        direct && entry?.directDelay ? await entry.directDelay(db, event) : 0,
      copies: entry?.copies && entry.mail ? await entry.copies(db, event) : [],
    };
  });
  if (!plan) return;
  const readers = await quillsReaders(
    workspaceId,
    plan.teammates.map((teammate) => teammate.userId!),
  );
  const permittedTeammates = plan.teammates.filter((teammate) =>
    readers.has(teammate.userId!),
  );
  let recipients: string[];
  if (!plan.links.length) {
    recipients = permittedTeammates.map((teammate) => teammate.id);
  } else {
    // Bound concurrency so large subscriber lists never saturate the database pool.
    const ACCESS_BATCH = 5;
    recipients = [];
    for (let i = 0; i < permittedTeammates.length; i += ACCESS_BATCH) {
      const slice = permittedTeammates.slice(i, i + ACCESS_BATCH);
      const projectSets = await Promise.all(
        slice.map((teammate) =>
          accessibleProjectIds(workspaceId, teammate.userId!),
        ),
      );
      for (const [index, teammate] of slice.entries()) {
        if (seesBoard(projectSets[index]!, plan.links))
          recipients.push(teammate.id);
      }
    }
  }
  const direct = Boolean(plan.direct && plan.entry?.mail);
  if (
    !plan.hooks.length &&
    !recipients.length &&
    !plan.customers.length &&
    !plan.copies.length &&
    !direct
  )
    return;
  const jobs: QuillsJobInput[] = [];
  // The address is read at send time from the event's own record (for example the invite).
  if (direct)
    jobs.push({
      queue: "quills.mail",
      payload: { eventId },
      dedupeKey: `${eventId}:direct`,
      maxAttempts: 5,
      delaySeconds: plan.directDelay,
    });
  for (const messageId of plan.copies)
    jobs.push({
      queue: "quills.mail",
      payload: { eventId, messageId },
      dedupeKey: `${eventId}:${messageId}`,
      maxAttempts: 5,
    });
  for (const webhookId of plan.hooks)
    jobs.push({
      queue: "quills.webhook",
      payload: { eventId, webhookId },
      dedupeKey: `${eventId}:${webhookId}`,
      maxAttempts: 5,
    });
  for (const principalId of recipients) {
    if (plan.entry?.notification)
      jobs.push({
        queue: "quills.notification",
        payload: { eventId, principalId },
        dedupeKey: `${eventId}:${principalId}`,
        maxAttempts: 3,
      });
    // A direct entry mails its one address only; the mail handler refuses per-principal mail for it.
    if (plan.entry?.mail && !plan.entry.direct)
      jobs.push({
        queue: "quills.mail",
        payload: { eventId, principalId },
        dedupeKey: `${eventId}:${principalId}`,
        maxAttempts: 5,
      });
  }
  for (const principalId of plan.customers) {
    // The widget's activity feed reads these; it rechecks the post's visibility at read time.
    if (plan.entry?.notification)
      jobs.push({
        queue: "quills.notification",
        payload: { eventId, principalId },
        dedupeKey: `${eventId}:${principalId}`,
        maxAttempts: 3,
      });
    jobs.push({
      queue: "quills.mail",
      payload: { eventId, principalId },
      dedupeKey: `${eventId}:${principalId}`,
      maxAttempts: 5,
    });
  }
  if (!jobs.length) return;
  await withQuillsSystemWorkspace(workspaceId, (db) =>
    enqueueQuillsJobs(db, jobs),
  );
}
