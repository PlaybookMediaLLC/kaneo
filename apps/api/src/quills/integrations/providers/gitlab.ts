// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  formHeaders,
  list,
  plainQuery,
  record,
  redirectUri,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

export const gitlab = {
  name: "GitLab",
  hosts: /^gitlab\.com$/,
  category: "issue_tracking",
  description: "Create GitLab issues from new feedback and sync their status.",
  events: ["post.created"],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://gitlab.com/oauth/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: "api",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson("https://gitlab.com/oauth/token", {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      }),
    );
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    const user = record(
      await providerJson("https://gitlab.com/api/v4/user", {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    const expiresIn = Number(token.expires_in);
    return {
      secrets: {
        accessToken,
        refreshToken: text(token.refresh_token),
        // Refreshed by the delivery job when it is due (jobs/handlers/integration-send.ts).
        expiresAt: Number.isFinite(expiresIn)
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : "",
      },
      workspaceName: text(user.name) || text(user.username) || "GitLab",
      account: text(user.username) || null,
    };
  },
  destinations: async (secrets) =>
    list(
      await providerJson(
        "https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true",
        { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
      ),
    )
      .map(record)
      .filter((project) => Number.isInteger(project.id))
      .map((project) => ({
        id: String(project.id),
        name: text(project.path_with_namespace),
      })),
  search: async (secrets, target, query) =>
    list(
      await providerJson(
        `https://gitlab.com/api/v4/projects/${encodeURIComponent(target)}/issues?${form({ search: plainQuery(query), per_page: "20" })}`,
        { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
      ),
    )
      .map(record)
      .map((issue) => ({
        externalId: `${target}#${String(issue.iid)}`,
        title: text(issue.title),
        url: text(issue.web_url) || null,
        state: text(issue.state),
      })),
  statuses: ["opened", "closed"],
  // A numeric project ID.
  target: (target) => /^\d{1,20}$/.test(target),
  // Access tokens expire after two hours. GitLab rotates the refresh token on each refresh.
  refresh: async (secrets, creds) => {
    const token = record(
      await providerJson("https://gitlab.com/oauth/token", {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          refresh_token: secrets.refreshToken ?? "",
          grant_type: "refresh_token",
          redirect_uri: redirectUri("gitlab"),
        }),
      }).catch((error: unknown) => {
        // A rejected refresh token means the grant is gone: reconnect.
        if (error instanceof ProviderCallError && error.status === 400)
          throw new ProviderCallError(401);
        throw error;
      }),
    );
    const accessToken = text(token.access_token);
    if (!accessToken) throw new ProviderCallError(401);
    const expiresIn = Number(token.expires_in);
    return {
      accessToken,
      refreshToken: text(token.refresh_token) || (secrets.refreshToken ?? ""),
      expiresAt: Number.isFinite(expiresIn)
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : "",
    };
  },
} satisfies OAuthProvider;
