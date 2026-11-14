import { and, eq, gt, sql } from "drizzle-orm";
import type { ChangelogId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, responseTimestamp, z } from "../../openapi";
import {
  changelogReactions,
  changelogReads,
} from "../../database/quills/schema/changelog-engagement";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { FEEDBACK_REACTION_EMOJIS } from "../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { notFound } from "../feedback/visibility";
import {
  entryVisible,
  reactionList,
  reactionsFor,
  readMark,
} from "./feedback/changelog";
import {
  forbidden,
  principalOf,
  title,
  viewerFor,
  type Customer,
  type Viewer,
} from "./feedback/viewer";

// Changelog engagement for customers (RFC 0003, feature 15, D9): emoji reactions on an entry,
// the caller's read mark and its unread count. The portal and the widget mount the same routes.

/** The unread count stops here: a badge shows "9+" long before it. */
const UNREAD_CAP = 99;

/** A published entry that the caller may see, or 404, so a hidden entry looks like a missing one. */
async function visibleEntry(db: Database, viewer: Viewer, id: ChangelogId) {
  const [entry] = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(and(eq(changelogEntries.id, id), entryVisible(viewer)));
  if (!entry) throw notFound("Changelog entry");
  return entry;
}

export const setChangelogReaction = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "put",
    path: `/${audience}/changelog/{entryId}/reactions`,
    operationId: `setQuills${title(audience)}ChangelogReaction`,
    summary: "Add or remove the caller's emoji reaction on a changelog entry",
    description:
      "Desired state, from the comment reaction emoji set. One reaction per caller, entry and emoji. Without sign-in only a widget visitor of a workspace that allows anonymous interaction reacts.",
    action: "update",
    rateLimit: { limit: 120, windowSeconds: 600 },
    params: z.object({ entryId: flexibleToTypeIdSchema("changelog") }),
    body: z.object({
      emoji: z.enum(FEEDBACK_REACTION_EMOJIS),
      reacted: z.boolean(),
    }),
    response: z.object({
      entryId: z.string(),
      changed: z.boolean(),
      reactions: z.array(
        z.object({
          emoji: z.string(),
          count: z.number(),
          reacted: z.boolean(),
        }),
      ),
    }),
    responseDescription: "The entry's reactions",
    errors: {
      403: "Blocked account, no portal access, or reactions are not open to the caller",
      404: "Changelog entry not found",
    },
    event: ({ params, body }, result) =>
      result.changed && {
        type: body.reacted ? "changelog.reacted" : "changelog.unreacted",
        entityType: "changelog",
        entityId: params.entryId,
        payload: { emoji: body.emoji },
      },
    handler: async ({ db, caller, params, body }) => {
      const viewer = await viewerFor(db, audience, caller);
      if (
        !viewer.signedIn &&
        !(viewer.audience === "widget" && viewer.allowAnonymous)
      )
        throw forbidden("Sign in to react");
      const me = principalOf(viewer);
      const entry = await visibleEntry(db, viewer, params.entryId);
      const mine = and(
        eq(changelogReactions.changelogEntryId, entry.id),
        eq(changelogReactions.principalId, me),
        eq(changelogReactions.emoji, body.emoji),
      );
      // The primary key keeps one row per entry, caller and emoji, also under concurrent requests.
      const rows = body.reacted
        ? await db
            .insert(changelogReactions)
            .values({
              changelogEntryId: entry.id,
              principalId: me,
              emoji: body.emoji,
            })
            .onConflictDoNothing()
            .returning({ id: changelogReactions.changelogEntryId })
        : await db
            .delete(changelogReactions)
            .where(mine)
            .returning({ id: changelogReactions.changelogEntryId });
      return {
        entryId: entry.id,
        changed: rows.length > 0,
        reactions: reactionList(
          await reactionsFor(db, viewer, [entry.id]),
          entry.id,
        ),
      };
    },
  });

export const markChangelogRead = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "put",
    path: `/${audience}/changelog/read`,
    operationId: `markQuills${title(audience)}ChangelogRead`,
    summary: "Mark every changelog entry read for the caller",
    description:
      "Moves the caller's read mark to now. Entries published later count as unread.",
    action: "update",
    rateLimit: { limit: 120, windowSeconds: 600 },
    response: z.object({ lastReadAt: responseTimestamp }),
    responseDescription: "The caller's new read mark",
    event: { none: "The caller's own read mark; no shared record changes." },
    handler: async ({ db, caller }) => {
      const me = principalOf(await viewerFor(db, audience, caller));
      const [row] = await db
        .insert(changelogReads)
        .values({ principalId: me })
        .onConflictDoUpdate({
          target: [changelogReads.workspaceId, changelogReads.principalId],
          set: { lastReadAt: sql`now()` },
        })
        .returning({ lastReadAt: changelogReads.lastReadAt });
      return { lastReadAt: row!.lastReadAt };
    },
  });

export const getChangelogUnread = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/changelog/unread`,
    operationId: `getQuills${title(audience)}ChangelogUnread`,
    summary: "Count the changelog entries that the caller has not read",
    description: `Published entries that the caller may see, published after its read mark. At most ${UNREAD_CAP}. Zero without a customer profile.`,
    action: "read",
    response: z.object({ count: z.number() }),
    responseDescription: "The unread count",
    handler: async ({ db, caller }) => {
      const viewer = await viewerFor(db, audience, caller);
      if (!viewer.principalId) return { count: 0 };
      const unread = db
        .select({ id: changelogEntries.id })
        .from(changelogEntries)
        .where(
          and(
            entryVisible(viewer),
            gt(changelogEntries.publishedAt, readMark(viewer.principalId)),
          ),
        )
        .limit(UNREAD_CAP)
        .as("unread");
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(unread);
      return { count: row?.count ?? 0 };
    },
  });

/** Mount before the /changelog/{entryId} routes: /changelog/unread would match them. */
export const changelogEngagementRoutes = (audience: Customer) =>
  apiRouter()
    .openapi(...getChangelogUnread(audience))
    .openapi(...markChangelogRead(audience))
    .openapi(...setChangelogReaction(audience));
