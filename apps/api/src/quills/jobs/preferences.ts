import { eq } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import type { Database } from "../../database/quills/client";
import { notificationPreferences } from "../../database/quills/schema/notifications";

/**
 * The source preference rule. Mute stops mail only, an explicit matrix cell wins,
 * the two legacy mail flags apply to their types, and anything else is on.
 */
export async function wants(
  db: Database,
  principalId: PrincipalId,
  type: string,
  channel: "inApp" | "email",
) {
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.principalId, principalId));
  if (!prefs) return true;
  if (channel === "email" && prefs.emailMuted) return false;
  const explicit = prefs.matrix?.[type]?.[channel];
  if (typeof explicit === "boolean") return explicit;
  if (channel === "email" && type === "comment_created")
    return prefs.emailNewComment;
  if (channel === "email" && type === "post_status_changed")
    return prefs.emailStatusChange;
  return true;
}
