// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, isNull, sql } from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import { channelAccounts } from "../../database/quills/schema/channel-accounts";
import { channelIdentities } from "../../database/quills/schema/channel-identities";
import { channelThreads } from "../../database/quills/schema/channel-threads";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import {
  postExternalLinks,
  ticketExternalLinks,
} from "../../database/quills/schema/external-links";
import type { Database } from "../framework/define-route";
import { replayHorizon } from "../framework/signed";
import { preview } from "./conversation-model";
import { reopened } from "./conversation-ops";

// The GitHub inbox channel, inbound side (integrations/inbound.ts calls it in the signed webhook's
// transaction). While a live GitHub connection account names this integration, an opened issue or a
// new issue comment becomes a conversation message, a close or reopen sets the conversation status,
// and a comment edit or delete follows. The connected account's own comments, and comments that
// carry the outbound marker (jobs/handlers/github-comment.ts), are ours and are skipped; an edit or a
// delete changes only a customer's message, never a teammate reply that went out as a comment.
// Events older than the replay horizon change nothing.
// ponytail: a close and a reopen that arrive out of order leave the last one to commit; ordering them
// needs the issue's last remote state time on channel_threads (a migration).

type GitHubUser = { id?: number; login?: string; avatar_url?: string };
export type GitHubEvent = {
  action?: string;
  issue?: {
    number: number;
    updated_at?: string;
    title?: string;
    body?: string | null;
    user?: GitHubUser | null;
    pull_request?: object;
  };
  comment?: {
    id: number;
    body?: string;
    updated_at?: string;
    user?: GitHubUser | null;
  };
  repository?: { full_name?: string };
  sender?: GitHubUser | null;
};
export type InboxChange = {
  kind: "message" | "edited" | "deleted" | "closed" | "reopened";
  conversationId: string;
  /** The messages that this event stored or changed, oldest first. */
  messageIds: string[];
};
type ConversationId = (typeof conversations.$inferSelect)["id"];
type MessageId = (typeof conversationMessages.$inferSelect)["id"];

/** The marker that every outbound comment ends with. */
export const outboundMarker = (messageId: string) =>
  `<!-- kaneo:${messageId} -->`;
const OURS = /<!-- kaneo:conversation_msg_[0-9a-z]{26} -->/;

const sameLogin = (a?: string, b?: unknown) =>
  Boolean(a && typeof b === "string" && a.toLowerCase() === b.toLowerCase());
const body = (text: string | null | undefined) =>
  (text ?? "").trim().slice(0, 10_000);

/** The principal of a GitHub user: its channel identity, else a new unverified lead. */
async function sender(db: Database, user: GitHubUser) {
  const externalId = user.id === undefined ? "" : String(user.id);
  const known = async () =>
    externalId
      ? (
          await db
            .select({ id: channelIdentities.principalId })
            .from(channelIdentities)
            .where(
              and(
                eq(channelIdentities.channel, "github"),
                eq(channelIdentities.externalId, externalId),
              ),
            )
        )[0]?.id
      : undefined;
  const found = await known();
  if (found) return found;
  const avatar = user.avatar_url?.startsWith(
    "https://avatars.githubusercontent.com/",
  )
    ? user.avatar_url
    : null;
  const [lead] = await db
    .insert(principal)
    .values({
      role: "user",
      type: "anonymous",
      displayName: (user.login ?? "GitHub user").slice(0, 200),
      avatarUrl: avatar,
      createdAt: new Date(),
    })
    .returning({ id: principal.id });
  if (!externalId) return lead!.id;
  const linked = await db
    .insert(channelIdentities)
    .values({
      channel: "github",
      externalId,
      principalId: lead!.id,
      verified: false,
    })
    .onConflictDoNothing()
    .returning({ id: channelIdentities.principalId });
  if (linked.length) return lead!.id;
  // A concurrent delivery linked this user first: use its principal.
  await db.delete(principal).where(eq(principal.id, lead!.id));
  return (await known())!;
}

