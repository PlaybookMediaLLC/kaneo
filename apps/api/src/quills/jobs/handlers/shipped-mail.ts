import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { sendShippedEmail } from "@kaneo/email/quills";
import type { ChangelogId, PostId, PrincipalId } from "@kaneo/ids";
import type { Database } from "../../../database/quills/client";
import { principal, settings } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../../database/quills/schema/changelog";
import { postSubscriptions } from "../../../database/quills/schema/notifications";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import {
  segments,
  userSegments,
} from "../../../database/quills/schema/segments";
import { entryVisible } from "../../portal/feedback/changelog";
import { portalPaths } from "../../portal/paths";
import {
  MAIL_TYPES,
  mintUnsubscribeToken,
  unsubscribePageUrl,
  unsubscribeUrl,
} from "../../portal/unsubscribe-token";
import type { DeliveryEvent, Subscribers } from "../fanout";

// Shipped notices (RFC 0003, feature 13). When a changelog entry is published, the voters and the
// status followers of its linked posts hear that their request shipped: teammates in-app and by
// mail, customers by mail. The fan-out keeps one job per person, so a person who voted for two
// linked posts gets one notice. Preferences use the matrix type `post_shipped`; the mail's
// unsubscribe link turns that type off. A `notify: false` publish tells nobody. Only posts on
// boards without project links count: those are the boards that a customer can reach and that
// every Quills reader can see, so no notice names a post that its reader cannot open.

const TYPE = MAIL_TYPES.unsubscribe_shipped;
/** ponytail: one job per person, at most 10,000 per entry; batch sends if requests grow past that. */
const MAX_RECIPIENTS = 10_000;

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

/** The live, published entry that the event announces, unless the publisher chose no notice. */
async function shippedEntry(db: Database, event: DeliveryEvent) {
  const payload = event.payload as Record<string, string | undefined>;
  if (event.entityType !== "changelog" || payload.notify === "false") return;
  const [entry] = await db
    .select({ id: changelogEntries.id, title: changelogEntries.title })
    .from(changelogEntries)
    .where(
      and(
        eq(changelogEntries.id, event.entityId as ChangelogId),
        isNull(changelogEntries.deletedAt),
        isNotNull(changelogEntries.publishedAt),
        lte(changelogEntries.publishedAt, sql`now()`),
      ),
    );
  return entry;
}

/** Linked live posts on live boards without project links, in link order. */
const shippedPosts = (db: Database, entryId: ChangelogId) =>
  db
    .select({ id: posts.id, title: posts.title })
    .from(changelogEntryPosts)
    .innerJoin(posts, eq(posts.id, changelogEntryPosts.postId))
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(
      and(
        eq(changelogEntryPosts.changelogEntryId, entryId),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
        sql`not exists (select 1 from ${boardProjects} where ${eq(boardProjects.boardId, boards.id)})`,
      ),
    )
    .orderBy(asc(changelogEntryPosts.createdAt), asc(posts.id));

/** Voters and status followers of the posts, each once. */
const recipients: Subscribers["recipients"] = async (db, event) => {
  const entry = await shippedEntry(db, event);
  const ids = entry ? (await shippedPosts(db, entry.id)).map((p) => p.id) : [];
  if (!ids.length) return { principalIds: [] };
  const rows = await db
    .select({ id: postVotes.principalId })
    .from(postVotes)
    .where(inArray(postVotes.postId, ids))
    .union(
      db
        .select({ id: postSubscriptions.principalId })
        .from(postSubscriptions)
        .where(
          and(
            inArray(postSubscriptions.postId, ids),
            eq(postSubscriptions.notifyStatusChanges, true),
          ),
        ),
    )
    .limit(MAX_RECIPIENTS);
  return { principalIds: rows.map((row) => row.id) };
};

/** The first linked post that this person voted for or follows: the request they asked for. */
async function requestOf(
  db: Database,
  principalId: PrincipalId,
  linked: { id: PostId; title: string }[],
) {
  const ids = linked.map((post) => post.id);
  if (!ids.length) return undefined;
  const asked = new Set(
    (
      await db
        .select({ id: postVotes.postId })
        .from(postVotes)
        .where(
          and(
            inArray(postVotes.postId, ids),
            eq(postVotes.principalId, principalId),
          ),
        )
        .union(
          db
            .select({ id: postSubscriptions.postId })
            .from(postSubscriptions)
            .where(
              and(
                inArray(postSubscriptions.postId, ids),
                eq(postSubscriptions.principalId, principalId),
                eq(postSubscriptions.notifyStatusChanges, true),
              ),
            ),
        )
    ).map((row) => row.id),
  );
  return linked.find((post) => asked.has(post.id));
}

/** A teammate sees every entry; a customer passes the entry's segment gates. */
async function seesEntry(
  db: Database,
  principalId: PrincipalId,
  entryId: ChangelogId,
) {
  const [person] = await db
    .select({ teammate: principal.kaneoUserId })
    .from(principal)
    .where(eq(principal.id, principalId));
  if (!person) return false;
  if (person.teammate) return true;
  const segmentIds = (
    await db
      .select({ id: userSegments.segmentId })
      .from(userSegments)
      .innerJoin(segments, eq(segments.id, userSegments.segmentId))
      .where(
        and(
          eq(userSegments.principalId, principalId),
          isNull(segments.deletedAt),
        ),
      )
  ).map((row) => String(row.id));
  // A mail recipient is a known person: the "authenticated" changelog audience admits them.
  const [shown] = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(
      and(
        eq(changelogEntries.id, entryId),
        entryVisible({ signedIn: true, changelogPublic: true, segmentIds }),
      ),
    );
  return Boolean(shown);
}

const entry: Subscribers = {
  recipients,
  customers: true,
  notification: async (db, event) => {
    const shipped = await shippedEntry(db, event);
    const linked = shipped ? await shippedPosts(db, shipped.id) : [];
    if (!shipped || !linked.length) return undefined;
    return {
      type: TYPE,
      title: clip(`Shipped: ${shipped.title}`, 255),
      body: clip(linked.map((post) => post.title).join(", "), 500),
      postId: linked[0]!.id,
    };
  },
  // A customer's address is read at send time (support-mail.ts#customerPostAddress): only while
  // the portal or widget still shows them the request.
  mail: async (db, event, principalId) => {
    const shipped = await shippedEntry(db, event);
    if (!shipped || !principalId) return undefined;
    const request = await requestOf(
      db,
      principalId,
      await shippedPosts(db, shipped.id),
    );
    if (!request || !(await seesEntry(db, principalId, shipped.id)))
      return undefined;
    const [workspace] = await db
      .select({ id: settings.workspaceId, name: settings.name })
      .from(settings)
      .limit(1);
    if (!workspace) return undefined;
    const token = await mintUnsubscribeToken(
      db,
      principalId,
      "unsubscribe_shipped",
    );
    return {
      type: TYPE,
      emailType: "ShippedEmail",
      postId: request.id,
      send: (to) =>
        sendShippedEmail({
          to,
          entryTitle: shipped.title,
          entryUrl: portalPaths.changelogEntry(workspace.id, shipped.id),
          requestTitle: request.title,
          workspaceName: workspace.name,
          unsubscribeUrl: unsubscribePageUrl(workspace.id, token),
          oneClickUnsubscribeUrl: unsubscribeUrl(workspace.id, token),
        }),
    };
  },
};

/** The shipped entry for jobs/fanout.ts#subscribers. */
export const shippedSubscribers: Partial<Record<string, Subscribers>> = {
  "changelog.published": entry,
};
