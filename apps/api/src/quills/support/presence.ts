import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { readSettingsKey } from "../feedback/settings-json";
import { requireSurface } from "./customer/model";
import { computeOfficeHoursStatus } from "./office-hours-calc";
import { getWaitTimeEstimate } from "./wait-estimate";

// Team availability for customers: the office hours, and live agent presence (RFC 0001 decision D8).
// A teammate's open inbox sends a heartbeat. Each heartbeat keeps one kv_store row per teammate for
// 90 seconds, like the typing markers. The kv sweeper removes expired rows.

const PRESENCE = "support:presence:";
const PRESENCE_TTL_SECONDS = 90;

/**
 * True while a teammate has a live heartbeat and has not set themselves away
 * (setQuillsAgentAvailability). Workspace RLS keeps every row in the caller's workspace.
 * The widget polls this, so both reads use an index: the teammates by (workspace_id,
 * kaneo_user_id), then their own keys by the kv_store primary key. A LIKE on the key prefix
 * would scan every widget session, because the key column does not use the C collation.
 */
export async function agentsOnline(db: Database) {
  const teammates = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        isNotNull(principal.kaneoUserId),
        eq(principal.chatAvailability, "online"),
      ),
    );
  if (!teammates.length) return false;
  const [live] = await db
    .select({ key: kvStore.key })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        inArray(
          kvStore.key,
          teammates.map((teammate) => `${PRESENCE}${teammate.id}`),
        ),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return Boolean(live);
}

/**
 * Whether the stored office hours (support/support-settings.ts) are open at `now`. Off, unset or
 * a value that its own schema refuses reads as open, as the settings read does. An interval whose
 * end is before its start runs past midnight.
 */
export function withinOfficeHours(stored: unknown, now: Date) {
  return computeOfficeHoursStatus(stored, now).withinOfficeHours;
}

/** The team's availability and honest wait-time estimate, as the widget and the portal show it (#333). */
export const presenceSchema = z.object({
  agentsOnline: z.boolean(),
  withinOfficeHours: z.boolean(),
  nextOpenAt: z.string().nullable().optional(),
  estimatedWaitMinutes: z.number().nullable().optional(),
  estimatedWaitRange: z
    .object({
      minMinutes: z.number(),
      maxMinutes: z.number(),
      medianMinutes: z.number(),
      label: z.string(),
    })
    .nullable()
    .optional(),
});

export async function teamPresence(db: Database) {
  const [online, storedHours, wait] = await Promise.all([
    agentsOnline(db),
    readSettingsKey(db, "metadata", "officeHours"),
    getWaitTimeEstimate(db),
  ]);
  const office = computeOfficeHoursStatus(storedHours, new Date());
  return {
    agentsOnline: online,
    withinOfficeHours: office.withinOfficeHours,
    nextOpenAt: office.nextOpenAt,
    estimatedWaitMinutes: wait?.medianMinutes ?? null,
    estimatedWaitRange: wait
      ? {
          minMinutes: wait.minMinutes,
          maxMinutes: wait.maxMinutes,
          medianMinutes: wait.medianMinutes,
          label: wait.label,
        }
      : null,
  };
}

const heartbeat = defineQuillsRoute({
  method: "put",
  path: "/support/presence",
  operationId: "sendQuillsAgentHeartbeat",
  summary: "Mark the caller as online in the support inbox",
  description:
    "Send it about every 30 seconds while the inbox is open. The mark lapses 90 seconds after the last heartbeat. A teammate set to away does not count as online.",
  action: "update",
  response: z.object({ ok: z.literal(true) }),
  responseDescription: "The heartbeat is stored",
  event: { none: "Expiring marker: the heartbeat lapses after 90 seconds" },
  handler: async ({ db, actor }) => {
    const expiresAt = sql`now() + make_interval(secs => ${PRESENCE_TTL_SECONDS})`;
    await db
      .insert(kvStore)
      .values({
        workspaceKey: "_",
        key: `${PRESENCE}${actor.principalId}`,
        value: {},
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
        set: { expiresAt },
      });
    return { ok: true as const };
  },
});

const portalPresence = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/support/presence",
  operationId: "getQuillsConversationPresence",
  summary: "Get the team's availability for the portal support pages",
  description:
    "agentsOnline is true while a teammate who is not set to away has the inbox open. withinOfficeHours follows the workspace office hours. 404 while the portal or its support switch is off.",
  action: "read",
  response: presenceSchema,
  responseDescription: "The team's availability",
  errors: { 404: "Portal or support not found" },
  handler: async ({ db, caller }) => {
    await requireSurface(db, "portal", caller, "messenger");
    return teamPresence(db);
  },
});

/** Teammate route: the inbox heartbeat. */
export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...heartbeat,
);

/** Portal route under /quills-public/{workspace}. */
export const portalPresenceRoutes = apiRouter().openapi(...portalPresence);
