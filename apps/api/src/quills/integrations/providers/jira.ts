// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(auth|api)\.atlassian\.com$/;
const json = { "content-type": "application/json", accept: "application/json" };
/** An Atlassian cloud ID. It enters every API path, so it must match before each call. */
const cloudIdPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const jiraId = /^\d{1,20}$/;

/** The stored cloud ID. A value that does not match never enters a URL: the teammate reconnects. */
function cloudId(config: Record<string, unknown>) {
  const id = text(config.cloudId);
  if (!cloudIdPattern.test(id)) throw new ProviderCallError(401);
  return id;
}

/** An answer that is not the expected list is a provider failure, not an empty list. */
function items(value: unknown) {
  if (!Array.isArray(value)) throw new ProviderCallError(502);
  return value.map(record);
}

const expiresAt = (token: Record<string, unknown>) => {
  const expiresIn = Number(token.expires_in);
  return Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : "";
};

/** One token request. Atlassian rotates the refresh token on each refresh. */
const tokenRequest = (body: Record<string, string>) =>
  providerJson(
    "https://auth.atlassian.com/oauth/token",
    { method: "POST", headers: json, body: JSON.stringify(body) },
    hosts,
  ).then(record);

export const jira = {
  name: "Jira",
  hosts,
  category: "issue_tracking",
  description:
    "Connect a Jira Cloud site and list its projects and issue types.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  // Read scope only: listing projects and issue types needs no write access.
  authorizeUrl: (creds, redirectUri, state) =>
    `https://auth.atlassian.com/authorize?${form({
      audience: "api.atlassian.com",
      client_id: creds.clientId!,
      scope: "read:jira-work offline_access",
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      prompt: "consent",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = await tokenRequest({
      grant_type: "authorization_code",
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      code,
      redirect_uri: redirectUri,
    });
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    // The first site that the grant reaches. Its cloud ID is in every later API path.
    const [site] = items(
      await providerJson(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
        },
        hosts,
      ),
    );
    const id = text(site?.id);
    if (!cloudIdPattern.test(id)) throw rejected();
    return {
      secrets: {
        accessToken,
        refreshToken: text(token.refresh_token),
        expiresAt: expiresAt(token),
      },
      workspaceName: text(site?.name) || "Jira",
      account: text(site?.url) || null,
      config: { cloudId: id },
    };
  },
  destinationKinds: { project: {}, "issue-type": { parent: "project" } },
  // The parent is a project ID that the route found in the project list.
  destinations: async (secrets, config, _creds, scope) => {
    const base = `https://api.atlassian.com/ex/jira/${cloudId(config)}/rest/api/3`;
    const headers = {
      authorization: `Bearer ${secrets.accessToken ?? ""}`,
      accept: "application/json",
    };
    const answer =
      scope.kind === "issue-type"
        ? await providerJson(
            `${base}/issuetype/project?${form({ projectId: scope.parent ?? "" })}`,
            { headers },
            hosts,
          )
        : record(
            // ponytail: one page of 100 projects (Jira's maximum); page with startAt when a site has more.
            await providerJson(
              `${base}/project/search?${form({ maxResults: "100" })}`,
              { headers },
              hosts,
            ),
          ).values;
    return items(answer)
      .filter((item) => jiraId.test(text(item.id)))
      .map((item) => ({ id: text(item.id), name: text(item.name) }));
  },
  statuses: [],
  refresh: async (secrets, creds) => {
    const token = await tokenRequest({
      grant_type: "refresh_token",
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      refresh_token: secrets.refreshToken ?? "",
    }).catch((error: unknown) => {
      // A rejected refresh token (400 or 403 invalid_grant) means the grant is gone: reconnect.
      if (
        error instanceof ProviderCallError &&
        (error.status === 400 || error.status === 403)
      )
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
