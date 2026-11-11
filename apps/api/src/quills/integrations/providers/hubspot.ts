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
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(app\.hubspot|api\.hubapi)\.com$/;
const api = "https://api.hubapi.com";
const bearer = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  accept: "application/json",
});
const expiry = (seconds: unknown) => {
  const value = Number(seconds);
  return Number.isFinite(value)
    ? new Date(Date.now() + value * 1000).toISOString()
    : "";
};
/** A HubSpot record ID: digits only, so it is safe in a URL path. */
const recordId = (value: unknown) => {
  const id = text(value);
  return /^\d{1,20}$/.test(id) ? id : null;
};

/** The token request. A rejected refresh token means the grant is gone: reconnect. */
async function token(values: Record<string, string>) {
  return record(
    await providerJson(
      `${api}/oauth/v1/token`,
      { method: "POST", headers: formHeaders, body: form(values) },
      hosts,
    ),
  );
}

/** Up to five deals of a contact, with their amounts. A failed deal read leaves the deal fields out. */
async function deals(accessToken: string, contactId: string) {
  const ids = list(
    record(
      await providerJson(
        `${api}/crm/v3/objects/contacts/${contactId}/associations/deals`,
        { headers: bearer(accessToken) },
        hosts,
      ),
    ).results,
  )
    .map((deal) => recordId(record(deal).id))
    .filter((id): id is string => id !== null)
    .slice(0, 5);
  if (!ids.length) return [];
  return list(
    record(
      await providerJson(
        `${api}/crm/v3/objects/deals/batch/read`,
        {
          method: "POST",
          headers: bearer(accessToken),
          body: JSON.stringify({
            properties: ["amount"],
            inputs: ids.map((id) => ({ id })),
          }),
        },
        hosts,
      ),
    ).results,
  ).map((deal) => Number(text(record(record(deal).properties).amount)) || 0);
}

export const hubspot = {
  name: "HubSpot",
  hosts,
  category: "support_crm",
  description:
    "Show HubSpot contact details and deal value next to a customer.",
  events: [],
  channels: false,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://app.hubspot.com/oauth/authorize?${form({
      client_id: creds.clientId!,
      scope:
        "crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read",
      redirect_uri: redirectUri,
      state,
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
    if (!accessToken) throw rejected();
    // The portal ID builds the contact links. Without it, a contact has no link.
    const account = record(
      await providerJson(
        `${api}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`,
        { headers: { accept: "application/json" } },
        hosts,
      ).catch(() => null),
    );
    const portalId = recordId(String(account.hub_id ?? ""));
    const domain = text(account.hub_domain);
    return {
      secrets: {
        accessToken,
        refreshToken: text(answer.refresh_token),
        expiresAt: expiry(answer.expires_in),
      },
      workspaceName: domain || "HubSpot",
      account: domain || null,
      config: portalId ? { portalId } : undefined,
    };
  },
  destinations: async () => [],
  statuses: [],
  // Access tokens expire after 30 minutes.
  refresh: async (secrets, creds) => {
    const answer = await token({
      grant_type: "refresh_token",
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      refresh_token: secrets.refreshToken ?? "",
    }).catch((error: unknown) => {
      if (error instanceof ProviderCallError && error.status === 400)
        throw new ProviderCallError(401);
      throw error;
    });
    const accessToken = text(answer.access_token);
    if (!accessToken) throw new ProviderCallError(401);
    return {
      accessToken,
      refreshToken: text(answer.refresh_token) || (secrets.refreshToken ?? ""),
      expiresAt: expiry(answer.expires_in),
    };
  },
  contact: async (secrets, config, email) => {
    const accessToken = secrets.accessToken ?? "";
    const [found] = list(
      record(
        await providerJson(
          `${api}/crm/v3/objects/contacts/search`,
          {
            method: "POST",
            headers: bearer(accessToken),
            body: JSON.stringify({
              filterGroups: [
                {
                  filters: [
                    { propertyName: "email", operator: "EQ", value: email },
                  ],
                },
              ],
              properties: [
                "firstname",
                "lastname",
                "company",
                "lifecyclestage",
              ],
              limit: 1,
            }),
          },
          hosts,
        ),
      ).results,
    ).map(record);
    const id = found && recordId(found.id);
    if (!found || !id) return null;
    const properties = record(found.properties);
    const amounts = await deals(accessToken, id).catch(() => []);
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const portalId = recordId(config.portalId);
    const lifecycle = text(properties.lifecyclestage);
    return {
      name:
        [text(properties.firstname), text(properties.lastname)]
          .filter(Boolean)
          .join(" ") || null,
      company: text(properties.company) || null,
      url: portalId
        ? `https://app.hubspot.com/contacts/${portalId}/contact/${id}`
        : null,
      fields: [
        ...(lifecycle ? [{ label: "Lifecycle", value: lifecycle }] : []),
        ...(total
          ? [
              {
                label: "Deal value",
                value: `$${total.toLocaleString("en-US")}`,
              },
            ]
          : []),
        ...(amounts.length
          ? [{ label: "Deals", value: String(amounts.length) }]
          : []),
      ],
    };
  },
} satisfies OAuthProvider;
