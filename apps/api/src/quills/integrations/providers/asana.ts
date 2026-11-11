// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  formHeaders,
  list,
  record,
  redirectUri,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^app\.asana\.com$/;
const api = "https://app.asana.com/api/1.0";
// An Asana ID (gid) is digits. The same rule keeps it safe in a URL and valid as a channel ID.
const gid = /^[A-Za-z0-9]{1,30}$/;
const bearer = (accessToken: string) => ({
  headers: { authorization: `Bearer ${accessToken}` },
});

/** One call to the token endpoint. Access tokens expire after one hour. */
async function tokens(
  creds: Record<string, string>,
  grant: Record<string, string>,
  refreshToken = "",
) {
  const token = record(
    await providerJson(
      "https://app.asana.com/-/oauth_token",
      {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          redirect_uri: redirectUri("asana"),
          ...grant,
        }),
      },
      hosts,
    ),
  );
  const expiresIn = Number(token.expires_in);
  return {
    accessToken: text(token.access_token),
    // A refresh answer has no new refresh token: the old one stays valid.
    refreshToken: text(token.refresh_token) || refreshToken,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : "",
  };
}

export const asana = {
  name: "Asana",
  hosts,
  category: "issue_tracking",
  description: "Connect an Asana workspace and list its projects.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://app.asana.com/-/oauth_authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    })}`,
  exchange: async (code, _redirectUri, creds) => {
    const secrets = await tokens(creds, {
      grant_type: "authorization_code",
      code,
    });
    if (!secrets.accessToken) throw rejected();
    const user = record(
      record(
        await providerJson(
          `${api}/users/me`,
          bearer(secrets.accessToken),
          hosts,
        ),
      ).data,
    );
    // The projects come from one Asana workspace: the first of the account, as in the source.
    const workspace = record(list(user.workspaces)[0]);
    const workspaceGid = text(workspace.gid);
    if (!gid.test(workspaceGid)) throw rejected();
    return {
      secrets,
      workspaceName: text(workspace.name) || "Asana",
      account: text(user.name) || null,
      config: { workspaceGid },
    };
  },
  destinations: async (secrets, config) => {
    const workspace = text(config.workspaceGid);
    if (!gid.test(workspace)) return [];
    const projects = record(
      await providerJson(
        `${api}/projects?${form({ workspace, archived: "false", opt_fields: "name", limit: "100" })}`,
        bearer(secrets.accessToken ?? ""),
        hosts,
      ),
    ).data;
    if (!Array.isArray(projects)) throw new ProviderCallError(502);
    return projects
      .map(record)
      .filter((project) => gid.test(text(project.gid)))
      .map((project) => ({
        id: text(project.gid),
        name: text(project.name),
      }));
  },
  refresh: async (secrets, creds) => {
    const next = await tokens(
      creds,
      {
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken ?? "",
      },
      secrets.refreshToken,
    ).catch((error: unknown) => {
      // A rejected refresh token means the grant is gone: reconnect.
      if (error instanceof ProviderCallError && error.status === 400)
        throw new ProviderCallError(401);
      throw error;
    });
    if (!next.accessToken) throw new ProviderCallError(401);
    return next;
  },
  statuses: [],
} satisfies OAuthProvider;
