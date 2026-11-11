import { integrationEventMappings } from "../../database/quills/schema/integrations";
import { fixture, type ContractEnv } from "../framework/contract";
import { mintOAuthState } from "../framework/signed";
import {
  APP_SECRET,
  oauthConnection,
  platformCredentials,
} from "./oauth-seed.fixture";

export const saveQuillsPlatformCredentials = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      type: "github",
      client: { id: "client-new", secret: "contract-new-secret" },
    },
  }),
  hidden: () => ["contract-new-secret"],
});
export const getQuillsPlatformCredentials = fixture({
  seed: (env: ContractEnv) => platformCredentials(env, env.a),
  valid: () => ({ query: { type: "github" } }),
});
export const deleteQuillsPlatformCredentials = fixture({
  seed: (env: ContractEnv) => platformCredentials(env, env.a),
  valid: () => ({ query: { type: "github" } }),
});
const connect = (type: string, query?: Record<string, string>) =>
  fixture({
    seed: (env: ContractEnv) => platformCredentials(env, env.a, type),
    valid: () => (query ? { query } : {}),
  });
export const startQuillsGithubOAuthConnect = connect("github");
export const startQuillsGitlabOAuthConnect = connect("gitlab");
export const startQuillsSlackOAuthConnect = connect("slack");
export const startQuillsDiscordOAuthConnect = connect("discord");
// The RFC 0001 OAuth providers (lanes P1 to P4), so that a provider lane edits no fixture for its
// connect route. The contract suite uses only the fixtures of registered routes.
export const startQuillsAsanaOAuthConnect = connect("asana");
export const startQuillsClickupOAuthConnect = connect("clickup");
export const startQuillsHubspotOAuthConnect = connect("hubspot");
export const startQuillsIntercomOAuthConnect = connect("intercom");
export const startQuillsJiraOAuthConnect = connect("jira");
export const startQuillsLinearOAuthConnect = connect("linear");
export const startQuillsMondayOAuthConnect = connect("monday");
export const startQuillsNotionOAuthConnect = connect("notion");
export const startQuillsSalesforceOAuthConnect = connect("salesforce");
export const startQuillsTeamsOAuthConnect = connect("teams");
export const startQuillsTrelloOAuthConnect = connect("trello");
export const startQuillsZendeskOAuthConnect = connect("zendesk", {
  subdomain: "contract",
});

const connections = async (env: ContractEnv) => ({
  a: await oauthConnection(env, env.a),
  b: await oauthConnection(env, env.b),
});
type Connections = Awaited<ReturnType<typeof connections>>;
export const listQuillsIntegrationDestinations = fixture({
  seed: connections,
  valid: ({ a }: Connections) => ({ params: { integrationId: a } }),
  foreign: ({ b }: Connections) => ({ integrationId: b }),
});
export const searchQuillsExternalItems = fixture({
  // Search reaches only a configured channel.
  seed: async (env: ContractEnv) => {
    const ids = await connections(env);
    for (const [workspaceId, integrationId] of [
      [env.a, ids.a],
      [env.b, ids.b],
    ] as const)
      await env.scoped(workspaceId, (db) =>
        db.insert(integrationEventMappings).values({
          integrationId,
          eventType: "post.created",
          actionType: "send_message",
          targetKey: "acme:app",
        }),
      );
    return ids;
  },
  valid: ({ a }: Connections) => ({
    params: { integrationId: a },
    query: { target: "acme:app", query: "contract" },
  }),
  foreign: ({ b }: Connections) => ({ integrationId: b }),
});

/** A callback request: the state, the session account and the provider path. */
const redirect = (
  env: ContractEnv,
  state: { workspaceId: string; userId: string; type?: string; ttlMs?: number },
  session = state.userId,
  path = "github",
) => ({
  params: { type: path },
  query: {
    state: mintOAuthState(
      {
        workspaceId: state.workspaceId,
        userId: state.userId,
        type: state.type ?? "github",
      },
      state.ttlMs,
    ),
    code: "contract-code",
  },
  headers: { "x-test-user": session },
});
export const completeQuillsOAuthConnect = fixture({
  seed: async (env: ContractEnv) => {
    await platformCredentials(env, env.a);
    await platformCredentials(env, env.b);
    return env;
  },
  valid: (env: ContractEnv) =>
    redirect(env, { workspaceId: env.a, userId: env.owner }),
  forged: (env: ContractEnv) => {
    const good = redirect(env, { workspaceId: env.a, userId: env.owner });
    const [payload, signature] = good.query.state.split(".");
    return [
      // A changed claim: the signature no longer matches.
      {
        ...good,
        query: {
          ...good.query,
          state: `${Buffer.from(
            Buffer.from(payload!, "base64url").toString().replace(env.a, env.b),
          ).toString("base64url")}.${signature}`,
        },
      },
      redirect(env, { workspaceId: env.a, userId: env.owner, ttlMs: -1000 }),
      redirect(env, { workspaceId: env.a, userId: env.owner, type: "gitlab" }),
      // Another account's browser session.
      redirect(env, { workspaceId: env.a, userId: env.owner }, env.customerA),
      { ...good, headers: {} },
    ];
  },
  crossed: (env: ContractEnv) => {
    // The contract world names B's owner after A's (`<prefix>_outsider`).
    const ownerB = env.owner.replace(/_owner$/, "_outsider");
    return [
      // Workspace B's state, completed in A's owner's session.
      redirect(env, { workspaceId: env.b, userId: ownerB }, env.owner),
      // Workspace B's own valid redirect: it connects B only.
      redirect(env, { workspaceId: env.b, userId: ownerB }),
    ];
  },
  hidden: () => ["gho_contract_token", APP_SECRET],
  // The audit row names the teammate who started the connect.
  actor: (env: ContractEnv) =>
    env.scoped(env.a, async (_db, actor) => actor.principalId),
});
