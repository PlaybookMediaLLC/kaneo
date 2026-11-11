import { and, eq, sql } from "drizzle-orm";
import { isTypeId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { channelAccounts } from "../../../database/quills/schema/channel-accounts";
import { channelThreads } from "../../../database/quills/schema/channel-threads";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { events } from "../../../database/quills/schema/events";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import { integrations } from "../../../database/quills/schema/integrations";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import type { ChannelDelivery } from "../../../database/quills/types";
import {
  openCredentials,
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { outboundMarker } from "../../support/github-ingest";
import { claimDelivery, settleDelivery } from "../ledger";
import { eventPayloadSchema, finishQuillsJob } from "../queue";

// The GitHub inbox channel, outbound side (quills.webhook). A teammate's reply on a GitHub
// conversation becomes one issue comment. The hook_deliveries receipt is written before the send:
// a rerun, a lost lease or an expired lease never posts the same reply twice, and an attempt that
// stopped after its claim is uncertain. Each comment ends with a marker, so a teammate's retry first
// lists the issue's comments and finds a comment that an uncertain attempt did post.

type MessageId = (typeof conversationMessages.$inferSelect)["id"];
const UNCERTAIN =
  "The comment may have reached GitHub. Check the issue, then retry.";
const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "Quills",
  "x-github-api-version": "2022-11-28",
});
const failure = (status: number) =>
  status === 401
    ? "Authentication failed. Reconnect GitHub."
    : status === 404 || status === 410
      ? "The repository or issue is not available."
      : status === 422
        ? "GitHub rejected the comment."
        : "GitHub refused the request. Try again later.";

/** True when the event's reply goes to GitHub: a teammate's reply on a GitHub conversation, or a retry. */
export async function githubCommentDue(
  db: Database,
  event: { type: string; entityType: string; entityId: string },
) {
  if (event.type === "github_inbox.message_retried") return true;
  if (
    event.type !== "message.created" ||
    !isTypeId(event.entityId, "conversation_msg")
  )
    return false;
  const [row] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .where(
      and(
        eq(conversationMessages.id, event.entityId),
        eq(conversations.channel, "github"),
        eq(conversationMessages.senderType, "agent"),
        eq(conversationMessages.isInternal, false),
      ),
    );
  return Boolean(row);
}

