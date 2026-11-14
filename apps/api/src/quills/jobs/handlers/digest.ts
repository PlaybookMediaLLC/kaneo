import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  createId,
  isValidTypeId,
  type PostId,
  type PrincipalId,
} from "@kaneo/ids";
import { typeIdSchema } from "@kaneo/ids/zod";
import {
  withEmailIdempotencyKey,
  withEmailTags,
  sendWeeklyDigestEmail,
  type EmailResult,
} from "@kaneo/email/quills";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { auditLog } from "../../../database/quills/schema/audit-log";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import { emailLog } from "../../../database/quills/schema/email-log";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { kvStore } from "../../../database/quills/schema/kv";
import { postSubscriptions } from "../../../database/quills/schema/notifications";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { realEmail } from "../../directory/customer";
import { mailTags } from "../../framework/signed";
import { portalAccount } from "../../framework/platform-reads";
import {
  postVisible,
  viewerFor,
  visibleBoards,
} from "../../portal/feedback/viewer";
import { myPosts } from "../../portal/my-feedback";
import { portalPaths } from "../../portal/paths";
import {
  MAIL_TYPES,
  mintUnsubscribeToken,
  unsubscribePageUrl,
  unsubscribeUrl,
} from "../../portal/unsubscribe-token";
import { claimDelivery, settleDelivery } from "../ledger";
import { wants } from "../preferences";
import { enqueueQuillsJob, finishQuillsJob } from "../queue";
import { rejection } from "./mail";

// The weekly digest (RFC 0003, feature 16, D15). The first sweep of each ISO week (UTC) queues one
// mail job per customer whose voted or followed posts changed status in the week before. The job
// key and the delivery ledger key name the customer and that week, so a repeat sends nothing.
// The mail lists only posts that the customer may still see. The `weekly_digest` email cell of
// the notification matrix turns it off; mute (unsubscribe all) does too. Teammates do not get it.

const TYPE = MAIL_TYPES.unsubscribe_digest;
const DAY = 24 * 60 * 60 * 1000;
const BATCH = 50;
/** ponytail: status changes read per week; a workspace with more misses the rest in its digests. */
const MAX_CHANGED = 1000;
const MAX_ITEMS = 20;
const UNCERTAIN = "Mail outcome uncertain; not sent again";

/** The ISO week label of the week that starts on `monday` (UTC), for example 2026-W46. */
export function isoWeek(monday: Date) {
  const thursday = new Date(monday.getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const week =
    Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The ISO week before the week of `now`: its label and its bounds [from, to). */
export function digestWeek(now = new Date()) {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const to = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - sinceMonday,
    ),
  );
  const from = new Date(to.getTime() - 7 * DAY);
  return { week: isoWeek(from), from, to };
}

/** Posts whose status changed in [from, to), from the audit history that every status path writes. */
async function changedPosts(db: Database, from: Date, to: Date) {
  const rows = await db
    .selectDistinct({ id: auditLog.targetId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.eventType, "post.status_changed"),
        eq(auditLog.targetType, "post"),
        gte(auditLog.occurredAt, from),
        lt(auditLog.occurredAt, to),
      ),
    )
    .limit(MAX_CHANGED);
  return rows
    .map((row) => row.id)
    .filter((id): id is PostId => !!id && isValidTypeId(id, "post"));
}

const progressKey = (week: string) => `digest:${week}`;
const progressSchema = z.object({
  after: z.string().nullable(),
  done: z.boolean(),
});

/**
 * Queues the digest jobs of the last full week, BATCH customers per run in principal ID order. A
 * cursor in kv_store keeps the place and marks the week done.
 */
export async function queueWeeklyDigests(db: Database, now = new Date()) {
  const { week, from, to } = digestWeek(now);
  const key = progressKey(week);
  const [stored] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(and(eq(kvStore.workspaceKey, "_"), eq(kvStore.key, key)))
    .for("update");
  const progress = progressSchema.safeParse(stored?.value);
  if (progress.success && progress.data.done) return;
  const after = progress.success ? progress.data.after : null;
  const changed = await changedPosts(db, from, to);
  const asked = sql`exists (select 1 from ${posts} where ${inArray(posts.id, changed)} and ${or(
    sql`exists (select 1 from ${postVotes} where ${postVotes.postId} = ${posts.id} and ${postVotes.principalId} = ${principal.id})`,
    sql`exists (select 1 from ${postSubscriptions} where ${postSubscriptions.postId} = ${posts.id} and ${postSubscriptions.principalId} = ${principal.id})`,
  )})`;
  const due = changed.length
    ? await db
        .select({ id: principal.id })
        .from(principal)
        .where(
          and(
            isNull(principal.kaneoUserId),
            isNotNull(principal.userId),
            isNull(principal.blockedAt),
            isNull(principal.testOwnerPrincipalId),
            after ? gt(principal.id, after as PrincipalId) : undefined,
            asked,
          ),
        )
        .orderBy(asc(principal.id))
        .limit(BATCH)
    : [];
  for (const { id } of due)
    await enqueueQuillsJob(
      db,
      "quills.mail",
      {
        digest: week,
        principalId: id,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      `digest:${id}:${week}`,
      5,
    );
  const value = {
    after: due.at(-1)?.id ?? after,
    done: due.length < BATCH,
  };
  await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key,
      value,
      expiresAt: new Date(to.getTime() + 14 * DAY),
    })
    .onConflictDoUpdate({
      target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
      set: { value },
    });
}

