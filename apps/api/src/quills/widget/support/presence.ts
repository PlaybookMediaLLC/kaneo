import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { apiRouter, z } from "../../../openapi";
import { principal, settings } from "../../../database/quills/schema/auth";
import { widgetEnabled } from "../../framework/audience";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { notFound } from "../../support/customer/model";
import { presenceSchema, teamPresence } from "../../support/presence";

// Workspace-wide messenger reads that need no visitor: team availability and the avatar cluster.
// Both are public while the widget is on. Neither returns an ID or an email.

async function requireWidget(db: Database) {
  const [row] = await db
    .select({ widgetConfig: settings.widgetConfig })
    .from(settings)
    .limit(1);
  if (!widgetEnabled(row?.widgetConfig ?? null)) throw notFound("Widget");
}

const presence = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/widget/presence",
  operationId: "getQuillsWidgetPresence",
  summary: "Get the team's messenger availability",
  description:
    "agentsOnline is true while a teammate who is not set to away has the inbox open (sendQuillsAgentHeartbeat). withinOfficeHours follows the workspace office hours.",
  action: "read",
  response: presenceSchema,
  responseDescription: "The team's availability",
  handler: async ({ db }) => {
    await requireWidget(db);
    return teamPresence(db);
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
