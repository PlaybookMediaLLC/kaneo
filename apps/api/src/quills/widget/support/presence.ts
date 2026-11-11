import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { apiRouter, z } from "../../../openapi";
import { principal, settings } from "../../../database/quills/schema/auth";
import { widgetEnabled } from "../../framework/audience";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { readSettingsKey } from "../../feedback/settings-json";
import { notFound } from "../../support/customer/model";
import { officeHoursSchema } from "../../support/support-settings";

// Workspace-wide messenger reads that need no visitor: office hours and the team avatar cluster.
// Both are public while the widget is on. Neither returns an ID or an email.

async function requireWidget(db: Database) {
  const [row] = await db
    .select({ widgetConfig: settings.widgetConfig })
    .from(settings)
    .limit(1);
  if (!widgetEnabled(row?.widgetConfig ?? null)) throw notFound("Widget");
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

const presence = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/widget/presence",
  operationId: "getQuillsWidgetPresence",
  summary: "Get the team's messenger availability",
  description:
    "withinOfficeHours follows the workspace office hours. agentsOnline is null: Kaneo keeps no live agent presence, so it is unknown.",
  action: "read",
  response: z.object({
    agentsOnline: z.boolean().nullable(),
    withinOfficeHours: z.boolean(),
  }),
  responseDescription: "The team's availability",
  handler: async ({ db }) => {
    await requireWidget(db);
    return {
      agentsOnline: null,
      withinOfficeHours: withinOfficeHours(
        await readSettingsKey(db, "metadata", "officeHours"),
        new Date(),
      ),
    };
  },
});

const avatars = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/widget/team-avatars",
  operationId: "listQuillsWidgetTeamAvatars",
  summary: "List up to three teammate avatars for the widget header",
  description:
    "Display name and avatar of teammate principals only: never a customer, a visitor or a service principal.",
  action: "read",
  response: z.object({
    items: z.array(
      z.object({ name: z.string(), avatarUrl: z.string().nullable() }),
    ),
  }),
  responseDescription: "Teammate avatars",
  handler: async ({ db }) => {
    await requireWidget(db);
    // ponytail: a former member keeps a teammate principal and can appear; a public route has no platform read for the roster.
    const rows = await db
      .select({ name: principal.displayName, avatarUrl: principal.avatarUrl })
      .from(principal)
      .where(
        and(
          isNotNull(principal.kaneoUserId),
          eq(principal.type, "user"),
          isNull(principal.testOwnerPrincipalId),
          isNotNull(principal.displayName),
        ),
      )
      .orderBy(asc(principal.createdAt), asc(principal.id))
      .limit(3);
    return {
      items: rows.map((row) => ({ name: row.name!, avatarUrl: row.avatarUrl })),
    };
  },
});

export default apiRouter()
  .openapi(...presence)
  .openapi(...avatars);
