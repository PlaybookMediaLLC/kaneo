import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { isTypeId, toUuid } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { principal } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { conversationMessages } from "../../../database/quills/schema/conversation";
import {
  postExternalLinks,
  ticketExternalLinks,
} from "../../../database/quills/schema/external-links";
import {
  integrationSyncAttempts as attempts,
  integrationSyncOperations as operations,
} from "../../../database/quills/schema/integration-sync";
import {
  integrationEventMappings as mappings,
  integrationPlatformCredentials as platformCredentials,
  integrations,
} from "../../../database/quills/schema/integrations";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import {
  ticketConversations,
  tickets,
} from "../../../database/quills/schema/tickets";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../../../notification-preferences/secrets";
import {
  deliveredEvent,
  installationOf,
  provider,
  syncError,
  type DeliveredEvent,
} from "../../integrations/catalog";
import { tokenFields } from "../../integrations/oauth-providers";
import { systemMessage } from "../../support/ticket-view";
import { loadEvent, type DeliveryEvent } from "../fanout";
import { enqueueQuillsJob, finishQuillsJob } from "../queue";
import {
  deliver,
  type Content,
  type Delivery,
  type Outcome,
} from "./integration-send";

export const integrationPayloadSchema = z
  .object({ operationId: z.uuid() })
  .strict();

// Integration deliveries share the webhook queue until quills.runnable_workspaces lists a quills.integration
// queue (a forward migration; see integrations/ROUTES.md). The deduplication prefix keeps the two apart.
const QUEUE = "quills.webhook";
const UNCERTAIN = "Integration outcome uncertain; not sent again";

/** One job per operation version: a retried operation gets a new job, a rerun of fan-out does not. */
export const enqueueIntegrationJob = (
  db: Database,
  op: { id: string; version: number },
) =>
  enqueueQuillsJob(
    db,
    QUEUE,
    { operationId: op.id },
    `integration:${op.id}:${op.version}`,
    5,
  );

/** The event type that mappings answer to. A resync request delivers as a new post. */
const triggerOf = (type: string) =>
  deliveredEvent.safeParse(
    type === "post.integration_sync_requested" ? "post.created" : type,
  ).data;

/** The post or comment an event is about, and its board. A private comment is never delivered. */
async function sourceOf(db: Database, event: DeliveryEvent) {
  if (event.entityType === "post" && isTypeId(event.entityId, "post")) {
    const [post] = await db
      .select({ boardId: posts.boardId })
      .from(posts)
      .where(eq(posts.id, event.entityId));
    return post && { sourceType: "post", sourceId: event.entityId, ...post };
  }
  if (
    event.entityType === "comment" &&
    isTypeId(event.entityId, "post_comment")
  ) {
    const [comment] = await db
      .select({ boardId: posts.boardId, isPrivate: postComments.isPrivate })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .where(eq(postComments.id, event.entityId));
    return comment && !comment.isPrivate
      ? {
          sourceType: "comment",
          sourceId: event.entityId,
          boardId: comment.boardId,
        }
      : undefined;
  }
  return undefined;
}

const boardAllowed = (
  filters: { boardIds?: string[] } | null,
  boardId: string,
) => !filters?.boardIds?.length || filters.boardIds.includes(boardId);

/**
 * Writes one sync operation per active integration, enabled mapping and target, and enqueues its job.
 * The operation key makes a rerun write nothing new. A create has one operation per post and destination,
 * so a resync request only fills in destinations that have none.
 */
