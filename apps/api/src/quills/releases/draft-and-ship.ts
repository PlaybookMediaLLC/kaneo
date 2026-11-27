// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../database/quills/schema/changelog";
import { inAppNotifications } from "../../database/quills/schema/notifications";
import { posts } from "../../database/quills/schema/posts";
import {
  releaseNotifications,
  verifiedReleases,
  type ReleaseSource,
} from "../../database/quills/schema/releases";
import { postStatuses } from "../../database/quills/schema/statuses";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  collectReleaseScope,
  type ReleasePostNode,
  type ReleaseRequesterDigest,
  type ReleaseTicketNode,
} from "../integrations/work-item-graph";
import { changeStatus } from "../support/ticket-lifecycle";
import { systemMessage } from "../support/ticket-view";

export interface VerifyReleaseInput {
  version: string;
  title?: string;
  source: ReleaseSource;
  externalUrl?: string | null;
  commitSha?: string | null;
  taskIds?: readonly string[];
  extraPostIds?: readonly TypeId<"post">[];
  extraTicketIds?: readonly TypeId<"ticket">[];
  authorPrincipalId?: TypeId<"principal"> | null;
}

/**
 * Generates an approval-pending customer-facing changelog draft grouped by board/audience.
 */
export function buildChangelogDraftMarkdown(
  version: string,
  title: string,
  shippedPosts: readonly ReleasePostNode[],
  shippedTickets: readonly ReleaseTicketNode[],
): string {
  const lines: string[] = [`# ${title || `Release ${version}`}`, ""];
  if (shippedPosts.length > 0) {
    const byBoard = new Map<string, ReleasePostNode[]>();
    for (const post of shippedPosts) {
      const list = byBoard.get(post.boardName) ?? [];
      list.push(post);
      byBoard.set(post.boardName, list);
    }
    for (const [boardName, items] of byBoard) {
      lines.push(`## ${boardName}`, "");
      for (const item of items) {
        lines.push(`- **${item.title}**`);
      }
      lines.push("");
    }
  }
  if (shippedTickets.length > 0) {
    lines.push("## Fixes & support requests", "");
    for (const ticket of shippedTickets) {
      lines.push(`- ${ticket.title}`);
    }
    lines.push("");
  }
  if (shippedPosts.length === 0 && shippedTickets.length === 0) {
    lines.push(`Release ${version} is live.`);
  }
  return lines.join("\n").trim();
}

/**
 * Builds ONE personal, consolidated message per customer quoting their own original request words
 * and summarizing every request/ticket shipped in this release.
 */
export function buildPersonalReleaseMessage(
  version: string,
  title: string,
  digest: ReleaseRequesterDigest,
  postTitlesById: ReadonlyMap<string, string>,
): { subject: string; body: string } {
  const subject = `Shipped in ${version}: ${title}`;
  const greeting = digest.displayName
    ? `Hi ${digest.displayName},`
    : "Hi there,";
  const shippedTitles = digest.postIds
    .map((id) => postTitlesById.get(id))
    .filter((t): t is string => Boolean(t));

  const parts: string[] = [
    greeting,
    "",
    `Good news — ${title} (${version}) just shipped to production.`,
  ];

  if (digest.quotedText) {
    parts.push("", `You previously asked: "${digest.quotedText}"`);
  }

  if (shippedTitles.length === 1) {
    parts.push("", `Your request "${shippedTitles[0]}" is now live.`);
  } else if (shippedTitles.length > 1) {
    parts.push(
      "",
      "These requests you followed are now live:",
      ...shippedTitles.map((t) => `- ${t}`),
    );
  }

  if (digest.ticketIds.length > 0) {
    parts.push(
      "",
      "We've marked your related support ticket as resolved. Reply anytime if anything still needs attention and it will reopen automatically.",
    );
  }

  return { subject, body: parts.join("\n") };
}

/**
 * Records a verified release in `draft` status and creates an unpublished approval-pending
 * changelog draft (`publishedAt: null`). Zero customer notifications are sent until a teammate
 * explicitly approves and ships the release.
 */
export async function createVerifiedReleaseDraft(
  db: Database,
  input: VerifyReleaseInput,
) {
  const [existing] = await db
    .select()
    .from(verifiedReleases)
    .where(eq(verifiedReleases.version, input.version))
    .limit(1);
  if (existing) {
    return { release: existing, created: false as const };
  }

  const scope = await collectReleaseScope(db, {
    taskIds: input.taskIds,
    extraPostIds: input.extraPostIds,
    extraTicketIds: input.extraTicketIds,
  });

  const title = input.title?.trim() || `Release ${input.version}`;
  const draftContent = buildChangelogDraftMarkdown(
    input.version,
    title,
    scope.posts,
    scope.tickets,
  );

  // Create approval-pending changelog draft (publishedAt = null).
  const [entry] = await db
    .insert(changelogEntries)
    .values({
      title,
      content: draftContent,
      principalId: input.authorPrincipalId ?? null,
      publishedAt: null,
    })
    .returning({ id: changelogEntries.id });

  if (entry && scope.posts.length > 0) {
    await db
      .insert(changelogEntryPosts)
      .values(
        scope.posts.map((post) => ({
          changelogEntryId: entry.id,
          postId: post.id,
        })),
      )
      .onConflictDoNothing();
  }

  const [release] = await db
    .insert(verifiedReleases)
    .values({
      version: input.version,
      title,
      source: input.source,
      externalUrl: input.externalUrl ?? null,
      commitSha: input.commitSha ?? null,
      taskIds: scope.taskIds,
      postIds: scope.posts.map((p) => p.id),
      ticketIds: scope.tickets.map((t) => t.id),
      changelogEntryId: entry?.id ?? null,
      status: "draft",
    })
    .returning();

  return { release: release!, created: true as const };
}

