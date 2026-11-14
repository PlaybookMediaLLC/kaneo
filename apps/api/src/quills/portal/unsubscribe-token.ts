import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import {
  notificationPreferences,
  postSubscriptions,
  unsubscribeTokens,
} from "../../database/quills/schema/notifications";
import { posts } from "../../database/quills/schema/posts";
import { statusSubscriptions } from "../../database/quills/schema/status";
import { hashToken } from "../framework/audience";
import type { Database } from "../framework/define-route";
import { portalPaths } from "./paths";

// Route-module helper: emailed unsubscribe links. The `token` column holds the SHA-256 hash of
// the token, never the token. A token expires after 30 days and works once.

export const UNSUBSCRIBE_ACTIONS = [
  "unsubscribe_post",
  "unsubscribe_all",
  "unsubscribe_changelog",
  "unsubscribe_status",
  // RFC 0003: the shipped notice and the weekly digest.
  "unsubscribe_shipped",
  "unsubscribe_digest",
] as const;
export type UnsubscribeAction = (typeof UNSUBSCRIBE_ACTIONS)[number];
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The notification matrix type whose mail each per-type unsubscribe link turns off. */
export const MAIL_TYPES = {
  unsubscribe_shipped: "post_shipped",
  unsubscribe_digest: "weekly_digest",
} as const;

/** Sets the mail cell of one matrix type. The other types keep their cells. */
export async function setMailPreference(
  db: Database,
  principalId: PrincipalId,
  type: (typeof MAIL_TYPES)[keyof typeof MAIL_TYPES],
  email: boolean,
) {
  const cell = { [type]: { email } };
  await db
    .insert(notificationPreferences)
    .values({ principalId, matrix: cell })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.workspaceId,
        notificationPreferences.principalId,
      ],
      set: {
        matrix: sql`coalesce(${notificationPreferences.matrix}, '{}'::jsonb) || ${JSON.stringify(cell)}::jsonb`,
        updatedAt: new Date(),
      },
    });
}

export const apiBase = () => {
  const base = (process.env.KANEO_API_URL || "http://localhost:1337").replace(
    /\/+$/,
    "",
  );
  return base.endsWith("/api") ? base : `${base}/api`;
};

/**
 * The RFC 8058 one-click URL for List-Unsubscribe and the mail footer. A POST unsubscribes; a GET
 * of the same URL only previews, because mail scanners open every link.
 */
export const unsubscribeUrl = (workspaceId: string, token: string) =>
  `${apiBase()}/quills-public/${encodeURIComponent(workspaceId)}/unsubscribe?token=${token}`;

/** The browser page used in the message body. The RFC 8058 header keeps `unsubscribeUrl`. */
export const unsubscribePageUrl = (workspaceId: string, token: string) =>
  portalPaths.unsubscribe(workspaceId, token);

/**
 * Stores the hash of a new token for one recipient and action, and returns the token. The only
 * mint for every unsubscribe link, the status page's included: `/unsubscribe` and
 * `/status/unsubscribe` both accept an `unsubscribe_status` token.
 */
export async function mintUnsubscribeToken(
  db: Database,
  principalId: PrincipalId,
  action: UnsubscribeAction,
  postId: PostId | null = null,
  expiresAt = new Date(Date.now() + TTL_MS),
) {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  await db.insert(unsubscribeTokens).values({
    token: hashToken(token),
    principalId,
    postId,
    action,
    expiresAt,
  });
  return token;
}

/** The unused, unexpired token row for `token`, with the title of its post, or undefined. */
export async function liveToken(db: Database, token: string, lock = false) {
  const query = db
    .select({
      id: unsubscribeTokens.id,
      principalId: unsubscribeTokens.principalId,
      postId: unsubscribeTokens.postId,
      action: unsubscribeTokens.action,
    })
    .from(unsubscribeTokens)
    .where(
      and(
        eq(unsubscribeTokens.token, hashToken(token)),
        isNull(unsubscribeTokens.usedAt),
        gt(unsubscribeTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row || !(UNSUBSCRIBE_ACTIONS as readonly string[]).includes(row.action))
    return undefined;
  const [post] = row.postId
    ? await db
        .select({ title: posts.title })
        .from(posts)
        .where(eq(posts.id, row.postId))
    : [];
  return {
    ...row,
    action: row.action as UnsubscribeAction,
    postTitle: post?.title ?? null,
  };
}

/** Applies the token's action and spends the token, in the caller's transaction. Every action is idempotent. */
export async function spendToken(
  db: Database,
  row: NonNullable<Awaited<ReturnType<typeof liveToken>>>,
) {
  const now = new Date();
  if (row.action === "unsubscribe_post" && row.postId)
    await db
      .delete(postSubscriptions)
      .where(
        and(
          eq(postSubscriptions.postId, row.postId),
          eq(postSubscriptions.principalId, row.principalId),
        ),
      );
  if (row.action === "unsubscribe_all")
    await db
      .insert(notificationPreferences)
      .values({ principalId: row.principalId, emailMuted: true })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.workspaceId,
          notificationPreferences.principalId,
        ],
        set: { emailMuted: true, updatedAt: now },
      });
  if (row.action === "unsubscribe_changelog")
    await db
      .update(changelogSubscriptions)
      .set({ unsubscribedAt: now })
      .where(
        and(
          eq(changelogSubscriptions.principalId, row.principalId),
          isNull(changelogSubscriptions.unsubscribedAt),
        ),
      );
  if (row.action === "unsubscribe_status")
    await db
      .update(statusSubscriptions)
      .set({ unsubscribedAt: now, updatedAt: now })
      .where(
        and(
          eq(statusSubscriptions.principalId, row.principalId),
          isNull(statusSubscriptions.unsubscribedAt),
        ),
      );
  const type = MAIL_TYPES[row.action as keyof typeof MAIL_TYPES];
  if (type) await setMailPreference(db, row.principalId, type, false);
  await db
    .update(unsubscribeTokens)
    .set({ usedAt: now })
    .where(
      and(eq(unsubscribeTokens.id, row.id), isNull(unsubscribeTokens.usedAt)),
    );
}