export async function fanOutIntegrations(workspaceId: string, eventId: string) {
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    if (!event || (event.context as { deliver?: unknown }).deliver !== true)
      return;
    // A recovery request changed only the operation, and a ticket issue request queued one; its job
    // starts here, after the request committed.
    if (
      event.type === "integration_sync.recovered" ||
      event.type === "ticket.issue_requested"
    ) {
      const operationId = z
        .uuid()
        .safeParse(
          event.type === "ticket.issue_requested"
            ? (event.payload as { operationId?: unknown }).operationId
            : event.entityId,
        ).data;
      const [op] = operationId
        ? await db
            .select({
              id: operations.id,
              version: operations.version,
              state: operations.state,
            })
            .from(operations)
            .where(eq(operations.id, operationId))
        : [];
      if (op?.state === "queued") await enqueueIntegrationJob(db, op);
      return;
    }
    const trigger = triggerOf(event.type);
    if (!trigger) return;
    const targets = await db
      .select({
        id: integrations.id,
        type: integrations.integrationType,
        connectedAt: integrations.connectedAt,
        target: mappings.targetKey,
        filters: mappings.filters,
      })
      .from(mappings)
      .innerJoin(integrations, eq(integrations.id, mappings.integrationId))
      .where(
        and(
          eq(integrations.status, "active"),
          eq(mappings.enabled, true),
          eq(mappings.eventType, trigger),
          // A connection hears only events that happened after it was made.
          lte(integrations.connectedAt, event.occurredAt),
        ),
      );
    // Most workspaces have no integration: skip the source lookup for them.
    const source = targets.length ? await sourceOf(db, event) : undefined;
    if (!source) return;
    const statusId = (event.payload as { statusId?: unknown }).statusId;
    for (const target of targets) {
      if (
        !(provider(target.type)?.events as string[] | undefined)?.includes(
          trigger,
        ) ||
        !boardAllowed(target.filters, source.boardId)
      )
        continue;
      const installation = installationOf(target);
      const kind = trigger === "post.created" ? "create" : "notify";
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            installation,
            kind,
            source.sourceType,
            source.sourceId,
            target.target,
            kind === "notify" ? eventId : null,
          ]),
        )
        .digest("hex");
      const [op] = await db
        .insert(operations)
        .values({
          operationKey: `sync:${key}`,
          integrationId: target.id,
          installation,
          provider: target.type,
          direction: "outbound",
          kind,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          // The shared purge trigger finds the operations of a deleted or unpublished source by this value.
          sourceRecordId: toUuid(source.sourceId),
          // The event that asked for this delivery, for tracing.
          sourceRevision: eventId,
          // What the claim needs, so a delivery does not depend on event retention.
          destination: {
            target: target.target,
            event: trigger,
            ...(typeof statusId === "string" && { statusId }),
          },
          destinationKey: target.target,
          requestedBy: event.actorId,
        })
        .onConflictDoNothing()
        .returning({ id: operations.id, version: operations.version });
      // A create of this installation cancelled before dispatch (its post was unavailable, or the connection
      // was paused or remapped) starts again. A sent, uncertain or teammate-cancelled create stays as it is.
      const resumed =
        op ??
        (kind === "create"
          ? (
              await db
                .update(operations)
                .set({
                  state: "queued",
                  errorCode: null,
                  finishedAt: null,
                  cancelRequested: false,
                  sourceRevision: eventId,
                  version: sql`${operations.version}+1`,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(operations.operationKey, `sync:${key}`),
                    eq(operations.state, "cancelled"),
                    inArray(operations.errorCode, [
                      "source_unavailable",
                      "installation_changed",
                    ]),
                    isNull(operations.dispatchedAt),
                  ),
                )
                .returning({ id: operations.id, version: operations.version })
            )[0]
          : undefined);
      if (resumed) await enqueueIntegrationJob(db, resumed);
    }
  });
}

/** The live rows a delivery describes: a published, live post (and comment). Undefined otherwise. */
async function loadContent(
  db: Database,
  op: { sourceType: string; sourceId: string },
  trigger: DeliveredEvent,
  statusId: unknown,
): Promise<Content | undefined> {
  if (op.sourceType === "comment") {
    if (!isTypeId(op.sourceId, "post_comment")) return undefined;
    const [row] = await db
      .select({
        id: postComments.id,
        content: postComments.content,
        isPrivate: postComments.isPrivate,
        deletedAt: postComments.deletedAt,
        moderationState: postComments.moderationState,
        author: principal.displayName,
        postId: posts.id,
        postDeletedAt: posts.deletedAt,
        postModeration: posts.moderationState,
        title: posts.title,
        postContent: posts.content,
        boardId: posts.boardId,
        board: boards.slug,
      })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .innerJoin(principal, eq(principal.id, postComments.principalId))
      .where(eq(postComments.id, op.sourceId));
    if (
      !row ||
      row.isPrivate ||
      row.deletedAt ||
      row.postDeletedAt ||
      row.moderationState !== "published" ||
      // A comment never carries the title of a post that waits for moderation.
      row.postModeration !== "published"
    )
      return undefined;
    return {
      board: row.board,
      boardId: row.boardId,
      post: {
        id: row.postId,
        title: row.title,
        content: row.postContent,
        author: "",
      },
      comment: {
        id: row.id,
        content: row.content,
        author: row.author ?? "Someone",
      },
    };
  }
  if (op.sourceType !== "post" || !isTypeId(op.sourceId, "post"))
    return undefined;
  const [row] = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      deletedAt: posts.deletedAt,
      moderationState: posts.moderationState,
      boardId: posts.boardId,
      board: boards.slug,
      author: principal.displayName,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .innerJoin(principal, eq(principal.id, posts.principalId))
    .where(eq(posts.id, op.sourceId));
  if (!row || row.deletedAt || row.moderationState !== "published")
    return undefined;
  const [status] =
    trigger === "post.status_changed" &&
    typeof statusId === "string" &&
    isTypeId(statusId, "post_status")
      ? await db
          .select({ name: postStatuses.name })
          .from(postStatuses)
          .where(eq(postStatuses.id, statusId))
      : [];
  return {
    board: row.board,
    boardId: row.boardId,
    post: {
      id: row.id,
      title: row.title,
      content: row.content,
      author: row.author ?? "Someone",
    },
    statusName: status?.name,
  };
}

