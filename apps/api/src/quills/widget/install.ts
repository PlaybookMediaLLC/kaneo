import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { defineQuillsRoute } from "../framework/define-route";
import { parseJson } from "../settings/area";

// Redeems the pairing code that mintQuillsWidgetInstallCode stores hashed. The code is the
// teammate's grant: a host-app install agent trades it, at most twice within 15 minutes, for
// the widget signing secret, which it keeps in a server-only environment variable.

const redeem = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/widget/install-context",
  operationId: "redeemQuillsWidgetInstallCode",
  summary: "Redeem a widget install pairing code",
  description:
    "Returns the widget signing secret to the holder of a live pairing code and turns the widget on. Use HTTPS.",
  action: "update",
  rateLimit: { limit: 20, windowSeconds: 15 * 60 },
  body: z.object({ code: z.string().trim().min(8).max(80) }),
  response: z.object({ signingSecret: z.string() }),
  responseDescription: "The widget signing secret",
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
      })
      .from(settings)
      .limit(1)
      .for("update");
    // The mint route creates the secret; a missing one means it was never minted here.
    if (!row?.widgetSecret)
      throw new HTTPException(404, {
        message: "Invalid or expired install code",
      });
    await db
      .update(settings)
      .set({
        widgetConfig: JSON.stringify({
          ...parseJson(row.widgetConfig),
          enabled: true,
        }),
      })
      .where(eq(settings.id, row.id));
    return { signingSecret: row.widgetSecret };
  },
});

export default apiRouter().openapi(...redeem);