/** True when a tracker integration opened this issue for a post or a ticket: it is not support mail. */
async function trackerIssue(db: Database, externalId: string) {
  const [post] = await db
    .select({ id: postExternalLinks.id })
    .from(postExternalLinks)
    .where(
      and(
        eq(postExternalLinks.integrationType, "github"),
        eq(postExternalLinks.externalId, externalId),
      ),
    )
    .limit(1);
  if (post) return true;
  const [ticket] = await db
    .select({ id: ticketExternalLinks.id })
    .from(ticketExternalLinks)
    .where(
      and(
        eq(ticketExternalLinks.integrationType, "github"),
        eq(ticketExternalLinks.externalId, externalId),
      ),
    )
    .limit(1);
  return Boolean(ticket);
}

async function addMessage(
  db: Database,
  conversationId: ConversationId,
  from: string,
  content: string,
  metadata: Record<string, string>,
) {
  const [message] = await db
    .insert(conversationMessages)
    .values({
      conversationId,
      principalId: from as never,
      senderType: "visitor",
      content,
      metadata: { source: "github", ...metadata },
    })
    // conversation_messages_github_comment_id_idx: a comment is stored once.
    .onConflictDoNothing()
    .returning({
      id: conversationMessages.id,
      createdAt: conversationMessages.createdAt,
    });
  return message;
}

/** The issue's conversation, created with the issue's text as its first message when missing. */
async function issueConversation(
  db: Database,
  accountId: string,
  threadKey: string,
  issue: NonNullable<GitHubEvent["issue"]>,
) {
  const from = await sender(db, issue.user ?? {});
  const now = new Date();
  const content = body(issue.body) || body(issue.title) || "(issue)";
  const [created] = await db
    .insert(conversations)
    .values({
      visitorPrincipalId: from as never,
      channel: "github",
      source: "github",
      channelAccountId: accountId as never,
      subject: issue.title?.slice(0, 500) || null,
      lastMessagePreview: preview(content),
      lastMessageAt: now,
      waitingSince: now,
    })
    .returning({ id: conversations.id });
  const thread = await db
    .insert(channelThreads)
    .values({
      channelAccountId: accountId as never,
      externalThreadKey: threadKey,
      conversationId: created!.id,
    })
    .onConflictDoNothing()
    .returning({ id: channelThreads.id });
  if (!thread.length) {
    // A concurrent delivery opened this issue's conversation first.
    await db.delete(conversations).where(eq(conversations.id, created!.id));
    return { id: await threadConversation(db, accountId, threadKey) };
  }
  const message = await addMessage(db, created!.id, from, content, {
    githubIssueNumber: String(issue.number),
  });
  return { id: created!.id, messageId: message?.id ?? null };
}

async function threadConversation(
  db: Database,
  accountId: string,
  threadKey: string,
) {
  const [thread] = await db
    .select({ id: channelThreads.conversationId })
    .from(channelThreads)
    .where(
      and(
        eq(channelThreads.channelAccountId, accountId as never),
        eq(channelThreads.externalThreadKey, threadKey),
      ),
    );
  return thread?.id;
}

