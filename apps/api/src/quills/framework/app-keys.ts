import { eq } from "drizzle-orm";
import db from "../../database";
import { apikeyTable } from "../../database/schema";
import type { PermissionMap } from "../../utils/role-permissions";

// The only Quills module that writes public.apikey: the API key of an app (RFC 0001, D14). The key
// and the app row live in two stores and never share a transaction. The app routes of the path
// workspace therefore need both: the key's scope and an active app row (see apps/ROUTES.md).

/**
 * Mints the API key of a new app for `userId` through the better-auth API-key plugin, as the API
 * key settings do, but with `permissions`. The secret is returned once and never stored or logged.
 */
export async function mintAppKey(input: {
  userId: string;
  name: string;
  permissions: PermissionMap;
}) {
  // Loaded on use: the auth module needs the server configuration, which Quills tests do not load.
  const { auth } = await import("../../auth");
  const key = await auth.api.createApiKey({
    body: {
      userId: input.userId,
      // The plugin limits a key name to 32 characters.
      name: `App ${input.name}`.slice(0, 32),
      permissions: input.permissions,
    },
  });
  return { id: key.id, secret: key.key };
}

/** Removes an app's API key that no committed app row holds. Its secret never left the request. */
export async function deleteAppKey(apiKeyId: string) {
  await db.delete(apikeyTable).where(eq(apikeyTable.id, apiKeyId));
}

/** Sets the scope of an app's API key. The app gate also checks the app's capabilities. */
export async function setAppKeyScope(
  apiKeyId: string,
  permissions: PermissionMap,
) {
  await db
    .update(apikeyTable)
    .set({ permissions: JSON.stringify(permissions), updatedAt: new Date() })
    .where(eq(apikeyTable.id, apiKeyId));
}
