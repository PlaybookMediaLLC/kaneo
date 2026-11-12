// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  list,
  record,
  rejected,
  rows,
  text,
  type OAuthProvider,
} from "../oauth-providers";

// The help desk's own host: one validated DNS label and the fixed Zendesk suffix.
const subdomain = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/;
const hosts = /^[a-z0-9-]+\.zendesk\.com$/;
// The lookup reads users and their organizations only.
const scope = "users:read organizations:read";
/** The stored subdomain, checked again before it enters a host. A changed value asks for a reconnect. */
const desk = (config: Record<string, unknown>) => {
  const value = text(config.subdomain);
  if (!new RegExp(`^(?:${subdomain.source})$`).test(value))
    throw new ProviderCallError(401);
  return `https://${value}.zendesk.com`;
};
/** A Zendesk record ID: digits only, so it is safe in a URL path. */
const recordId = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) > 0 ? String(value) : null;

// Zendesk access tokens do not expire by default, so there is no refresh.
export const zendesk = {
  name: "Zendesk",
  hosts,
  category: "support_crm",
  description:
    "Show Zendesk user details, such as role and organization, next to a customer.",
  events: [],
  channels: false,
  credentials: ["clientId", "clientSecret"],
  connectFields: { subdomain },
  authorizeUrl: (creds, redirectUri, state, fields) =>
    `https://${fields.subdomain}.zendesk.com/oauth/authorizations/new?${form({
      client_id: creds.clientId!,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      scope,
    })}`,
  exchange: async (code, redirectUri, creds, fields) => {
    const base = desk(fields);
    const answer = record(
      await providerJson(
        `${base}/oauth/tokens`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            redirect_uri: redirectUri,
            scope,
          }),
        },
        hosts,
      ),
    );
    const accessToken = text(answer.access_token);
    if (!accessToken) throw rejected();
    const domain = `${fields.subdomain}.zendesk.com`;
    return {
      secrets: { accessToken },
      workspaceName: domain,
      account: domain,
      config: { subdomain: fields.subdomain! },
    };
  },
  destinations: async () => [],
  statuses: [],
  contact: async (secrets, config, email) => {
    const base = desk(config);
    const headers = {
      authorization: `Bearer ${secrets.accessToken ?? ""}`,
      accept: "application/json",
    };
    // The search also matches names and parts of addresses: keep only the user with this email.
    const user = rows(
      record(
        await providerJson(
          `${base}/api/v2/users/search.json?${form({ query: email })}`,
          { headers },
          hosts,
        ),
      ).users,
    )
      .map(record)
      .find((user) => text(user.email).toLowerCase() === email.toLowerCase());
    const id = user && recordId(user.id);
    if (!user || !id) return null;
    const organizationId = recordId(user.organization_id);
    const organization = organizationId
      ? record(
          record(
            await providerJson(
              `${base}/api/v2/organizations/${organizationId}.json`,
              { headers },
              hosts,
            ).catch(() => null),
          ).organization,
        )
      : {};
    const role = text(user.role);
    const tags = list(user.tags).map(text).filter(Boolean);
    return {
      name: text(user.name) || null,
      company: text(organization.name) || null,
      url: `${base}/agent/users/${id}`,
      fields: [
        ...(role ? [{ label: "Role", value: role }] : []),
        ...(tags.length ? [{ label: "Tags", value: tags.join(", ") }] : []),
      ],
    };
  },
} satisfies OAuthProvider;