export const digestPayloadSchema = z
  .object({
    digest: z.string().regex(/^\d{4}-W\d{2}$/),
    principalId: typeIdSchema("principal"),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .strict();

/** The customer, when it may get mail: live, not blocked, not a teammate or test customer. */
async function personOf(workspaceId: string, principalId: PrincipalId) {
  const [row] = await withQuillsSystemWorkspace(workspaceId, (db) =>
    db
      .select({
        customerId: customer.id,
        kaneoUserId: customer.kaneoUserId,
        email: customer.email,
        blockedAt: principal.blockedAt,
        teammate: principal.kaneoUserId,
        test: principal.testOwnerPrincipalId,
      })
      .from(principal)
      .innerJoin(customer, eq(customer.id, principal.userId))
      .where(eq(principal.id, principalId)),
  );
  return row && !row.blockedAt && !row.teammate && !row.test ? row : undefined;
}

/** Sends one customer's digest after commit, under a ledger key per customer and week. */
export async function runDigestJob(workspaceId: string, job: JobQueueRow) {
  const { digest, principalId, from, to } = digestPayloadSchema.parse(
    job.payload,
  );
  const finish = (error?: string, permanent?: boolean) =>
    withQuillsSystemWorkspace(workspaceId, (db) =>
      finishQuillsJob(db, job.id, job.leaseToken!, error, permanent),
    );
  const person = await personOf(workspaceId, principalId);
  if (!person) return finish();
  const account = person.kaneoUserId
    ? await portalAccount(workspaceId, person.kaneoUserId)
    : undefined;
  // An unverified account address may belong to someone else.
  if (person.kaneoUserId && !account?.emailVerified) return finish();
  const address = realEmail(account ? account.email : person.email);
  const prepared =
    address &&
    (await withQuillsSystemWorkspace(workspaceId, async (db) => {
      if (!(await wants(db, principalId, TYPE, "email"))) return undefined;
      let viewer;
      try {
        viewer = await viewerFor(db, account ? "portal" : "widget", {
          principalId,
          customerId: person.customerId,
          account: account ?? null,
        });
      } catch (error) {
        // A closed portal or widget, or a private portal that denies the customer.
        if (error instanceof HTTPException) return undefined;
        throw error;
      }
      const changed = await changedPosts(db, new Date(from), new Date(to));
      const boardIds = (await visibleBoards(db, viewer)).map((b) => b.id);
      const items = changed.length
        ? await db
            .select({
              id: posts.id,
              title: posts.title,
              status: postStatuses.name,
            })
            .from(posts)
            .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
            .where(
              and(
                inArray(posts.id, changed),
                postVisible(viewer, boardIds),
                or(
                  myPosts(principalId, "voted"),
                  myPosts(principalId, "following"),
                ),
              ),
            )
            .orderBy(asc(posts.title), asc(posts.id))
            .limit(MAX_ITEMS)
        : [];
      const [workspace] = await db
        .select({ id: settings.workspaceId, name: settings.name })
        .from(settings)
        .limit(1);
      if (!items.length || !workspace) return undefined;
      const token = await mintUnsubscribeToken(
        db,
        principalId,
        "unsubscribe_digest",
      );
      return { items, workspace, token };
    }));
  if (!prepared) return finish();
  const key = `digest:${principalId}:${digest}`;
  const claim = await withQuillsSystemWorkspace(workspaceId, (db) =>
    claimDelivery(db, key, "mail"),
  );
  if (claim === "completed") return finish();
  if (claim === "uncertain") return finish(UNCERTAIN, true);

  const { items, workspace, token } = prepared;
  let result: EmailResult | undefined;
  let failure: { error: string; permanent: boolean } | undefined;
  let uncertain = false;
  const logId = createId("email_log");
  try {
    result = await withEmailIdempotencyKey(key, () =>
      withEmailTags(mailTags(workspaceId, logId), () =>
        sendWeeklyDigestEmail({
          to: address,
          items: items.map((item) => ({
            title: item.title,
            status: item.status,
            url: portalPaths.post(workspace.id, item.id),
          })),
          myFeedbackUrl: portalPaths.myFeedback(workspace.id),
          workspaceName: workspace.name,
          unsubscribeUrl: unsubscribePageUrl(workspace.id, token),
          oneClickUnsubscribeUrl: unsubscribeUrl(workspace.id, token),
        }),
      ),
    );
  } catch (error) {
    failure = rejection(error);
    uncertain = !failure;
  }
  const outcome = uncertain ? "uncertain" : failure ? "failed" : "completed";
  // Its own transaction, so a lease lost later cannot erase what happened.
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    await settleDelivery(db, key, outcome);
    await db.insert(emailLog).values({
      id: logId,
      direction: "outbound",
      emailType: "WeeklyDigestEmail",
      principalId,
      address,
      status:
        outcome === "completed" ? (result?.sent ? "sent" : "skipped") : outcome,
      error: uncertain ? UNCERTAIN : (failure?.error ?? null),
    });
  });
  if (uncertain) return finish(UNCERTAIN, true);
  return finish(failure?.error, failure?.permanent);
}
