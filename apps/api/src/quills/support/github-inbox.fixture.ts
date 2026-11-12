import { and, eq, isNull } from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import { channelAccounts } from "../../database/quills/schema/channel-accounts";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { teams } from "../../database/quills/schema/teams";
import type { Database } from "../framework/define-route";
import { fixture, type ContractEnv } from "../framework/contract";
import { providerOverrides } from "../integrations/provider-edge.fixture";
import { oauthConnection } from "../integrations/oauth-seed.fixture";

// The status-sync webhook (hook 1 on acme/app) that the inbox uses. Its update answers 200.
providerOverrides.set("PATCH /api.github.com/repos/acme/app/hooks/1", {
  status: 200,
  body: { id: 1 },
});
const statusSync = {
  webhookSecret: "contract-webhook-secret",
  config: { statusSync: { target: "acme:app", hookId: "1", state: "active" } },
};

/** The default team, created when the workspace has none. */
export async function defaultTeam(db: Database) {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)));
  return (
    team?.id ??
    (
      await db
        .insert(teams)
        .values({ name: "Support", isDefault: true })
        .returning({ id: teams.id })
    )[0]!.id
  );
}

/** A GitHub connection with status sync, the inbox on or off, and a GitHub conversation. */
export async function githubInbox(
  env: ContractEnv,
  workspaceId: string,
  inbox: boolean,
) {
  const integrationId = await oauthConnection(env, workspaceId, statusSync);
  return env.scoped(workspaceId, async (db, actor) => {
    const owningTeamId = await defaultTeam(db);
    await db
      .update(channelAccounts)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(channelAccounts.channel, "github"),
          isNull(channelAccounts.deletedAt),
        ),
      );
    const [account] = await db
      .insert(channelAccounts)
      .values({
        owningTeamId,
        channel: "github",
        role: "connection",
        config: { integrationId },
        deletedAt: inbox ? null : new Date(),
      })
      .returning({ id: channelAccounts.id });
    const [visitor] = await db
      .insert(principal)
      .values({
        role: "user",
        type: "anonymous",
        displayName: "octocat",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const [conversation] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: visitor!.id,
        channel: "github",
        source: "github",
        channelAccountId: account!.id,
      })
      .returning({ id: conversations.id });
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation!.id,
        principalId: actor.principalId,
        senderType: "agent",
        content: "A reply",
        metadata: {
          channelDelivery: {
            status: "failed",
            channel: "github",
            at: new Date().toISOString(),
            error: "GitHub refused the request.",
          },
        },
      })
      .returning({ id: conversationMessages.id });
    return {
      integrationId,
      accountId: account!.id,
      conversationId: conversation!.id,
      messageId: message!.id,
    };
  });
}

const both = (inbox: boolean) => async (env: ContractEnv) => ({
  a: await githubInbox(env, env.a, inbox),
  b: await githubInbox(env, env.b, inbox),
});
type Ids = Awaited<ReturnType<ReturnType<typeof both>>>;

export const getQuillsGitHubChannelStatus = fixture({
  seed: both(true),
  valid: () => ({}),
});

export const setQuillsGitHubInboxEnabled = fixture({
  seed: both(false),
  valid: () => ({ body: { enabled: true } }),
});

export const retryQuillsGitHubAgentMessage = fixture({
  seed: both(true),
  valid: (ids: Ids) => ({ params: { messageId: ids.a.messageId } }),
  foreign: (ids: Ids) => ({ messageId: ids.b.messageId }),
});