/** Applies one GitHub `issues` or `issue_comment` event to the inbox. Null when it changes nothing. */
export async function ingestGitHub(
  db: Database,
  connection: { integrationId: string; config: Record<string, unknown> },
  event: GitHubEvent,
): Promise<InboxChange | null> {
  const issue = event.issue;
  const repo = event.repository?.full_name;
  if (!issue || issue.pull_request || !repo) return null;
  // Older than the receipts: possibly a replay that the receipt store forgot.
  const at = Date.parse(event.comment?.updated_at ?? issue.updated_at ?? "");
  if (at < replayHorizon().getTime()) return null;
  const [account] = await db
    .select({ id: channelAccounts.id, config: channelAccounts.config })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channel, "github"),
        eq(channelAccounts.role, "connection"),
        isNull(channelAccounts.deletedAt),
      ),
    )
    .limit(1);
  if (account?.config.integrationId !== connection.integrationId) return null;
  const bot = connection.config.account;
  const threadKey = `${repo}#${issue.number}`;
  const existing = await threadConversation(db, account.id, threadKey);
  const comment = event.comment;
  if (!comment) {
    if (event.action === "opened") {
      if (existing || sameLogin(issue.user?.login, bot)) return null;
      const opened = await issueConversation(db, account.id, threadKey, issue);
      return opened.messageId
        ? {
            kind: "message",
            conversationId: opened.id!,
            messageIds: [opened.messageId],
          }
        : null;
    }
    if (!existing || !["closed", "reopened"].includes(event.action ?? ""))
      return null;
    const status = event.action === "closed" ? "closed" : "open";
    const now = new Date();
    const [conversation] = await db
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, existing))
      .for("update");
    if (!conversation || conversation.status === status) return null;
    await db
      .update(conversations)
      .set({
        status,
        ...reopened(conversation as Parameters<typeof reopened>[0], status),
        resolvedAt: status === "closed" ? now : null,
        snoozedUntil: null,
        waitingSince: status === "closed" ? null : now,
        updatedAt: now,
      })
      .where(eq(conversations.id, existing));
    return {
      kind: status === "closed" ? "closed" : "reopened",
      conversationId: existing,
      messageIds: [],
    };
  }
  const commentId = String(comment.id);
  const [stored] = await db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      senderType: conversationMessages.senderType,
    })
    .from(conversationMessages)
    .where(
      and(
        sql`${conversationMessages.metadata} ->> 'githubCommentId' = ${commentId}`,
        isNull(conversationMessages.deletedAt),
      ),
    )
    .for("update");
  if (event.action === "edited" || event.action === "deleted") {
    // A teammate reply that went out as this comment stays as the teammate wrote it.
    if (!stored?.conversationId || stored.senderType !== "visitor") return null;
    const now = new Date();
    await db
      .update(conversationMessages)
      .set(
        event.action === "deleted"
          ? { deletedAt: now, updatedAt: now }
          : {
              content: body(comment.body) || "(comment)",
              editedAt: now,
              updatedAt: now,
            },
      )
      .where(eq(conversationMessages.id, stored.id as MessageId));
    return {
      kind: event.action,
      conversationId: stored.conversationId,
      messageIds: [stored.id],
    };
  }
  const author = comment.user ?? event.sender ?? {};
  if (
    event.action !== "created" ||
    stored ||
    sameLogin(author.login, bot) ||
    OURS.test(comment.body ?? "")
  )
    return null;
  let conversationId = existing;
  const messageIds: string[] = [];
  if (!conversationId) {
    if (
      sameLogin(issue.user?.login, bot) ||
      (await trackerIssue(db, threadKey))
    )
      return null;
    const opened = await issueConversation(db, account.id, threadKey, issue);
    conversationId = opened.id;
    if (opened.messageId) messageIds.push(opened.messageId);
  }
  if (!conversationId) return null;
  const content = body(comment.body) || "(comment)";
  const message = await addMessage(
    db,
    conversationId,
    await sender(db, author),
    content,
    { githubCommentId: commentId, githubIssueNumber: String(issue.number) },
  );
  if (!message) return null;
  // A comment on a closed issue does not reopen the conversation, as in the source.
  await db
    .update(conversations)
    .set({
      lastMessageAt: message.createdAt,
      lastMessagePreview: preview(content),
      waitingSince: sql`case when ${conversations.status} = 'closed' then ${conversations.waitingSince} else coalesce(${conversations.waitingSince}, now()) end`,
      updatedAt: message.createdAt,
    })
    .where(eq(conversations.id, conversationId));
  return {
    kind: "message",
    conversationId,
    messageIds: [...messageIds, message.id],
  };
}
