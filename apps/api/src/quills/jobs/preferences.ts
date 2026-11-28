import { eq } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import type { Database } from "../../database/quills/client";
import { notificationPreferences } from "../../database/quills/schema/notifications";
import { readSettingsKey } from "../feedback/settings-json";

export type NotificationChannel = "inApp" | "email" | "push" | "slackDm";

export type NotificationMatrix = Partial<
  Record<string, Partial<Record<NotificationChannel, boolean>>>
>;

export interface WorkspaceNotificationDefaults {
  matrix: NotificationMatrix;
  digestFrequency: "off" | "hourly" | "daily";
}

/**
 * Quiet-by-default teammate notification matrix (#321):
 * - Direct, actionable signals (mentions, direct assignments, replies on assigned threads)
 *   default ON for in-app/email/push/slackDm.
 * - Broadcast / high-volume signals (unassigned inbox arrivals, ticket watches, closed threads)
 *   default OFF for email, push, and Slack DM so teammates are never spammed on day one.
 */
export const QUIET_NOTIFICATION_DEFAULTS: Record<
  string,
  Record<NotificationChannel, boolean>
> = {
  note_mention: { inApp: true, email: true, push: true, slackDm: true },
  post_mention: { inApp: true, email: true, push: true, slackDm: true },
  conversation_assigned: {
    inApp: true,
    email: true,
    push: true,
    slackDm: true,
  },
  customer_reply_assigned: {
    inApp: true,
    email: true,
    push: true,
    slackDm: true,
  },
  ticket_assigned: { inApp: true, email: true, push: true, slackDm: true },
  conversation_routed_team: {
    inApp: true,
    email: false,
    push: false,
    slackDm: false,
  },
  conversation_unassigned: {
    inApp: true,
    email: false,
    push: false,
    slackDm: false,
  },
  ticket_watch: { inApp: true, email: false, push: false, slackDm: false },
  webhook_failing: { inApp: true, email: true, push: false, slackDm: false },
};

export async function readWorkspaceNotificationDefaults(
  db: Database,
): Promise<WorkspaceNotificationDefaults> {
  const raw = await readSettingsKey(db, "metadata", "notificationDefaults");
  if (!raw || typeof raw !== "object") {
    return { matrix: {}, digestFrequency: "off" };
  }
  const bag = raw as Record<string, unknown>;
  const digest =
    bag.digestFrequency === "hourly" || bag.digestFrequency === "daily"
      ? bag.digestFrequency
      : "off";
  const matrix =
    bag.matrix && typeof bag.matrix === "object" && !Array.isArray(bag.matrix)
      ? (bag.matrix as NotificationMatrix)
      : {};
  return { matrix, digestFrequency: digest };
}

/**
 * Resolves whether `principalId` wants a notification of `type` on `channel`:
 * 1. Global email mute stops email immediately.
 * 2. Teammate's personal matrix override ALWAYS wins over workspace defaults.
 * 3. Workspace default matrix (set by admins) applies next.
 * 4. Quiet defaults apply for known support types; legacy email flags apply for
 *    feedback `comment_created` and `post_status_changed`.
 */
export async function wants(
  db: Database,
  principalId: PrincipalId,
  type: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.principalId, principalId));
  if (channel === "email" && prefs?.emailMuted) return false;

  const personal = prefs?.matrix?.[type]?.[channel];
  if (typeof personal === "boolean") return personal;

  const wsDefaults = await readWorkspaceNotificationDefaults(db);
  const workspaceDefault = wsDefaults.matrix?.[type]?.[channel];
  if (typeof workspaceDefault === "boolean") return workspaceDefault;

  const quiet = QUIET_NOTIFICATION_DEFAULTS[type]?.[channel];
  if (typeof quiet === "boolean") return quiet;

  if (prefs) {
    if (channel === "email" && type === "comment_created")
      return prefs.emailNewComment;
    if (channel === "email" && type === "post_status_changed")
      return prefs.emailStatusChange;
  }

  // Slack DM and Push are opt-in for unknown/unclassified types so noise stays low.
  if (channel === "slackDm" || channel === "push") return false;
  return true;
}
