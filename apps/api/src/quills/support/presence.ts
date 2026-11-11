import { and, eq, gt, inArray, isNotNull, like, sql } from "drizzle-orm";
import { isValidTypeId, type PrincipalId } from "@kaneo/ids";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { readSettingsKey } from "../feedback/settings-json";
import { requireSurface } from "./customer/model";
import { officeHoursSchema } from "./support-settings";

// Team availability for customers: the office hours, and live agent presence (RFC 0001 decision D8).
// A teammate's open inbox sends a heartbeat. Each heartbeat keeps one kv_store row per teammate for
// 90 seconds, like the typing markers. The kv sweeper removes expired rows.

const PRESENCE = "support:presence:";
const PRESENCE_TTL_SECONDS = 90;

/**
 * True while a teammate has a live heartbeat and has not set themselves away
 * (setQuillsAgentAvailability). Workspace RLS keeps every row in the caller's workspace.
 */
export async function agentsOnline(db: Database) {
  const rows = await db
    .select({ key: kvStore.key })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        like(kvStore.key, `${PRESENCE}%`),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .limit(1000);
  const ids = rows
    .map((row) => row.key.slice(PRESENCE.length))
    .filter((id): id is PrincipalId => isValidTypeId(id, "principal"));
  if (!ids.length) return false;
  const [agent] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        inArray(principal.id, ids),
        isNotNull(principal.kaneoUserId),
        eq(principal.chatAvailability, "online"),
      ),
    )
    .limit(1);
  return Boolean(agent);
}

/** The weekday (0 = Sunday), date and HH:MM of `now` in `timeZone`. */
function localTime(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday!,
    ),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Whether the stored office hours (support/support-settings.ts) are open at `now`. Off, unset or
 * a value that its own schema refuses reads as open, as the settings read does. An interval whose
 * end is before its start runs past midnight.
 */
export function withinOfficeHours(stored: unknown, now: Date) {
  const parsed = officeHoursSchema.safeParse(stored);
  if (!parsed.success || !parsed.data.enabled) return true;
  const hours = parsed.data;
  const local = localTime(now, hours.timezone);
  if (
    hours.holidays.some(
      (h) =>
        h.date === local.date ||
        (h.recurringAnnual && h.date.slice(5) === local.date.slice(5)),
    )
  )
    return false;
  const yesterday = (local.day + 6) % 7;
  return hours.intervals.some(({ day, start, end }) =>
    start < end
      ? day === local.day && local.time >= start && local.time < end
      : (day === local.day && local.time >= start) ||
        (day === yesterday && local.time < end),
  );
}

/** The team's availability, as the widget and the portal show it. */
export const presenceSchema = z.object({
  agentsOnline: z.boolean(),
  withinOfficeHours: z.boolean(),
});

export async function teamPresence(db: Database) {
  return {
    agentsOnline: await agentsOnline(db),
    withinOfficeHours: withinOfficeHours(
      await readSettingsKey(db, "metadata", "officeHours"),
      new Date(),
    ),
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
