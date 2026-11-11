import { eq } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { requireWorkspaceEntitlement } from "../framework/platform-reads";

// The "Powered by" badge on the portal, widget and branded mail. Hiding it is a paid feature,
// as in the source; showing it again is always allowed. The public read waits for the portal audience.

const flag = z.object({ showPoweredBy: z.boolean() });

const read = defineQuillsRoute({
  method: "get",
  path: "/operations/powered-by",
  operationId: "getQuillsPoweredBy",
  summary: 'Get whether the "Powered by" badge shows',
  action: "read",
  response: flag,
  responseDescription: "The badge setting",
  handler: async ({ db }) => {
    const [row] = await db
      .select({ showPoweredBy: settings.showPoweredBy })
      .from(settings)
      .limit(1);
    if (!row) throw new Error("Quills settings were not initialized");
    return row;
  },
});

const update = defineQuillsRoute({
  method: "put",
  path: "/operations/powered-by",
  operationId: "setQuillsPoweredBy",
  summary: 'Show or hide the "Powered by" badge',
  description:
    "Hiding the badge returns 402 when the workspace's cloud plan is not active.",
  action: "manage_settings",
  body: flag,
  load: async ({ body, workspaceId }) => {
    if (!body.showPoweredBy) await requireWorkspaceEntitlement(workspaceId);
  },
  response: flag,
  responseDescription: "The badge setting",
  event: ({ workspaceId }) => ({
    type: "settings.powered_by_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body, workspaceId }) => {
    const [row] = await db
      .update(settings)
      .set({ showPoweredBy: body.showPoweredBy })
      .where(eq(settings.workspaceId, workspaceId))
      .returning({ showPoweredBy: settings.showPoweredBy });
    if (!row) throw new Error("Quills settings were not initialized");
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...read)
  .openapi(...update);
