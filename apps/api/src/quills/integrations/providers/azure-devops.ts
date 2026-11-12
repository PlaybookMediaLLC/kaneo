// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { issueParts, uncertain } from "../delivery";
import { record, rejected, text, type OAuthProvider } from "../oauth-providers";

const hosts = /^dev\.azure\.com$/;
/** An Azure DevOps organization name: letters, digits and inner hyphens, at most 50 characters. */
export const organizationName =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/;

/**
 * A project or work item type name in a channel, by Azure DevOps' own naming rules: at most 64
 * characters, none of `\ / : * ? " ' < > ; # $ { } , + = [ ] |`, no `%` (the channel route refuses it)
 * and no control or surrogate character. It does not start with `_`, `.` or a space, and does not end
 * with `.` or a space, so it is never `.` or `..`.
 */
const channelName =
  /^(?![_. ])[^\\/:*?"'<>;#$%{},+=[\]|\p{Cc}\p{Cs}]{1,64}(?<![. ])$/u;

/** A channel `<project>:<work item type>`. A project name has no `:`. Undefined when either name does not match. */
function channelOf(target: string) {
  const at = target.indexOf(":");
  const project = target.slice(0, at);
  const type = target.slice(at + 1);
  return at > 0 && channelName.test(project) && channelName.test(type)
    ? { project, type }
    : undefined;
}

/** The stored organization. A value that does not match never enters a URL: the teammate reconnects. */
function organizationOf(config: Record<string, unknown>) {
  const organization = text(config.organization);
  if (!organizationName.test(organization)) throw new ProviderCallError(401);
  return organization;
}

const headers = (token: string) => ({
  authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
  accept: "application/json",
  // A refused token then gets 401, not a sign-in page with status 203.
  "x-tfs-fedauthredirect": "Suppress",
});
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The names in one list of the organization's API, as destinations. The ID is the name: the work item
 * type list takes the project name. `path` starts with the encoded organization.
 */
async function names(token: string, path: string) {
  const value = record(
    await providerJson(
      `https://dev.azure.com/${path}?api-version=7.1`,
      { headers: headers(token) },
      hosts,
    ),
  ).value;
  // An answer without the list (for example a sign-in page) is a provider failure, not an empty list.
  if (!Array.isArray(value)) throw new ProviderCallError(502);
  return value
    .map((item) => text(record(item).name))
    .filter(Boolean)
    .map((name) => ({ id: name, name }));
}

export const azureDevops = {
  name: "Azure DevOps",
  hosts,
  category: "issue_tracking",
  description:
    "Create Azure DevOps work items from new feedback, with a personal access token.",
  events: ["post.created"],
  channels: true,
  credentials: [],
  connectWithKey: async (key, fields) => {
    const organization = fields.organization ?? "";
    if (!organizationName.test(organization)) throw rejected();
    // The token must list the organization's projects. A rejected token is a 400 here, not a reconnect.
    await names(
      key,
      `${encodeURIComponent(organization)}/_apis/projects`,
    ).catch((error: unknown) => {
      throw error instanceof ProviderCallError &&
        (error.status === 401 || error.status === 403)
        ? rejected()
        : error;
    });
    return {
      secrets: { accessToken: key },
      workspaceName: organization,
      account: `dev.azure.com/${organization}`,
      config: { organization },
    };
  },
  destinationKinds: { project: {}, "work-item-type": { parent: "project" } },
  // The parent is a project name that the route found in the project list. It can hold spaces.
  destinations: async (secrets, config, _creds, scope) => {
    const organization = encodeURIComponent(organizationOf(config));
    const token = secrets.accessToken ?? "";
    return scope.kind === "work-item-type"
      ? names(
          token,
          `${organization}/${encodeURIComponent(scope.parent ?? "")}/_apis/wit/workitemtypes`,
        )
      : names(token, `${organization}/_apis/projects`);
  },
  statuses: [],
  // `<project>:<work item type>`, the names of a destination of each kind.
  target: (target) => channelOf(target) !== undefined,
  // A work item for a new post. The description is HTML: each part of the post is escaped.
  deliver: async ({ secrets, config, target, content }) => {
    const { project, type } = channelOf(target)!;
    const parts = issueParts(content);
    // The organization is checked again before it enters the URL; a bad one asks for a reconnect.
    const base = `https://dev.azure.com/${encodeURIComponent(organizationOf(config))}/${encodeURIComponent(project)}`;
    const item = record(
      await providerJson(
        `${base}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`,
        {
          method: "POST",
          headers: {
            ...headers(secrets.accessToken ?? ""),
            "content-type": "application/json-patch+json",
          },
          body: JSON.stringify([
            { op: "add", path: "/fields/System.Title", value: parts.title },
            {
              op: "add",
              path: "/fields/System.Description",
              value: [
                ...parts.paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`),
                "<hr>",
                ...parts.footer.map((line) => `<p>${escapeHtml(line)}</p>`),
              ].join(""),
            },
          ]),
        },
        hosts,
      ),
    );
    // A 2xx without a work item ID: the item may exist.
    if (!Number.isSafeInteger(item.id) || (item.id as number) <= 0)
      return uncertain;
    return {
      state: "succeeded",
      // The link is built on the fixed host, not taken from the answer.
      result: {
        externalId: String(item.id),
        externalUrl: `${base}/_workitems/edit/${item.id as number}`,
      },
    };
  },
} satisfies OAuthProvider;
