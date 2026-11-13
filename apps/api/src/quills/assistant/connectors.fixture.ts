import { empty, fixture, type ContractEnv } from "../framework/contract";
import { mintOAuthState } from "../framework/signed";
import {
  CODE,
  edgeConnector,
  pendingSecrets,
  PUBLIC_ORIGIN,
  REFRESH,
  VERIFIER,
} from "./connector-edge.fixture";
import { on } from "./seed.fixture";

const pair =
  (mode: "open" | "oauth", secrets?: () => Record<string, string>) =>
  async (env: ContractEnv) => ({
    a: await edgeConnector(env, env.a, mode, secrets?.()),
    b: await edgeConnector(env, env.b, mode, secrets?.()),
  });
type Pair = { a: string; b: string };

export const listQuillsConnectors = empty;
export const getQuillsConnector = on(
  ["connector"],
  (a) => ({ params: { connectorId: a.connectorId } }),
  (b) => ({ connectorId: b.connectorId }),
);
export const createQuillsConnector = fixture({
  seed: async () => ({
    name: `Contract ${Math.random().toString(36).slice(2, 12)}`,
  }),
  valid: ({ name }) => ({ body: { name, url: `${PUBLIC_ORIGIN}/open/mcp` } }),
});
export const updateQuillsConnector = on(
  ["connector"],
  (a) => ({ params: { connectorId: a.connectorId }, body: { enabled: false } }),
  (b) => ({ connectorId: b.connectorId }),
);
export const refreshQuillsConnector = fixture({
  seed: pair("open"),
  valid: ({ a }: Pair) => ({ params: { connectorId: a } }),
  foreign: ({ b }: Pair) => ({ connectorId: b }),
});
export const startQuillsConnectorOAuth = fixture({
  seed: pair("oauth"),
  valid: ({ a }: Pair) => ({ params: { connectorId: a } }),
  foreign: ({ b }: Pair) => ({ connectorId: b }),
});

/** A callback request: the state's workspace, account and connector, the session and the path. */
const redirect = (
  state: {
    workspaceId: string;
    userId: string;
    connectorId: string;
    ttlMs?: number;
  },
  session = state.userId,
  path = state.connectorId,
) => ({
  params: { connectorId: path },
  query: {
    state: mintOAuthState(
      {
        workspaceId: state.workspaceId,
        userId: state.userId,
        type: `connector:${state.connectorId}`,
      },
      state.ttlMs,
    ),
    code: CODE,
  },
  headers: { "x-test-user": session },
});
type Callback = Pair & { env: ContractEnv; other: string };
export const completeQuillsConnectorOAuth = fixture({
  seed: async (env: ContractEnv) => ({
    env,
    ...(await pair("oauth", pendingSecrets)(env)),
    other: await edgeConnector(env, env.a, "oauth", pendingSecrets()),
  }),
  valid: ({ env, a }: Callback) =>
    redirect({ workspaceId: env.a, userId: env.owner, connectorId: a }),
  forged: ({ env, a, other }: Callback) => {
    const good = redirect({
      workspaceId: env.a,
      userId: env.owner,
      connectorId: a,
    });
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
      redirect({
        workspaceId: env.a,
        userId: env.owner,
        connectorId: a,
        ttlMs: -1000,
      }),
      // The state of another connector.
      redirect(
        { workspaceId: env.a, userId: env.owner, connectorId: other },
        env.owner,
        a,
      ),
      // Another account's browser session.
      redirect(
        { workspaceId: env.a, userId: env.owner, connectorId: a },
        env.customerA,
      ),
      { ...good, headers: {} },
    ];
  },
  crossed: ({ env, b }: Callback) => {
    // The contract world names B's owner after A's (`<prefix>_outsider`).
    const ownerB = env.owner.replace(/_owner$/, "_outsider");
    return [
      // Workspace B's state, completed in A's owner's session.
      redirect(
        { workspaceId: env.b, userId: ownerB, connectorId: b },
        env.owner,
      ),
      // Workspace B's own valid redirect: it connects B only.
      redirect({ workspaceId: env.b, userId: ownerB, connectorId: b }),
    ];
  },
  hidden: () => ["mcp-contract-access", REFRESH, VERIFIER],
  // The audit row names the teammate who started the authorization.
  actor: (env: ContractEnv) =>
    env.scoped(env.a, async (_db, actor) => actor.principalId),
});
export const deleteQuillsConnector = on(
  ["connector"],
  (a) => ({ params: { connectorId: a.connectorId } }),
  (b) => ({ connectorId: b.connectorId }),
);
export const listQuillsAssistantTools = empty;
