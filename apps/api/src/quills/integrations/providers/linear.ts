// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  formHeaders,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(api\.)?linear\.app$/;

/** One GraphQL query. Returns `data`, or {} when the answer has none. */
const graphql = async (token: string, query: string) =>
  record(
    record(
      await providerJson(
        "https://api.linear.app/graphql",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ query }),
        },
        hosts,
      ),
    ).data,
  );

/** One token request. Linear rotates the refresh token on each refresh. */
const tokenRequest = async (body: Record<string, string>) =>
  record(
    await providerJson(
      "https://api.linear.app/oauth/token",
      { method: "POST", headers: formHeaders, body: form(body) },
      hosts,
    ),
  );

const expiresAt = (token: Record<string, unknown>) => {
  const expiresIn = Number(token.expires_in);
  return Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : "";
};

export const linear = {
  name: "Linear",
  hosts,
  category: "issue_tracking",
  description: "Connect a Linear workspace and list its teams.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  // Read scope only: listing teams needs no write access.
  authorizeUrl: (creds, redirectUri, state) =>
    `https://linear.app/oauth/authorize?${form({
      client_id: creds.clientId!,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      scope: "read",
      prompt: "consent",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = await tokenRequest({
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    const organization = record(
      (await graphql(accessToken, "{ organization { name urlKey } }"))
        .organization,
    );
    return {
      secrets: {
        accessToken,
        refreshToken: text(token.refresh_token),
        expiresAt: expiresAt(token),
      },
      workspaceName: text(organization.name) || "Linear",
      account: text(organization.urlKey) || null,
    };
  },
  destinations: async (secrets) => {
    const teams = record(
      (
        await graphql(
          secrets.accessToken ?? "",
          "{ teams { nodes { id name } } }",
        )
      ).teams,
    ).nodes;
    // An answer without the team list (GraphQL errors) is a provider failure, not an empty list.
    if (!Array.isArray(teams)) throw new ProviderCallError(502);
    return teams
      .map(record)
      .filter((team) => /^[A-Za-z0-9-]{1,64}$/.test(text(team.id)))
      .map((team) => ({ id: text(team.id), name: text(team.name) }));
  },
  statuses: [],
  refresh: async (secrets, creds) => {
    const token = await tokenRequest({
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      grant_type: "refresh_token",
      refresh_token: secrets.refreshToken ?? "",
    }).catch((error: unknown) => {
      // A rejected refresh token (400 invalid_grant) means the grant is gone: reconnect.
      if (error instanceof ProviderCallError && error.status === 400)
        throw new ProviderCallError(401);
      throw error;
    });
    const accessToken = text(token.access_token);
    if (!accessToken) throw new ProviderCallError(401);
    return {
      accessToken,
      refreshToken: text(token.refresh_token) || (secrets.refreshToken ?? ""),
      expiresAt: expiresAt(token),
    };
  },
} satisfies OAuthProvider;
