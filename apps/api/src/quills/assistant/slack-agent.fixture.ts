import { eq, sql } from "drizzle-orm";
import { settings } from "../../database/quills/schema/auth";
import {
  integrationPlatformCredentials,
  integrations,
} from "../../database/quills/schema/integrations";
import { encryptSecret } from "../../notification-preferences/secrets";
import { fixture, type ContractEnv } from "../framework/contract";
import { SLACK_SCOPES } from "../integrations/providers/slack";
import "../integrations/seed.fixture";

const seal = (values: Record<string, string>) =>
  encryptSecret(JSON.stringify(values))!;

/**
 * A Slack connection with the assistant scopes and the app's signing secret, replacing an earlier
 * one. `enabled` also turns the assistant on.
 */
export function slackConnection(
  env: ContractEnv,
  workspaceId: string,
  enabled = false,
) {
  const signingSecret = `slack-signing-${workspaceId}`;
  const teamId = `T${workspaceId
    .replace(/[^a-z0-9]/gi, "")
    .slice(-12)
    .toUpperCase()}`;
  return env.scoped(workspaceId, async (db, actor) => {
    for (const table of [integrations, integrationPlatformCredentials])
      await db.delete(table).where(eq(table.integrationType, "slack"));
    await db.insert(integrationPlatformCredentials).values({
      integrationType: "slack",
      secrets: seal({
        clientId: "slack-client",
        clientSecret: "slack-client-secret",
        signingSecret,
      }),
    });
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: "slack",
        status: "active",
        secrets: seal({ accessToken: `xoxb-seeded-${workspaceId}` }),
        config: {
          workspaceName: "Contract",
          account: "Contract",
          teamId,
          botUserId: "UBOT",
          scopes: SLACK_SCOPES.join(","),
        },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(),
      })
      .returning({ id: integrations.id });
    await db.update(settings).set({
      assistantConfig: sql`jsonb_set(${settings.assistantConfig}, '{agents,workspace,slack,enabled}', ${JSON.stringify(enabled)}::jsonb)`,
    });
    const [current] = await db
      .select({ revision: settings.assistantConfigRevision })
      .from(settings);
    return {
      integrationId: row!.id,
      signingSecret,
      teamId,
      revision: current!.revision,
    };
  });
}

export const getQuillsSlackAgentSettings = fixture({
  seed: (env: ContractEnv) => slackConnection(env, env.a),
  valid: () => ({}),
  hidden: (ids) => [ids.signingSecret, "xoxb-seeded-"],
});

export const setQuillsSlackAssistantEnabled = fixture({
  seed: (env: ContractEnv) => slackConnection(env, env.a),
  valid: (ids) => ({
    body: { expectedRevision: ids.revision, enabled: true },
  }),
  hidden: (ids) => [ids.signingSecret, "xoxb-seeded-"],
});
