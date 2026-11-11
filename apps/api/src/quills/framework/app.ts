import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { z } from "zod";
import type { Database } from "../../database/quills/client";
import { apps } from "../../database/quills/schema/apps";
import { ApiError } from "../../errors/api-error";
import type { changeSchema } from "../events";
import type { QuillsAction } from "../with-quills-request";

// The app audience (RFC 0001, D9 and D12 to D15). A sidebar app calls with a Kaneo API key that has
// quills scopes and is bound to one active `apps` row of the path workspace. The caller is the key's
// owner, so every teammate check still runs; this module adds the binding gate and its capability.

export const appCapabilities = ["read:feedback", "write:feedback"] as const;
export type AppCapability = (typeof appCapabilities)[number];
export type AppCaller = { id: string; name: string };

/** The Quills actions that an app's API key needs for each capability. */
export const capabilityActions: Record<AppCapability, QuillsAction[]> = {
  "read:feedback": ["read"],
  "write:feedback": ["create", "update"],
};

/**
 * The Quills actions that an app with `scopes` needs on its key. The caller who grants the scopes
 * must hold each one (`actions`, the role within the caller's own key scope); otherwise 403.
 */
export function grantedActions(
  actions: ReadonlySet<QuillsAction>,
  scopes: readonly AppCapability[],
) {
  const needed = [
    ...new Set(scopes.flatMap((scope) => capabilityActions[scope])),
  ];
  const missing = needed.filter((action) => !actions.has(action));
  if (missing.length)
    throw new ApiError(403, {
      message: "The app's scopes need Quills actions that you do not hold",
      code: "MISSING_PERMISSION",
      missingPermissions: missing.map((action) => `quills:${action}`),
    });
  return needed;
}

const notBound = () =>
  new ApiError(403, {
    message: "Use an API key that is bound to an active app of this workspace",
    code: "APP_NOT_BOUND",
  });

/**
 * App routes, before the permission checks: the caller's API key ID. A session (no key) is
 * APP_NOT_BOUND; an unscoped key is API_KEY_SCOPE, because it carries the owner's whole authority.
 */
export function appKey(c: Context): string {
  const key = c.get("apiKey") as
    | { id: string; permissions: Record<string, string[]> | null }
    | undefined;
  if (!key) throw notBound();
  if (!key.permissions)
    throw new ApiError(403, {
      message: "An app needs an API key with quills scopes",
      code: "API_KEY_SCOPE",
    });
  return key.id;
}

/**
 * App routes: the first statement of each scoped transaction. RLS limits the read to the path
 * workspace, so a key bound only in another workspace, a disabled app and no binding look the same.
 */
export async function boundApp(
  db: Database,
  apiKeyId: string,
  capability: AppCapability,
): Promise<AppCaller> {
  const [app] = await db
    .select({ id: apps.id, name: apps.name, scopes: apps.grantedScopes })
    .from(apps)
    .where(and(eq(apps.apiKeyId, apiKeyId), eq(apps.status, "active")))
    .limit(1);
  if (!app) throw notBound();
  if (!app.scopes.includes(capability))
    throw new ApiError(403, {
      message: `The app does not hold the ${capability} capability`,
      code: "APP_SCOPE",
    });
  return { id: app.id, name: app.name };
}

/**
 * Teammate routes called with an API key: the first statement of each scoped transaction. A key
 * that an app of this workspace holds, active or disabled, works only on the app routes. A disabled
 * app's key must not get its teammate access back. One lookup on apps_api_key_id_idx.
 */
export async function confineKey(db: Database, apiKeyId: string) {
  const [bound] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.apiKeyId, apiKeyId))
    .limit(1);
  if (bound)
    throw new ApiError(403, {
      message:
        "This API key belongs to an app; it works only on the app routes",
      code: "APP_KEY_CONFINED",
    });
}

/** Adds the app to the metadata of a change that an app request records. */
export const withApp = (
  change: z.input<typeof changeSchema>,
  appId: string,
): z.input<typeof changeSchema> => ({
  ...change,
  payload: { ...change.payload, appId },
});