/**
 * A live ticket as issue content: its title and its first customer-visible message (the ticket's
 * own thread or its customer pair's). The requester's name stays out: a tracker may be public.
 */
async function ticketContent(
  db: Database,
  ticketId: string,
): Promise<Content | undefined> {
  if (!isTypeId(ticketId, "ticket")) return undefined;
  const [ticket] = await db
    .select({ id: tickets.id, number: tickets.number, title: tickets.title })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)));
  if (!ticket) return undefined;
  const [pair] = await db
    .select({ id: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, "customer"),
      ),
    );
  const [first] = await db
    .select({ content: conversationMessages.content })
    .from(conversationMessages)
    .where(
      and(
        pair
          ? or(
              eq(conversationMessages.ticketId, ticketId),
              eq(conversationMessages.conversationId, pair.id),
            )
          : eq(conversationMessages.ticketId, ticketId),
        ne(conversationMessages.senderType, "system"),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
    .limit(1);
  return {
    board: `Support ticket #${ticket.number}`,
    boardId: "",
    post: {
      id: ticket.id,
      title: ticket.title,
      content: (first?.content ?? "").slice(0, 2000),
      author: "Support team",
    },
  };
}

function unseal(secrets: string | null) {
  if (!isEncryptedSecret(secrets)) return undefined;
  try {
    const value: unknown = JSON.parse(decryptSecret(secrets) ?? "");
    return value && typeof value === "object"
      ? (value as Record<string, string>)
      : undefined;
  } catch {
    return undefined;
  }
}

type Claimed = {
  token: string;
  op: typeof operations.$inferSelect;
  delivery: Delivery;
};
type Claim =
  | { kind: "done" }
  | { kind: "settled"; error: string }
  | ({ kind: "send" } & Claimed);

/** Health telemetry on the connection. The error is a mapped message, never provider text. */
async function recordHealth(
  db: Database,
  integrationId: string,
  outcome: Pick<Outcome, "state" | "errorCode">,
) {
  if (!isTypeId(integrationId, "integration")) return;
  await db
    .update(integrations)
    .set(
      outcome.state === "succeeded"
        ? {
            lastOutboundAt: new Date(),
            lastError: null,
            lastErrorAt: null,
            errorCount: 0,
          }
        : {
            lastError: syncError(outcome.errorCode),
            lastErrorAt: new Date(),
            errorCount: sql`${integrations.errorCount}+1`,
          },
    )
    .where(eq(integrations.id, integrationId));
}

/**
 * Re-reads the live connection, mapping, board filter and source, then records the attempt and marks the
 * operation `running` and dispatched before the external call. A `running` operation found here belongs to
 * an attempt that stopped after its claim: it may have sent, so it becomes `uncertain`.
 */
async function claimOperation(db: Database, id: string): Promise<Claim> {
  const [op] = await db
    .select()
    .from(operations)
    .where(eq(operations.id, id))
    .for("update");
  if (!op) return { kind: "done" };
  const now = new Date();
  const close = async (state: string, errorCode: string) => {
    await db
      .update(operations)
      .set({
        state,
        errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: now,
        version: op.version + 1,
        updatedAt: now,
      })
      .where(eq(operations.id, op.id));
  };
  if (op.state === "running") {
    await close("uncertain", "outcome_unknown");
    await db
      .update(attempts)
      .set({
        state: "uncertain",
        errorCode: "outcome_unknown",
        finishedAt: now,
      })
      .where(
        and(eq(attempts.operationId, op.id), eq(attempts.state, "running")),
      );
    return { kind: "settled", error: UNCERTAIN };
  }
  if (!["queued", "retry_wait"].includes(op.state) || op.cancelRequested)
    return { kind: "done" };
  const cancel = async (errorCode: string) => {
    await close("cancelled", errorCode);
    return { kind: "done" } as const;
  };
  const [integration] = isTypeId(op.integrationId, "integration")
    ? await db
        .select({
          id: integrations.id,
          type: integrations.integrationType,
          status: integrations.status,
          connectedAt: integrations.connectedAt,
          secrets: integrations.secrets,
        })
        .from(integrations)
        .where(eq(integrations.id, op.integrationId))
    : [];
  if (
    !integration ||
    integration.status !== "active" ||
    installationOf(integration) !== op.installation
  )
    return cancel("installation_changed");
  const meta = op.destination as { event?: unknown; statusId?: unknown };
  let trigger: DeliveredEvent;
  let content: Content | undefined;
  if (op.sourceType === "ticket") {
    // A teammate's issue request (support/ticket-external-links.ts): the channel must still be the
    // connection's, and the ticket live. It is delivered as an issue create.
    const [channel] = await db
      .select({ id: mappings.id })
      .from(mappings)
      .where(
        and(
          eq(mappings.integrationId, integration.id),
          eq(mappings.targetKey, op.destinationKey),
        ),
      )
      .limit(1);
    if (!channel) return cancel("installation_changed");
    trigger = "post.created";
    content = await ticketContent(db, op.sourceId);
    if (!content) return cancel("source_unavailable");
  } else {
    const parsed = deliveredEvent.safeParse(meta.event).data;
    if (!parsed) return cancel("source_unavailable");
    trigger = parsed;
    const [mapping] = await db
      .select({ filters: mappings.filters })
      .from(mappings)
      .where(
        and(
          eq(mappings.integrationId, integration.id),
          eq(mappings.eventType, trigger),
          eq(mappings.targetKey, op.destinationKey),
          eq(mappings.enabled, true),
        ),
      );
    if (!mapping) return cancel("installation_changed");
    content = await loadContent(db, op, trigger, meta.statusId);
    if (!content) return cancel("source_unavailable");
    if (!boardAllowed(mapping.filters, content.boardId))
      return cancel("installation_changed");
  }
  const credentials = unseal(integration.secrets);
  if (!credentials) {
    // An operator can restore the instance key; the sync history then offers a retry on this connection.
    await close("auth_required", "credentials_unavailable");
    await recordHealth(db, integration.id, {
      state: "auth_required",
      errorCode: "credentials_unavailable",
    });
    return { kind: "settled", error: "credentials_unavailable" };
  }
  const token = randomUUID();
  await db.insert(attempts).values({
    operationId: op.id,
    number: op.attempts + 1,
    token,
    state: "running",
  });
  const [running] = await db
    .update(operations)
    .set({
      state: "running",
      attempts: op.attempts + 1,
      version: op.version + 1,
      leaseToken: token,
      leaseExpiresAt: sql`now() + interval '5 minutes'`,
      dispatchedAt: now,
      updatedAt: now,
    })
    .where(eq(operations.id, op.id))
    .returning();
  return {
    kind: "send",
    token,
    op: running!,
    delivery: {
      provider: integration.type,
      credentials,
      // OAuth providers: the workspace's OAuth app (a GitLab refresh, the Discord bot token).
      app: ["gitlab", "discord"].includes(integration.type)
        ? unseal(
            (
              await db
                .select({ secrets: platformCredentials.secrets })
                .from(platformCredentials)
                .where(
                  eq(platformCredentials.integrationType, integration.type),
                )
            )[0]?.secrets ?? null,
          )
        : undefined,
      target: op.destinationKey,
      type: trigger,
      occurredAt: op.createdAt,
      content,
      deliveryId: op.id,
    },
  };
}

/** Records the outcome of the attempt that holds the lease. Its own transaction: a lost job lease cannot erase it. */
async function settle(db: Database, claim: Claimed, outcome: Outcome) {
  const now = new Date();
  const result = outcome.result ?? null;
  // A GitLab token refreshed before the call: kept unless the connection changed meanwhile.
  if (outcome.refreshed && isTypeId(claim.op.integrationId, "integration")) {
    const [live] = await db
      .select({
        id: integrations.id,
        connectedAt: integrations.connectedAt,
        secrets: integrations.secrets,
      })
      .from(integrations)
      .where(eq(integrations.id, claim.op.integrationId))
      .for("update");
    // Only the token fields change: a status-sync secret set or removed meanwhile stays as it is.
    if (live && installationOf(live) === claim.op.installation)
      await db
        .update(integrations)
        .set({
          secrets: encryptSecret(
            JSON.stringify({
              ...unseal(live.secrets),
              ...tokenFields(outcome.refreshed),
            }),
          )!,
          updatedAt: now,
        })
        .where(eq(integrations.id, live.id));
  }
  await db
    .update(attempts)
    .set({
      state: outcome.state,
      errorCode: outcome.errorCode ?? null,
      result,
      finishedAt: now,
    })
    .where(eq(attempts.token, claim.token));
  const settled = await db
    .update(operations)
    .set({
      state: outcome.state,
      errorCode: outcome.errorCode ?? null,
      result,
      remoteId: result?.externalId ?? null,
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: outcome.state === "retry_wait" ? null : now,
      version: sql`${operations.version}+1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(operations.id, claim.op.id),
        eq(operations.state, "running"),
        eq(operations.leaseToken, claim.token),
      ),
    )
    .returning({ id: operations.id });
  // A later attempt already marked this operation uncertain; keep that.
  if (!settled.length) return;
  // The connection may have been deleted during the call. Its row lock keeps it until this commits;
  // without it the link is skipped, and the operation keeps the remote ID as evidence.
  const [live] =
    result &&
    claim.op.kind === "create" &&
    ["post", "ticket"].includes(claim.op.sourceType) &&
    isTypeId(claim.op.integrationId, "integration")
      ? await db
          .select({ id: integrations.id })
          .from(integrations)
          .where(eq(integrations.id, claim.op.integrationId))
          .for("key share")
      : [];
  const syncScope = `${claim.op.installation}:${claim.op.destinationKey}`;
  if (live && result && isTypeId(claim.op.sourceId, "post"))
    await db
      .insert(postExternalLinks)
      .values({
        postId: claim.op.sourceId,
        integrationId: live.id,
        integrationType: claim.op.provider,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        syncScope,
        origin: "event",
      })
      .onConflictDoNothing();
  // A ticket's issue request links the new issue, with a team-only note on the ticket.
  if (live && result && isTypeId(claim.op.sourceId, "ticket")) {
    const linked = await db
      .insert(ticketExternalLinks)
      .values({
        ticketId: claim.op.sourceId,
        integrationId: live.id,
        integrationType: claim.op.provider,
        externalId: result.externalId,
        externalDisplayId: result.externalId,
        externalUrl: result.externalUrl,
        syncScope,
        origin: "push",
        createdByPrincipalId: claim.op.requestedBy,
      })
      .onConflictDoNothing()
      .returning({ id: ticketExternalLinks.id });
    if (linked.length)
      await systemMessage(
        db,
        claim.op.sourceId,
        `Created ${provider(claim.op.provider)?.name ?? claim.op.provider} issue ${result.externalId}`,
        {
          kind: "external_linked",
          externalReference: result.externalId,
          ...(result.externalUrl && { externalUrl: result.externalUrl }),
        },
        true,
      );
  }
  await recordHealth(db, claim.op.integrationId, outcome);
}

export async function runIntegrationJob(workspaceId: string, job: JobQueueRow) {
  const { operationId } = integrationPayloadSchema.parse(job.payload);
  const finish = (error?: string, permanent?: boolean) =>
    withQuillsSystemWorkspace(workspaceId, (db) =>
      finishQuillsJob(db, job.id, job.leaseToken!, error, permanent),
    );
  const claim = await withQuillsSystemWorkspace(workspaceId, (db) =>
    claimOperation(db, operationId),
  );
  if (claim.kind === "done") return finish();
  if (claim.kind === "settled") return finish(claim.error, true);
  const sent = await deliver(claim.delivery);
  // The job's last attempt turns a wait into a failure, so the operation never waits for a job that is gone.
  const outcome: Outcome =
    sent.state === "retry_wait" && job.attempts >= job.maxAttempts
      ? { ...sent, state: "failed" }
      : sent;
  await withQuillsSystemWorkspace(workspaceId, (db) =>
    settle(db, claim, outcome),
  );
  if (outcome.state === "succeeded") return finish();
  if (outcome.state === "uncertain") return finish(UNCERTAIN, true);
  return finish(
    `Integration ${outcome.errorCode ?? "failed"}`,
    outcome.state !== "retry_wait",
  );
}