/**
 * Approves a verified release draft:
 * 1. Publishes the changelog entry (with optional teammate edits)
 * 2. Moves linked feedback posts to the workspace's shipped (`category = 'complete'`) status
 * 3. Closes linked open support tickets via `changeStatus`
 * 4. Sends at most ONE consolidated personal notification per customer (enforced by the DB
 *    unique constraint on `(workspace_id, release_id, principal_id)`).
 */
export async function approveAndShipRelease(
  db: Database,
  actor: QuillsActor,
  releaseId: TypeId<"verified_release">,
  overrides?: { title?: string; content?: string },
) {
  const [release] = await db
    .select()
    .from(verifiedReleases)
    .where(eq(verifiedReleases.id, releaseId))
    .for("update");
  if (!release) {
    throw new HTTPException(404, { message: "Verified release not found" });
  }
  if (release.status === "shipped") {
    throw new HTTPException(409, { message: "Release was already shipped" });
  }

  const now = new Date();
  const finalTitle = overrides?.title?.trim() || release.title;

  // 1. Publish the linked changelog draft.
  if (release.changelogEntryId) {
    await db
      .update(changelogEntries)
      .set({
        title: finalTitle,
        ...(overrides?.content !== undefined
          ? { content: overrides.content }
          : {}),
        publishedAt: now,
        displayDate: now,
        notifiedAt: now,
        updatedAt: now,
      })
      .where(eq(changelogEntries.id, release.changelogEntryId));
  }

  // Re-collect live scope so any newly added voters/tickets before approval are included.
  const scope = await collectReleaseScope(db, {
    taskIds: release.taskIds,
    extraPostIds: release.postIds as TypeId<"post">[],
    extraTicketIds: release.ticketIds as TypeId<"ticket">[],
  });

  // 2. Move linked feedback posts to shipped (`category = 'complete'`).
  const [shippedStatus] = await db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .where(
      and(
        eq(postStatuses.category, "complete"),
        isNull(postStatuses.deletedAt),
      ),
    )
    .orderBy(asc(postStatuses.position))
    .limit(1);

  let shippedPostCount = 0;
  if (shippedStatus && scope.posts.length > 0) {
    const postIds = scope.posts.map((p) => p.id);
    const updatedPosts = await db
      .update(posts)
      .set({ statusId: shippedStatus.id, updatedAt: now })
      .where(and(inArray(posts.id, postIds), isNull(posts.deletedAt)))
      .returning({ id: posts.id });
    shippedPostCount = updatedPosts.length;
  }

  // 3. Close linked open support tickets via `changeStatus`.
  let closedTicketCount = 0;
  if (scope.tickets.length > 0) {
    const statuses = await db
      .select()
      .from(ticketStatuses)
      .where(isNull(ticketStatuses.deletedAt))
      .orderBy(asc(ticketStatuses.position));
    const closedStatus = statuses.find((s) => s.category === "closed");
    const closedIds = new Set(
      statuses.filter((s) => s.category === "closed").map((s) => s.id),
    );
    if (closedStatus) {
      const liveTickets = await db
        .select()
        .from(tickets)
        .where(
          and(
            inArray(
              tickets.id,
              scope.tickets.map((t) => t.id),
            ),
            isNull(tickets.deletedAt),
          ),
        )
        .orderBy(asc(tickets.id))
        .for("update");
      for (const ticket of liveTickets) {
        if (closedIds.has(ticket.statusId)) continue;
        await changeStatus(db, actor, ticket, closedStatus, false);
        await systemMessage(
          db,
          ticket.id,
          `Shipped in verified release ${release.version}. Reply anytime if you still need help.`,
          {
            kind: "ticket_status_changed",
            stageLabel: release.version,
            closed: true,
          },
        );
        closedTicketCount += 1;
      }
    }
  }

  // 4. Send strictly ONE deduplicated personal message per customer requester.
  const postTitlesById = new Map(scope.posts.map((p) => [p.id, p.title]));
  let notifiedCount = 0;
  for (const digest of scope.requesters) {
    const { subject, body } = buildPersonalReleaseMessage(
      release.version,
      finalTitle,
      digest,
      postTitlesById,
    );
    const [inserted] = await db
      .insert(releaseNotifications)
      .values({
        releaseId: release.id,
        principalId: digest.principalId,
        channel: "in_app",
        subject,
        body,
        quotedText: digest.quotedText,
        postIds: digest.postIds,
        ticketIds: digest.ticketIds,
        sentAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: releaseNotifications.id });
    if (!inserted) continue;

    await db.insert(inAppNotifications).values({
      principalId: digest.principalId,
      type: "release_shipped",
      title: subject.slice(0, 255),
      body,
      postId: digest.postIds[0] ?? null,
      metadata: {
        releaseId: release.id,
        version: release.version,
        changelogEntryId: release.changelogEntryId,
        postIds: digest.postIds,
        ticketIds: digest.ticketIds,
        quotedText: digest.quotedText,
      },
    });
    notifiedCount += 1;
  }

  // 5. Mark release shipped.
  const [shipped] = await db
    .update(verifiedReleases)
    .set({
      title: finalTitle,
      postIds: scope.posts.map((p) => p.id),
      ticketIds: scope.tickets.map((t) => t.id),
      status: "shipped",
      approvedAt: now,
      approvedByPrincipalId: actor.principalId,
      shippedAt: now,
      updatedAt: now,
    })
    .where(eq(verifiedReleases.id, release.id))
    .returning();

  return {
    release: shipped!,
    shippedPostCount,
    closedTicketCount,
    notifiedCount,
  };
}
