import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { segments } from "../../database/quills/schema/segments";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { defineQuillsRoute } from "../framework/define-route";
import { readPortalSignIn } from "../framework/portal-sign-in";
import { parseJson, portalOn } from "../settings/area";
import { widgetTabs } from "../settings/widget-tabs";

// Redeems the pairing code that mintQuillsWidgetInstallCode stores hashed. The code is the
// teammate's grant: a host-app install agent trades it, at most twice within 15 minutes, for
// the widget signing secret and non-sensitive workspace setup metadata, keeping the secret
// in a server-only environment variable.

const redeem = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/widget/install-context",
  operationId: "redeemQuillsWidgetInstallCode",
  summary: "Redeem a widget install pairing code",
  description:
    "Returns the widget signing secret and workspace setup metadata (enabled tabs, portal sign-in flags, defined user attributes and manual segment slugs) to the holder of a live pairing code, and turns the widget on. Use HTTPS.",
  action: "update",
  rateLimit: { limit: 20, windowSeconds: 15 * 60 },
  body: z.object({ code: z.string().trim().min(8).max(80) }),
  response: z.object({
    signingSecret: z.string(),
    tabs: z.object({
      home: z.boolean(),
      messenger: z.boolean(),
      feedback: z.boolean(),
      changelog: z.boolean(),
      help: z.boolean(),
      tickets: z.boolean(),
    }),
    portalEnabled: z.boolean(),
    widgetSignIn: z.boolean(),
    userAttributes: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.string(),
      }),
    ),
    manualSegments: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
      }),
    ),
  }),
  responseDescription: "The widget signing secret and workspace setup metadata",
  errors: { 404: "Invalid or expired install code" },
  allowKeys: ["signingSecret"],
  event: ({ workspaceId }) => ({
    type: "settings.widget_install_code_redeemed",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) => {
    const used = await db
      .update(kvStore)
      .set({
        value: sql`jsonb_set(${kvStore.value}, '{remaining}', to_jsonb((${kvStore.value}->>'remaining')::int - 1))`,
      })
      .where(
        and(
          eq(kvStore.workspaceKey, "_"),
          eq(
            kvStore.key,
            sql`'widget:install-pairing:' || encode(sha256(convert_to(${body.code}, 'UTF8')), 'hex')`,
          ),
          sql`${kvStore.expiresAt} > now()`,
          sql`coalesce((${kvStore.value}->>'remaining')::int, 0) > 0`,
        ),
      )
      .returning({ key: kvStore.key });
    if (!used.length)
      throw new HTTPException(404, {
        message: "Invalid or expired install code",
      });
    const [row] = await db
      .select({
        id: settings.id,
        widgetSecret: settings.widgetSecret,
        widgetConfig: settings.widgetConfig,
        portalConfig: settings.portalConfig,
      })
      .from(settings)
      .limit(1)
      .for("update");
    // The mint route creates the secret; a missing one means it was never minted here.
    if (!row?.widgetSecret)
      throw new HTTPException(404, {
        message: "Invalid or expired install code",
      });
    const nextWidgetConfig = {
      ...parseJson(row.widgetConfig),
      enabled: true,
    };
    await db
      .update(settings)
      .set({
        widgetConfig: JSON.stringify(nextWidgetConfig),
      })
      .where(eq(settings.id, row.id));
    const [attrs, segs] = await Promise.all([
      db
        .select({
          key: userAttributeDefinitions.key,
          label: userAttributeDefinitions.label,
          type: userAttributeDefinitions.type,
        })
        .from(userAttributeDefinitions)
        .orderBy(asc(userAttributeDefinitions.key))
        .limit(50),
      db
        .select({
          slug: segments.slug,
          name: segments.name,
        })
        .from(segments)
        .where(and(eq(segments.type, "manual"), isNull(segments.deletedAt)))
        .orderBy(asc(segments.slug))
        .limit(50),
    ]);
    const portalEnabled = portalOn(row.portalConfig);
    const signIn = readPortalSignIn(row.portalConfig);
    return {
      signingSecret: row.widgetSecret,
      tabs: widgetTabs(nextWidgetConfig),
      portalEnabled,
      widgetSignIn: portalEnabled && signIn.widgetSignIn,
      userAttributes: attrs,
      manualSegments: segs,
    };
  },
});

export default apiRouter().openapi(...redeem);
