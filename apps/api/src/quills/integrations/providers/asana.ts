// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { issueParts, uncertain } from "../delivery";
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
const gid = /^\d{1,30}$/;
const bearer = (accessToken: string) => ({
  headers: { authorization: `Bearer ${accessToken}` },
});
/**
 * Text for Asana rich text, which is XML: drops the characters that XML refuses (control characters
 * and lone surrogates), then escapes the markup characters.
 */
const xml = (value: string) =>
  value
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** One call to the token endpoint. Access tokens expire after one hour. */
async function tokens(
  creds: Record<string, string>,
  grant: Record<string, string>,
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
  // A missing, negative or out-of-range `expires_in` gives no expiry: the token is never refreshed.
  const expiresAt = new Date(Date.now() + Number(token.expires_in) * 1000);
  return {
    accessToken: text(token.access_token),
    // A refresh answer has no new refresh token: the old one stays valid.
    refreshToken: text(token.refresh_token) || (grant.refresh_token ?? ""),
    expiresAt: expiresAt.getTime() > Date.now() ? expiresAt.toISOString() : "",
  };
}

export const asana = {
  name: "Asana",
  hosts,
  category: "issue_tracking",
  description: "Create Asana tasks from new feedback.",
  events: ["post.created"],
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
    const next = await tokens(creds, {
      grant_type: "refresh_token",
      refresh_token: secrets.refreshToken ?? "",
    }).catch((error: unknown) => {
      // A rejected refresh token means the grant is gone: reconnect.
      if (error instanceof ProviderCallError && error.status === 400)
        throw new ProviderCallError(401);
      throw error;
    });
    if (!next.accessToken) throw new ProviderCallError(401);
    return next;
  },
  statuses: [],
  // A project gid, the destination ID.
  target: (target) => gid.test(target),
  // A task for a new post. The notes are Asana rich text: every part of the post is escaped.
  deliver: async ({ secrets, config, target, content }) => {
    // A stored workspace that does not match: reconnect, with no task call.
    const workspace = text(config.workspaceGid);
    if (!gid.test(workspace))
      return { state: "auth_required", errorCode: "authentication" };
    const { title, paragraphs, footer } = issueParts(content);
    const task = record(
      record(
        await providerJson(
          `${api}/tasks`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${secrets.accessToken ?? ""}`,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              data: {
                name: title,
                html_notes: `<body>${[...paragraphs, "", ...footer].map(xml).join("\n")}</body>`,
                projects: [target],
                workspace,
              },
            }),
          },
          hosts,
        ),
      ).data,
    );
    const id = text(task.gid);
    // A 2xx without a task gid: the task may exist.
    if (!gid.test(id)) return uncertain;
    const link = URL.parse(text(task.permalink_url))?.href;
    return {
      state: "succeeded",
      result: {
        externalId: id,
        externalUrl: link?.startsWith("https://app.asana.com/") ? link : null,
      },
    };
  },
} satisfies OAuthProvider;
