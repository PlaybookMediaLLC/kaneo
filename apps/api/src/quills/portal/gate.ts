import { HTTPException } from "hono/http-exception";
import { settings } from "../../database/quills/schema/auth";
import { evaluatePortalAccess, type QuillsCaller } from "../framework/audience";
import type { Database } from "../framework/define-route";
import { parseJson } from "../settings/area";

// Route-module helper: the portal on/off switch and the private-portal gate.

/**
 * 404 while the portal is off. Portals are opt-in: the portal settings key `enabled` must be true.
 * The portal settings routes own that key; this module only reads it.
 */
export async function requirePortalEnabled(db: Database) {
  const [row] = await db
    .select({ portalConfig: settings.portalConfig })
    .from(settings)
    .limit(1);
  if (parseJson(row?.portalConfig ?? null).enabled !== true)
    throw new HTTPException(404, { message: "Portal not found" });
}

/** 404 while the portal is off, 403 when the caller may not open a private portal. */
export async function requirePortalAccess(db: Database, caller: QuillsCaller) {
  await requirePortalEnabled(db);
  if (!(await evaluatePortalAccess(db, caller)).granted)
    throw new HTTPException(403, { message: "Portal access denied" });
}