/** Records the delivery state on the message, as the inbox shows it. */
async function mark(
  db: Database,
  messageId: MessageId,
  delivery: Pick<ChannelDelivery, "status" | "externalId" | "error">,
) {
  const patch = {
    channelDelivery: {
      channel: "github",
      at: new Date().toISOString(),
      ...delivery,
    },
    ...(delivery.externalId && {
      source: "github",
      githubCommentId: delivery.externalId,
    }),
  };
  await db
    .update(conversationMessages)
    .set({
      metadata: sql`coalesce(${conversationMessages.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(conversationMessages.id, messageId));
}

type Target = {
  integrationId: (typeof integrations.$inferSelect)["id"];
  token: string;
  repo: string;
  number: string;
  body: string;
  since: string;
};

/** The issue and the token for a live agent reply on a GitHub conversation, or why it cannot go. */
async function resolve(
  db: Database,
  messageId: MessageId,
): Promise<Target | { error: string } | undefined> {
  const [row] = await db
    .select({
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
      deletedAt: conversationMessages.deletedAt,
      senderType: conversationMessages.senderType,
      isInternal: conversationMessages.isInternal,
      channel: conversations.channel,
      threadKey: channelThreads.externalThreadKey,
      accountConfig: channelAccounts.config,
      accountDeletedAt: channelAccounts.deletedAt,
    })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .leftJoin(
      channelThreads,
      eq(channelThreads.conversationId, conversations.id),
    )
    .leftJoin(
      channelAccounts,
      eq(channelAccounts.id, channelThreads.channelAccountId),
    )
    .where(eq(conversationMessages.id, messageId))
    .limit(1);
  if (
    !row ||
    row.deletedAt ||
    row.senderType !== "agent" ||
    row.isInternal ||
    row.channel !== "github"
  )
    return undefined;
  const issue = /^([\w-]+\/[\w.-]+)#(\d{1,10})$/.exec(row.threadKey ?? "");
  if (!issue || issue[1]!.split("/").some((part) => /^\.+$/.test(part)))
    return { error: "This conversation is not linked to a GitHub issue." };
  // The inbox must still be on: turning it off stops outbound comments.
  const integrationId = row.accountConfig?.integrationId;
  if (
    row.accountDeletedAt ||
    !integrationId ||
    !isTypeId(integrationId, "integration")
  )
    return { error: "The GitHub inbox is off." };
  const [connection] = await db
    .select({ secrets: integrations.secrets })
    .from(integrations)
    .where(
      and(
        eq(integrations.id, integrationId),
        eq(integrations.integrationType, "github"),
        eq(integrations.status, "active"),
      ),
    );
  const token = openCredentials(connection?.secrets ?? null)?.accessToken;
  if (!token) return { error: "GitHub is not connected." };
  return {
    integrationId,
    token,
    repo: issue[1]!,
    number: issue[2]!,
    body: `${row.content}\n\n${outboundMarker(messageId)}`,
    since: new Date(row.createdAt.getTime() - 60_000).toISOString(),
  };
}

/** The ID of a comment on the issue that carries this reply's marker. Throws when GitHub does not answer. */
async function findComment(target: Target, messageId: string) {
  const comments = await providerJson(
    `https://api.github.com/repos/${target.repo}/issues/${target.number}/comments?per_page=100&since=${encodeURIComponent(target.since)}`,
    { headers: headers(target.token) },
  );
  // ponytail: reads the first 100 comments since the reply; page through them if issues get that busy.
  const found = (Array.isArray(comments) ? comments : []).find(
    (comment: { body?: unknown }) =>
      typeof comment?.body === "string" &&
      comment.body.includes(outboundMarker(messageId)),
  ) as { id?: unknown } | undefined;
  return typeof found?.id === "number" ? String(found.id) : undefined;
}

export async function runGitHubCommentJob(
  workspaceId: string,
  job: JobQueueRow,
) {
  const { eventId } = eventPayloadSchema.parse(job.payload);
  const system = <T>(work: (db: Database) => Promise<T>) =>
    withQuillsSystemWorkspace(workspaceId, work);
  const finish = (error?: string) =>
    system((db) =>
      finishQuillsJob(db, job.id, job.leaseToken!, error, Boolean(error)),
    );
  const prepared = await system(async (db) => {
    const [event] = await db
      .select({ type: events.type, entityId: events.entityId })
      .from(events)
      .where(eq(events.eventId, eventId));
    if (!event || !isTypeId(event.entityId, "conversation_msg"))
      return undefined;
    const messageId = event.entityId as MessageId;
    const retry = event.type === "github_inbox.message_retried";
    const target = await resolve(db, messageId);
    if (target && "error" in target)
      await mark(db, messageId, { status: "failed", error: target.error });
    return target && "token" in target
      ? {
          messageId,
          target,
          retry,
          // Each teammate retry is a new attempt with its own receipt.
          key: `github-comment:${messageId}${retry ? `:${eventId}` : ""}`,
        }
      : undefined;
  });
  if (!prepared) return finish();
  const { messageId, target, key } = prepared;
  if (prepared.retry) {
    // An earlier attempt may have posted it: look before sending again.
    let found: string | undefined;
    try {
      found = await findComment(target, messageId);
    } catch (error) {
      if (!(error instanceof ProviderCallError)) throw error;
      await system((db) =>
        mark(db, messageId, {
          status: "failed",
          error: "GitHub did not answer. Try again later.",
        }),
      );
      return finish("GitHub comment check failed");
    }
    if (found) {
      const commentId = found;
      await system(async (db) => {
        await db
          .insert(hookDeliveries)
          .values({ jobId: key, hookType: "github_comment" })
          .onConflictDoNothing();
        await mark(db, messageId, { status: "sent", externalId: commentId });
      });
      return finish();
    }
  }
  const claim = await system(async (db) => {
    const outcome = await claimDelivery(db, key, "github_comment");
    if (outcome !== "completed")
      await mark(
        db,
        messageId,
        outcome === "send"
          ? { status: "pending" }
          : { status: "failed", error: UNCERTAIN },
      );
    return outcome;
  });
  if (claim === "completed") return finish();
  if (claim === "uncertain") return finish(UNCERTAIN);
  let outcome:
    | { state: "completed"; id: string }
    | { state: "uncertain" }
    | { state: "failed"; status: number };
  try {
    const comment = (await providerJson(
      `https://api.github.com/repos/${target.repo}/issues/${target.number}/comments`,
      {
        method: "POST",
        headers: headers(target.token),
        body: JSON.stringify({ body: target.body }),
      },
    )) as { id?: unknown } | null;
    outcome =
      typeof comment?.id === "number"
        ? { state: "completed", id: String(comment.id) }
        : { state: "uncertain" };
  } catch (error) {
    if (!(error instanceof ProviderCallError)) throw error;
    // No answer, or a 5xx: GitHub may have stored the comment.
    outcome =
      error.status === null || error.status >= 500
        ? { state: "uncertain" }
        : { state: "failed", status: error.status };
  }
  // Its own transaction, so a lease lost later cannot erase what happened.
  await system(async (db) => {
    await settleDelivery(db, key, outcome.state);
    await mark(
      db,
      messageId,
      outcome.state === "completed"
        ? { status: "sent", externalId: outcome.id }
        : {
            status: "failed",
            error:
              outcome.state === "uncertain"
                ? UNCERTAIN
                : failure(outcome.status),
          },
    );
    const health =
      outcome.state === "completed"
        ? { lastOutboundAt: new Date() }
        : outcome.state === "failed" && outcome.status === 401
          ? { lastError: failure(401), lastErrorAt: new Date() }
          : undefined;
    if (health)
      await db
        .update(integrations)
        .set(health)
        .where(eq(integrations.id, target.integrationId));
  });
  return finish(
    outcome.state === "completed"
      ? undefined
      : outcome.state === "uncertain"
        ? UNCERTAIN
        : "GitHub comment failed",
  );
}
