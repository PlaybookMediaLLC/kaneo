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
  refreshGrant,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

// Sign-in at login.salesforce.com; the API calls go to the org's instance, a host under salesforce.com.
const hosts = /^([a-z0-9-]{1,63}\.){1,6}salesforce\.com$/;
const login = "https://login.salesforce.com/services/oauth2";

/**
 * The origin of a Salesforce instance URL: HTTPS, a host under salesforce.com, no credentials and
 * no port. Null otherwise. The token answer names the instance, so it is checked before it is stored,
 * and again before each call.
 */
function salesforceInstance(value: unknown) {
  const url = URL.parse(text(value));
  return url?.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    hosts.test(url.hostname)
    ? url.origin
    : null;
}

// ponytail: the token answer gives no lifetime, and an org sets the session timeout (15 minutes to
// 24 hours). The token counts as due after the shortest one, so a call refreshes it first. Refresh
// after a rejected call instead when withToken (../oauth.ts) supports it.
const expiresAt = () => new Date(Date.now() + 15 * 60_000).toISOString();

async function token(values: Record<string, string>) {
  return record(
    await providerJson(
      `${login}/token`,
      { method: "POST", headers: formHeaders, body: form(values) },
      hosts,
    ),
  );
}

export const salesforce = {
  name: "Salesforce",
  hosts,
  category: "support_crm",
  description:
    "Show Salesforce contact and account details next to a customer.",
  events: [],
  channels: false,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `${login}/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: "api refresh_token",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const answer = await token({
      grant_type: "authorization_code",
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      redirect_uri: redirectUri,
      code,
    });
    const accessToken = text(answer.access_token);
    const instanceUrl = salesforceInstance(answer.instance_url);
    if (!accessToken || !instanceUrl) throw rejected();
    const refreshToken = text(answer.refresh_token);
    return {
      secrets: {
        accessToken,
        refreshToken,
        // Without a refresh token (the app does not allow the scope), the token works until the
        // org's session ends; then a lookup asks for a reconnect.
        expiresAt: refreshToken ? expiresAt() : "",
      },
      workspaceName: "Salesforce",
      account: new URL(instanceUrl).hostname,
      config: { instanceUrl },
    };
  },
  destinations: async () => [],
  statuses: [],
  // Returns the token fields only: an instance URL in the answer cannot change the stored instance.
  refresh: (secrets, creds) =>
    refreshGrant(
      token({
        grant_type: "refresh_token",
        client_id: creds.clientId ?? "",
        client_secret: creds.clientSecret ?? "",
        refresh_token: secrets.refreshToken ?? "",
      }),
      secrets,
      expiresAt,
    ),
  contact: async (secrets, config, email) => {
    const instance = salesforceInstance(config.instanceUrl);
    if (!instance) throw new ProviderCallError(401);
    // A SOQL string literal: escape the backslash and the quote.
    const literal = email.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const [found] = list(
      record(
        await providerJson(
          `${instance}/services/data/v62.0/query?${form({
            q: `SELECT Id, Name, Account.Name FROM Contact WHERE Email = '${literal}' LIMIT 1`,
          })}`,
          {
            headers: {
              authorization: `Bearer ${secrets.accessToken ?? ""}`,
              accept: "application/json",
            },
          },
          hosts,
        ),
      ).records,
    ).map(record);
    const id = text(found?.Id);
    if (!found || !/^[A-Za-z0-9]{15,18}$/.test(id)) return null;
    return {
      name: text(found.Name) || null,
      company: text(record(found.Account).Name) || null,
      url: `${instance}/lightning/r/Contact/${id}/view`,
      fields: [],
    };
  },
} satisfies OAuthProvider;
