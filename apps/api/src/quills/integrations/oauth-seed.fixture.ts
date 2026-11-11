import { eq } from "drizzle-orm";
import {
  integrationPlatformCredentials,
  integrations,
} from "../../database/quills/schema/integrations";
import { encryptSecret } from "../../notification-preferences/secrets";
import type { ContractEnv } from "../framework/contract";
import "./provider-edge.fixture";
import "./seed.fixture";

// Seeds for the OAuth, status-sync and inbound-webhook fixtures.

export const APP_SECRET = "contract-app-secret";
const seal = (values: Record<string, string>) =>
  encryptSecret(JSON.stringify(values))!;

/** The workspace's OAuth app for a provider, replacing an earlier one. */
export function platformCredentials(
  env: ContractEnv,
  workspaceId: string,
  type = "github",
) {
  return env.scoped(workspaceId, async (db) => {
    await db
      .delete(integrationPlatformCredentials)
      .where(eq(integrationPlatformCredentials.integrationType, type));
    await db.insert(integrationPlatformCredentials).values({
      integrationType: type,
      secrets: seal({
        clientId: `client-${type}`,
        clientSecret: APP_SECRET,
        botToken: "contract-bot-token",
      }),
    });
  });
}

/** A fresh GitHub OAuth connection with a token and, optionally, a status-sync secret and mappings. */
export function oauthConnection(
  env: ContractEnv,
  workspaceId: string,
  extra: { webhookSecret?: string; config?: Record<string, unknown> } = {},
) {
  return env.scoped(workspaceId, async (db, actor) => {
    await db
      .delete(integrations)
      .where(eq(integrations.integrationType, "github"));
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: "github",
        status: "active",
        secrets: seal({
          accessToken: `gho_seeded_${workspaceId}`,
          ...(extra.webhookSecret && { webhookSecret: extra.webhookSecret }),
        }),
        config: {
          workspaceName: "Contract",
          account: "contract",
          ...extra.config,
        },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(),
      })
      .returning({ id: integrations.id });
    return row!.id;
  });
}
