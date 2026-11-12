import { fixture, type ContractEnv } from "../framework/contract";
import { oauthConnection } from "./oauth-seed.fixture";
import { providerAnswers } from "./provider-edge.fixture";

/** The email that the local Zendesk server knows. Zendesk keeps only an exact match. */
const CONTACT_EMAIL = "ada@example.test";

// The local provider server's answers for HubSpot, Intercom, Zendesk (subdomain `contract`) and
// Salesforce (instance `contract.my.salesforce.com`).
const answers: Record<string, unknown> = {
  "POST /api.hubapi.com/oauth/v1/token": {
    access_token: "hubspot-contract-token",
    refresh_token: "hubspot-contract-refresh",
    expires_in: 1800,
  },
  "GET /api.hubapi.com/oauth/v1/access-tokens/hubspot-contract-token": {
    hub_id: 42,
    hub_domain: "contract.hubspot.com",
  },
  "POST /api.hubapi.com/crm/v3/objects/contacts/search": {
    results: [
      {
        id: "101",
        properties: {
          firstname: "Ada",
          lastname: "Contract",
          company: "Acme",
          lifecyclestage: "customer",
          hs_secret_note: "not selected",
        },
      },
    ],
  },
  "GET /api.hubapi.com/crm/v3/objects/contacts/101/associations/deals": {
    results: [{ id: "7" }, { id: "8" }],
  },
  "POST /api.hubapi.com/crm/v3/objects/deals/batch/read": {
    results: [
      { id: "7", properties: { amount_in_home_currency: "1000" } },
      { id: "8", properties: { amount_in_home_currency: "250" } },
    ],
  },
  "POST /api.intercom.io/auth/eagle/token": {
    token: "intercom-contract-token",
  },
  "GET /api.intercom.io/me": { app: { name: "Contract app" } },
  "POST /api.intercom.io/contacts/search": {
    data: [
      {
        id: "6501",
        name: "Ada Contract",
        // References without names, as the search answers them.
        companies: { type: "list", data: [{ type: "company", id: "c1" }] },
        custom_attributes: { plan: "pro" },
        tags: { type: "list", data: [{ type: "tag", id: "t1" }] },
      },
    ],
  },
  "GET /api.intercom.io/contacts/6501/companies": {
    type: "list",
    data: [{ type: "company", id: "c1", name: "Acme" }],
  },
  "GET /api.intercom.io/contacts/6501/tags": {
    type: "list",
    data: [{ type: "tag", id: "t1", name: "vip" }],
  },
  "POST /contract.zendesk.com/oauth/tokens": {
    access_token: "zendesk-contract-token",
  },
  "GET /contract.zendesk.com/api/v2/users/search.json": {
    users: [
      { id: 8, name: "Ada Other", email: "ada.other@example.test" },
      {
        id: 9,
        name: "Ada Contract",
        email: CONTACT_EMAIL,
        role: "end-user",
        organization_id: 3,
        tags: ["vip"],
      },
    ],
  },
  "GET /contract.zendesk.com/api/v2/organizations/3.json": {
    organization: { id: 3, name: "Acme" },
  },
  "POST /login.salesforce.com/services/oauth2/token": {
    access_token: "salesforce-contract-token",
    refresh_token: "salesforce-contract-refresh",
    instance_url: "https://contract.my.salesforce.com",
  },
  "GET /contract.my.salesforce.com/services/data/v62.0/query": {
    records: [
      {
        Id: "003000000000001AAA",
        Name: "Ada Contract",
        Account: { Name: "Acme" },
      },
    ],
  },
};
providerAnswers.push((route) => answers[route]);

/** A HubSpot connection in each workspace. */
const hubspotConnections = async (env: ContractEnv) => ({
  a: await oauthConnection(env, env.a, { type: "hubspot" }),
  b: await oauthConnection(env, env.b, { type: "hubspot" }),
});
type Connections = Awaited<ReturnType<typeof hubspotConnections>>;

export const searchQuillsIntegrationContact = fixture({
  seed: hubspotConnections,
  valid: ({ a }: Connections) => ({
    params: { integrationId: a },
    query: { email: CONTACT_EMAIL },
  }),
  foreign: ({ b }: Connections) => ({ integrationId: b }),
});
