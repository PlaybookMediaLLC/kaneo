import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";

// Requests a wipe of the workspace's Quills feature data. The request only records the event;
// the quills.wipe job (jobs/handlers/wipe.ts) deletes the data after commit, in one transaction.

const wipe = defineQuillsRoute({
  method: "post",
  path: "/operations/wipe",
  operationId: "wipeQuillsWorkspaceData",
  summary: "Wipe the workspace's Quills data",
  description:
    "`confirm` must equal the workspace slug, or the request returns 400. A background job then deletes all of the workspace's Quills data and cannot be undone: feedback, support, help center, status page and customer data, and also Quills configuration such as webhooks, integrations, Quills API keys and OAuth clients, Quills teams (with their workspace team bindings), sending domains, workflows, macros, SLA policies and ticket types. It keeps the workspace and its members, teammate actors, Quills settings, the default statuses and roles, custom domains and the audit history.",
  action: "manage_settings",
  body: z.object({ confirm: z.string().min(1).max(200) }),
  response: z.object({ queued: z.boolean() }),
  responseDescription: "The wipe is queued",
  event: ({ workspaceId }) => ({
    type: "workspace.wipe_requested",
    entityType: "workspace",
    entityId: workspaceId,
  }),
  handler: async ({ db, body, workspaceId }) => {
    // Kaneo's slug: a database hook keeps the settings copy current.
    const [row] = await db
      .select({ slug: settings.slug })
      .from(settings)
      .where(eq(settings.workspaceId, workspaceId));
    if (!row) throw new Error("Quills settings were not initialized");
    if (body.confirm !== row.slug)
      throw new HTTPException(400, {
        message: "Type the workspace slug to confirm",
      });
    return { queued: true };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...wipe,
);
