import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import {
  integrationPlatformCredentials as platform,
  integrations,
} from "../../database/quills/schema/integrations";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { openCredentials } from "../framework/integration-config";
import { signedUrl } from "../integrations/oauth-providers";
import { SLACK_SCOPES } from "../integrations/providers/slack";

// The Slack assistant switch (settings.assistant_config agents.workspace.slack.enabled). When it is
// on, the signed Slack hook (integrations/slack-hook.ts) accepts mentions and direct messages, and
// the quills.ai worker answers them (engine/slack.ts).

const view = z.object({
  revision: z.number(),
  enabled: z.boolean(),
  active: z.boolean(),
  missingScopes: z.array(z.string()),
  signingConfigured: z.boolean(),
  hookUrl: z.string().nullable(),
});
const stale = () =>
  new HTTPException(409, {
    message: "The settings changed since you read them. Reload them.",
  });

async function read(db: Database) {
  const [row] = await db
    .select({
      config: settings.assistantConfig,
      revision: settings.assistantConfigRevision,
    })
    .from(settings)
    .limit(1);
  if (!row) throw new Error("Quills workspace was not initialized");
  const [slack] = await db
    .select({
      id: integrations.id,
      status: integrations.status,
      config: integrations.config,
    })
    .from(integrations)
    .where(eq(integrations.integrationType, "slack"));
  const [app] = await db
    .select({ secrets: platform.secrets })
    .from(platform)
    .where(eq(platform.integrationType, "slack"));
  const scopes = (slack?.config as { scopes?: unknown } | undefined)?.scopes;
  const granted = new Set(
    (typeof scopes === "string" ? scopes : "").split(",").map((s) => s.trim()),
  );
  return {
    row,
    view: {
      revision: row.revision,
      enabled: row.config?.agents?.workspace?.slack?.enabled === true,
      active: slack?.status === "active",
      missingScopes: SLACK_SCOPES.filter((scope) => !granted.has(scope)),
      signingConfigured: Boolean(
        app && openCredentials(app.secrets)?.signingSecret,
      ),
      hookUrl: slack
        ? signedUrl(`/integrations/slack/${slack.id}/hooks/events`)
        : null,
    },
  };
}

const getSlackAgent = defineQuillsRoute({
  method: "get",
  path: "/assistant/slack",
  operationId: "getQuillsSlackAgentSettings",
  summary: "Get the Slack assistant settings",
  description:
    "Whether the assistant answers in Slack, and what it still needs: an active Slack connection with the assistant scopes, and the Slack app's signing secret. `hookUrl` is the Event Subscriptions URL to register in the Slack app.",
  action: "manage_settings",
  response: view,
  responseDescription: "The Slack assistant settings and their revision",
  handler: async ({ db }) => (await read(db)).view,
});

const setSlackAgent = defineQuillsRoute({
  method: "put",
  path: "/assistant/slack",
  operationId: "setQuillsSlackAssistantEnabled",
  summary: "Turn the Slack assistant on or off",
  description:
    "Send the revision you read; another writer's change since then returns 409. Turning it on needs an active Slack connection with every scope in `missingScopes` granted, and the signing secret.",
  action: "manage_settings",
  body: z.object({
    expectedRevision: z.number().int().min(1).max(2147483647),
    enabled: z.boolean(),
  }),
  response: view,
  responseDescription: "The updated Slack assistant settings",
  errors: {
    409: "Slack is not ready, or the settings changed since you read them",
  },
  event: (_input, result) => ({
    type: "slack_agent.settings_updated",
    entityType: "settings",
    entityId: "assistant",
    payload: { enabled: String(result.enabled) },
  }),
  handler: async ({ db, body }) => {
    const { row, view: current } = await read(db);
    if (row.revision !== body.expectedRevision) throw stale();
    if (
      body.enabled &&
      (!current.active ||
        current.missingScopes.length ||
        !current.signingConfigured)
    )
      throw new HTTPException(409, {
        message:
          "Reconnect Slack with the assistant permissions and save the Slack app's signing secret first.",
      });
    const agents = row.config?.agents;
    const [updated] = await db
      .update(settings)
      .set({
        assistantConfig: {
          ...row.config,
          agents: {
            ...agents,
            workspace: {
              ...agents?.workspace,
              slack: { ...agents?.workspace?.slack, enabled: body.enabled },
            },
          },
        },
        assistantConfigRevision: sql`${settings.assistantConfigRevision} + 1`,
      })
      .where(eq(settings.assistantConfigRevision, body.expectedRevision))
      .returning({ revision: settings.assistantConfigRevision });
    if (!updated) throw stale();
    return { ...current, revision: updated.revision, enabled: body.enabled };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSlackAgent)
  .openapi(...setSlackAgent);
