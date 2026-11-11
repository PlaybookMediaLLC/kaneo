import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { postVotes, posts } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { coerce } from "../directory/customer";
import type { Database } from "../framework/define-route";
import { readSettingsKey } from "../feedback/settings-json";

// Route-module helper: the optional claims of a signed identify token. The token is signed with
// the widget secret, so the host app vouches for each claim; each is still bounded and validated,
// and a bad value is dropped instead of failing identify (as in the source).

/** Identity fields and JWT metadata: never custom attributes. */
const RESERVED = new Set([
  "sub",
  "id",
  "email",
  "name",
  "avatarURL",
  "avatarUrl",
  "segments",
  "exp",
  "iat",
  "nbf",
  "iss",
  "aud",
  "jti",
]);
const MAX_ATTRIBUTES = 50;
const MAX_SEGMENTS = 50;

/** Custom claims that match a user attribute definition, coerced to its type. Others are dropped. */
export async function claimedAttributes(
  db: Database,
  claims: Record<string, unknown>,
) {
  const values = new Map<string, string | number | boolean>();
  for (const [key, value] of Object.entries(claims)) {
    if (values.size >= MAX_ATTRIBUTES) break;
    if (RESERVED.has(key) || key.startsWith("_") || key.length > 64) continue;
    if (
      (typeof value === "string" && value.length <= 1000) ||
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    )
      values.set(key, value);
  }
  if (!values.size) return {};
  const definitions = await db
    .select({
      key: userAttributeDefinitions.key,
      type: userAttributeDefinitions.type,
    })
    .from(userAttributeDefinitions)
    .where(inArray(userAttributeDefinitions.key, [...values.keys()]));
  const set: Record<string, string | number | boolean> = {};
  for (const { key, type } of definitions) {
    const coerced = coerce(values.get(key)!, type);
    if (coerced !== undefined) set[key] = coerced;
  }
  return set;
}

/**
 * Makes the person's widget-sourced memberships match the `segments` claim (manual segments by
 * slug; unknown slugs are dropped). A missing claim removes every widget-sourced membership, so a
 * customer who lost a plan loses its segment. Memberships from other sources stay.
 */
export async function reconcileClaimedSegments(
  db: Database,
  principalId: PrincipalId,
  claim: unknown,
) {
  const slugs = [
    ...new Set(
      (Array.isArray(claim) ? claim : []).filter(
        (slug): slug is string =>
          typeof slug === "string" && slug.length > 0 && slug.length <= 100,
      ),
    ),
  ].slice(0, MAX_SEGMENTS);
  const wanted = slugs.length
    ? (
        await db
          .select({ id: segments.id })
          .from(segments)
          .where(
            and(
              inArray(segments.slug, slugs),
              eq(segments.type, "manual"),
              isNull(segments.deletedAt),
            ),
          )
      ).map((row) => row.id)
    : [];
  await db
    .delete(userSegments)
    .where(
      and(
        eq(userSegments.principalId, principalId),
        eq(userSegments.addedBy, "widget"),
        ...(wanted.length ? [notInArray(userSegments.segmentId, wanted)] : []),
      ),
    );
  if (wanted.length)
    await db
      .insert(userSegments)
      .values(
        wanted.map((segmentId) => ({
          principalId,
          segmentId,
          addedBy: "widget" as const,
        })),
      )
      .onConflictDoNothing();
}

/**
 * Subscribes the person to the changelog when the workspace auto-subscribes (the default). A person
 * who unsubscribed keeps their row and is never subscribed again here.
 */
export async function autoSubscribeChangelog(
  db: Database,
  principalId: PrincipalId,
) {
  const stored = await readSettingsKey(db, "metadata", "changelogSettings");
  const autoSubscribe =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as { autoSubscribe?: unknown }).autoSubscribe
      : undefined;
  if (autoSubscribe === false) return;
  await db
    .insert(changelogSubscriptions)
    .values({ principalId, source: "auto" })
    .onConflictDoNothing();
}

// ponytail: the newest 500 votes; page them if widget users vote more than that.
const MAX_VOTED = 500;

/** The live posts the person voted on, newest vote first. */
export async function votedPostIds(db: Database, principalId: PrincipalId) {
  const rows = await db
    .select({ postId: postVotes.postId })
    .from(postVotes)
    .innerJoin(posts, eq(posts.id, postVotes.postId))
    .where(and(eq(postVotes.principalId, principalId), isNull(posts.deletedAt)))
    .orderBy(desc(postVotes.createdAt))
    .limit(MAX_VOTED);
  return rows.map((row) => row.postId);
}
