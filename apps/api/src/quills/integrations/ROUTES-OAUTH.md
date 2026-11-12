# P7b: OAuth integrations, status sync and inbound webhooks

This file continues `ROUTES.md` (P7a). It covers the OAuth providers whose task integrations Kaneo
already has (decision D6), status sync (P6 rows moved here) and the signed inbound webhook.
Every route uses `defineQuillsRoute` and has a sibling `*.fixture.ts`.

## Boundary map

```
Tables and owning schema:  quills: integrations, integration_platform_credentials, post_external_links,
                           posts, post_statuses, kv_store (delivery receipts), events, job_queue,
                           audit_log. public: none (OAuth callback reads workspace_member and the role
                           through framework/platform-reads.ts).
Actor and workspace:       teammate routes: authenticated context. OAuth callback: the signed state's
                           workspace and teammate, re-checked against the session. Webhook: the
                           workspace of the integration row (quills.integration_workspace).
Permissions:               teammate routes: workspace:read + quills:<action>. OAuth callback: the
                           session account still holds quills:manage_settings. Webhook: the signature.
Transactions:              a provider call never runs in a transaction: `prepare` reads in one scoped
                           transaction, `call` reaches the provider, the handler writes in a new one.
External effects:          OAuth exchange, destinations and search, webhook registration (requests);
                           issue creation and chat messages (worker, after commit).
```

## OAuth app credentials and connect

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `saveQuillsPlatformCredentials` | `PUT /integration-platform-credentials` (`type`, `client.id`, `client.secret`, `botToken` for Discord) | manage_settings | `integration_platform_credentials` | `integration.platform_credentials_saved` | contract, rollback |
| `getQuillsPlatformCredentials` | `GET /integration-platform-credentials?type=` | manage_settings | same | - | contract; secret never returned |
| `deleteQuillsPlatformCredentials` | `DELETE /integration-platform-credentials?type=` | manage_settings | same | `integration.platform_credentials_deleted` | contract, rollback |
| `startQuillsGithubOAuthConnect`, `…Gitlab…`, `…Slack…`, `…Discord…` | `GET /oauth/{github,gitlab,slack,discord}/connect` | manage_settings | `integration_platform_credentials` | - | contract |
| `completeQuillsOAuthConnect` | `GET /quills-public/signed/oauth/{type}/callback?state&code` (signed) | manage_settings (session) | `integrations`, `principal`, `kv_store` | `integration.connected` | contract signed table: forged, expired, wrong provider, other session, workspace B, replay |

- The OAuth app belongs to the workspace (`integration_platform_credentials` is workspace-owned). The
  responses return the public client ID and the redirect URI to register:
  `<KANEO_API_URL origin>/api/quills-public/signed/oauth/<type>/callback`.
- The state is `base64url(claims).HMAC-SHA256` with a key derived from
  `NOTIFICATION_SECRET_ENCRYPTION_KEY`. Claims: workspace, teammate, provider, nonce, expiry (10 min).
  The callback accepts it once: the nonce is the delivery ID of the signed audience. It also requires
  the session of the same Kaneo account, which must still hold `quills:manage_settings`.
- The callback reads the OAuth app (`prepare`), exchanges the code (`call`), then seals the tokens and
  creates or replaces the connection in a new transaction. The audit row names the teammate who
  started the connect (the signed route's `actor`).
- A reconnect starts a new installation and replaces `config` and the secrets: the status sync, its
  mappings and its webhook secret go. The provider's old webhook stays; remove it there before enabling
  status sync again for the same repository (the provider answers 422 otherwise, shown as 409).
- The callback answers JSON. A redirect back to the web app is a follow-up (no web page exists yet).

## Destinations and item search

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations` (≤ 200) | manage_settings | `integrations`, `integration_platform_credentials` | - | contract, local provider server |
| `searchQuillsExternalItems` | `GET /integrations/{integrationId}/external-items?target&query` (≤ 20) | update | same, `integration_event_mappings` | - | contract, local provider server |

A destination is a channel ID for the P7a channel routes: GitHub `owner:repo`, a GitLab project ID,
a Slack or Discord channel ID. Search exists for GitHub and GitLab. It reaches only a target that is
one of the integration's channels (the token may read far more), refuses `.`/`..` path segments, and
drops search qualifiers such as `repo:x` from the query. It needs `quills:update` (linking a post to an
issue is an update), so viewers cannot search the connected account.

A due GitLab token is refreshed in the call and stored in the second transaction when the connection
did not change meanwhile. Only the token fields are merged, so a status-sync secret that changed
during the call stays. When the provider call after a refresh fails, the refreshed tokens still commit
and the route answers the failure after commit (the framework's `failure` hook): GitLab rotates the
refresh token, so dropping the new one would break the connection.

## Status sync

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsStatusSync` | `GET /integrations/{integrationId}/status-sync` (sync state, external statuses, mappings) | manage_settings | `integrations` | - | contract |
| `enableQuillsStatusSync` | `POST /integrations/{integrationId}/status-sync` (`target`) | manage_settings | `integrations` | `integration.status_sync_enabled` | contract, rollback, local provider server |
| `disableQuillsStatusSync` | `DELETE /integrations/{integrationId}/status-sync` | manage_settings | `integrations` | `integration.status_sync_disabled` | contract, rollback |
| `updateQuillsStatusMappings` | `PUT /integrations/{integrationId}/status-mappings` (≤ 20) | manage_settings | `integrations`, `post_statuses` | `integration.status_mappings_updated` | contract, rollback |
| `receiveQuillsIntegrationWebhook` | `POST /quills-public/signed/integrations/{github,gitlab}/{integrationId}/webhook` (signed) | signature | `integrations`, `post_external_links`, `posts`, `kv_store` | `post.status_changed` per changed post | contract signed table |

Merged: `enableStatusSyncFn`, `disableStatusSyncFn`, `updateStatusMappingsFn`, `fetchExternalStatusesFn`
(into `getQuillsStatusSync`), `api/integrations/{type}/webhook`.

- Enabling registers an issues webhook with the provider (GitHub `POST /repos/{repo}/hooks`, GitLab
  `POST /projects/{id}/hooks`) with a new secret that never leaves the server. A provider that does not
  answer leaves the state `uncertain`, with the secret stored: the teammate checks the provider's webhook
  list before enabling again. It is never registered again automatically.
- Disabling removes the secret and the sync state; the verifier also requires the sync state, so later
  deliveries are 401 even if a stale secret survived. The provider's webhook stays; remove it there.
- A registration that the provider did not answer, or answered with a 5xx, is `uncertain`; the secret
  is stored. A failure after a GitLab refresh keeps the refreshed tokens and enables nothing.
- GitHub statuses: `Open`, `Closed` (`issues` `closed`/`reopened`). GitLab: `opened`, `closed`
  (`Issue Hook` `close`/`reopen`). The external ID is `owner/repo#number` or `projectId#iid`.
- A close or reopen updates every active link to that issue (≤ 50) and moves the post to the mapped
  status. An event older than the link's last remote state, or older than 30 days, changes nothing.
- Issue trackers deliver only `post.created`, so an inbound status change never echoes back.

## Providers

| Provider | Connect | Delivery (worker) | Destinations | Search | Status sync |
|---|---|---|---|---|---|
| GitHub | OAuth app, `repo` scope | issue on `post.created` | repositories | issues | yes |
| GitLab (gitlab.com) | OAuth app, `api` scope, refresh tokens | issue on `post.created` | projects | issues | yes |
| Slack | OAuth v2 bot token (`chat:write`, `channels:read`) | message per event | public channels | - | - |
| Discord | OAuth bot install into one server; the OAuth app's bot token posts | message per event (mentions off) | text channels | - | - |

Worker outcomes follow P7a: a create without an answer or with a 5xx is `uncertain` and is never sent
again; Slack's `ok: false` errors map to `auth_required` or `failed`; a due GitLab token is refreshed
before the call (never retried; a rejected refresh is `auth_required`) and the new tokens are stored
with the outcome.

Each provider is one file in `providers/`. `providers/index.ts` collects them in one registry.
`providers/README.md` gives the steps to add a provider and the rules. It also describes the
destination kinds (`kind` and `parent` on the destinations route) and the connect fields (query
values of a connect route, carried in the signed state).

## Providers in RFC 0001

Decision D7 (RFC 0001) puts these providers in scope. Each provider lane fills only its own heading:
the boundary map, the routes, the tests and the differences from the source. Follow
`providers/README.md`.

### Jira

Filled by lane P1.

### Linear

Filled by lane P1.

### Azure DevOps

Filled by lane P1.

### Asana

Filled by lane P2.

### ClickUp

Filled by lane P2.

### Trello

Filled by lane P2. The connect is deferred: the token returns in a URL fragment, and no page reads it
yet. The design and what is missing are in `providers/README.md` ("Trello").

### Monday

Filled by lane P2.

### Notion

Filled by lane P2.

### HubSpot

Lane P3. File `providers/hubspot.ts`, type `hubspot`. Connect route `startQuillsHubspotOAuthConnect`
(`GET /oauth/hubspot/connect`, manage_settings, contract). Contact lookup: see "Contacts and customer
context".

- Hosts: `app.hubspot.com` (the sign-in page) and `api.hubapi.com` (the token and CRM API).
- Scopes: `crm.objects.contacts.read`, `crm.objects.companies.read` and `crm.objects.deals.read`, as in
  the source.
- `exchange` seals the access token, the refresh token and the expiry. It then reads the token
  information once (`GET /oauth/v1/access-tokens/<token>`) for the portal ID (`config.portalId`, digits
  only) and the hub domain (the account label). That read is optional: without a portal ID, a contact
  has no link.
- `refresh`: access tokens expire after 30 minutes. A rejected refresh token (400) asks for a reconnect.
- `contact`: one search with an exact email filter. Then one association read and one batch read of at
  most 100 deals. A failed deal read leaves the deal fields out.
- Fields: Lifecycle, Deal value (account currency) and Deals (their count). The value is the sum of
  `amount_in_home_currency`: the `amount` of a deal can be in another currency.

### Intercom

Lane P3. File `providers/intercom.ts`, type `intercom`. Connect route `startQuillsIntercomOAuthConnect`
(`GET /oauth/intercom/connect`, manage_settings, contract).

- Hosts: `app.intercom.com` (the sign-in page) and `api.intercom.io` (the token and the API). Regional
  data hosts (`api.eu.intercom.io`, `api.au.intercom.io`) are not supported, as in the source.
- `exchange` posts the code to `/auth/eagle/token` and seals the token. It reads `/me` once for the app
  name (the account label). Intercom tokens do not expire, so there is no `refresh`.
- `contact`: one search for the exact email (API version 2.14). The search gives company and tag
  references without names, so the lookup then reads `/contacts/<id>/companies` and `/contacts/<id>/tags`
  at the same time. A failed name read leaves its field out. Fields: Plan (the `plan` attribute) and
  Tags. The link opens the contact in the teammate's current app (`/a/apps/_/users/<id>`).

### Zendesk

Lane P3. File `providers/zendesk.ts`, type `zendesk`. Connect route `startQuillsZendeskOAuthConnect`
(`GET /oauth/zendesk/connect?subdomain=`, manage_settings, contract).

- Connect field `subdomain`: one DNS label, `[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`. The connect route
  refuses another value (400). The signed state carries it, and an altered value breaks the signature
  (401). The callback checks it again (400) before any provider call.
- Hosts: `<subdomain>.zendesk.com` only. `exchange` stores `config.subdomain`, and each lookup checks it
  against the pattern again. A changed value asks for a reconnect (409) and sends nothing.
- Scope `users:read organizations:read`. Zendesk tokens do not expire by default, so there is no
  `refresh`.
- `contact`: the user search also matches names and parts of addresses, so the lookup keeps only the
  user whose email is equal (case-insensitive). Then one optional read of the user's organization.
  Fields: Role and Tags.

### Salesforce

Lane P3. File `providers/salesforce.ts`, type `salesforce`. Connect route
`startQuillsSalesforceOAuthConnect` (`GET /oauth/salesforce/connect`, manage_settings, contract).

- Sign-in and tokens at `login.salesforce.com`. Scope `api refresh_token`. No connect field.
- The token answer names the org's instance (`instance_url`). `exchange` accepts it only with HTTPS, a
  host under `salesforce.com`, no credentials and no port. Otherwise the callback answers 400 and
  stores nothing. `config.instanceUrl` holds the origin only.
- `contact` checks `config.instanceUrl` again before the call (409 otherwise). The query is SOQL with an
  escaped string literal: `SELECT Id, Name, Account.Name FROM Contact WHERE Email = '…' LIMIT 1`.
- `refresh` returns the token fields only, so a refresh answer cannot change the stored instance.
- The token answer gives no lifetime, and each org sets its own session timeout (15 minutes to 24 hours).
  The token counts as due after 15 minutes, so a call after that refreshes it first. Without a refresh
  token (the app does not allow the `refresh_token` scope), the token has no expiry: it works until the
  org's session ends, and then a lookup asks for a reconnect.

### Contacts and customer context

Lane P3. Files `contacts.ts` and `customer-context.ts`, with fixtures and `customer-context.test.ts`.

```
Tables and owning schema:  quills: integrations and integration_platform_credentials (read; refreshed
                           tokens written back), principal and user (customer context, read only).
                           public: none.
Actor and workspace:       authenticated context (helper).
Permissions:               workspace:read + quills:update, both routes.
Persisted relationships:   the person must be a customer of the workspace (directory `loadCustomer`):
                           a teammate, a person of another workspace or a removed person is 404.
Transactions:              `prepare` reads in one scoped transaction. The provider calls run with no
                           transaction open. The handler stores refreshed tokens in a new one. No other
                           write, no event and no audit row.
External effects:          a lookup per connected provider (HubSpot, Intercom and Zendesk make up to
                           three requests, and a due token adds one) to fixed hosts. The email leaves
                           Kaneo to each connected provider.
```

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `searchQuillsIntegrationContact` | `GET /integrations/{integrationId}/contacts?email=` (email ≤ 254) | update | `integrations`, `integration_platform_credentials` | - | contract, local provider server |
| `getQuillsCustomerContext` | `GET /people/{principalId}/context` | update | `principal`, `user`, `integrations`, `integration_platform_credentials` | - | contract, local provider server |

Merged: `searchHubSpotContactFn`, `searchIntercomContactFn` and `searchZendeskUserFn` into
`searchQuillsIntegrationContact`; `fetchCustomerContextFn` into `getQuillsCustomerContext`.

- Action: both routes need `quills:update`, as `searchQuillsExternalItems` does. A lookup sends an email
  to the connected account and returns records that the token can read. A viewer does not query the
  connected accounts. The source used `INTEGRATION_VIEW` (read).
- The contact route answers 409 for an OAuth connection without a contact lookup, and 404 for a
  connection that is not OAuth (the customer context reads Freshdesk and Stripe). It answers a provider
  failure after commit: 409 (reconnect, or no permission in the provider), 400 or 502. Provider text
  never reaches a response.
- The customer context reads the person's email (a lead's contact email when the account email is a
  placeholder). It looks the email up in each active connection with a lookup: HubSpot, Intercom,
  Zendesk, Salesforce, Freshdesk and Stripe. A workspace has one connection for each type, so there are
  at most six entries. Each entry has `status` (`found`, `not_found` or `failed`) and, when it failed, a
  fixed error text. One failure does not fail the read. A person without an email gives no entries and
  no calls.
- Freshdesk uses the saved key and the help desk host that the Freshdesk save route stores as the
  account label. The lookup checks the host against `<label>.freshdesk.com` before the call. Stripe
  uses the saved key and the first customer with the email.
- A contact has at most these fields: `name` and `company` (≤ 200 characters), `url` (an HTTPS link that
  the provider module builds from its fixed host and a checked record ID) and `fields` (≤ 10 label and
  value pairs, ≤ 50 and ≤ 500 characters). A response never holds a raw provider record, a token or a
  provider error.
- Nothing is logged. The handler stores a refreshed token as `listQuillsIntegrationDestinations` does.

Tests (`customer-context.test.ts`, against the local provider server): the code exchange of each
provider and the stored refresh token and expiry; a Salesforce answer without a refresh token; the
Zendesk subdomain outside the pattern and an altered subdomain in the state; a Salesforce token answer
that names another instance; a refresh that names another instance, its request and the stored token;
the SOQL quote escape; contact found, not found and malformed answers, and the email in the search; the
exact-email rule and a changed stored subdomain in Zendesk; the Intercom company and tag names;
Freshdesk and Stripe found, and a changed Freshdesk host; context with the customer's email, a lead's
contact email, no email, a refresh and a `not_found` entry; context with two providers where one fails;
context refused for a teammate, a teammate's portal profile, a person of workspace B and a removed
person; no email or token in audit, event or job rows.

| Source | This port | Reason |
|---|---|---|
| Three search functions (POST, `INTEGRATION_VIEW`), the raw provider record | One route by integration ID, `quills:update`, selected and bounded fields | One capability (`contact`) for each CRM. A viewer does not query the connected accounts. |
| `fetchCustomerContextFn` takes any email | The route takes a person ID and reads that customer's email | A lookup of any email goes through the contact route. |
| A failed provider is left out and logged | An entry with `failed` and a fixed text; nothing is logged | The caller sees which provider failed. Logs hold no personal data. |
| Salesforce refreshes after a rejected read, and a refresh can change the stored instance | Refresh after 15 minutes; a refresh never changes the instance | `withToken` refreshes due tokens only. The instance is checked once and kept. |
| Zendesk keeps the first search result | Only the user with the exact email | The search also matches other people. |
| Zendesk scope `read write`; the agent's name labels the connection | Scope `users:read organizations:read`; the help desk domain labels it | The lookup reads users and organizations only. One request less. |
| HubSpot link without the portal; five deal reads; "Open deals"; `$` and the raw `amount` | Link with the portal ID; one batch read of at most 100; "Deals"; the amount in the account currency, with no symbol | The count includes closed deals. A deal's `amount` can be in another currency. |
| Intercom company and tags from the search answer | Two more reads for their names | The search answer has references without names. |
| Freshdesk reads `config.subdomain` | Freshdesk reads the account label (`<subdomain>.freshdesk.com`) | The Freshdesk save route stores that label. |
| HubSpot and Zendesk revoke the token on disconnect | Not built | The delete route makes no provider call. |

### Microsoft Teams

Filled by lane P4.

## Deferred or not implemented

| Source rows | Reason |
|---|---|
| Microsoft Teams | Graph channel messages need tenant consent and a bot registration. Decision D7 (RFC 0001) puts it in scope: lane P4. |
| Asana, Azure DevOps, ClickUp, HubSpot, Intercom, Jira, Linear, Monday, Notion, Salesforce, Trello, Zendesk | Decision D7 (RFC 0001) puts them in scope: lanes P1 to P3 (see "Providers in RFC 0001"). |
| Segment | Decision D6: by demand. RFC 0001 leaves it out of scope (section 11). |
| GitLab self-managed instances | The provider host would come from user input; needs the SSRF-checked outbound path and a host field. gitlab.com only. |
| `api/integrations/{type}/hooks/{kind}` (Slack interactivity, app hooks) | Their consumers are the Slack assistant and message shortcuts (P8 assistant slice). |
| `api/integrations/{type}/identify` | User-sync providers (Segment and similar) are not in this provider set. |
| `api/v1/apps/**`, `apps*`, `setQuillsIframeHeaders` | The app sidebar authenticates a third-party app with its own token and needs iframe headers; neither fits the signed nor the teammate audience without a new app-token model. |
| `oauth/connector/callback` | Assistant connectors (P8 assistant slice). |
| `updateTicketStatusMappingsFn`, `updatePushStatusMappingsFn` | Ticket status sync and outbound status push need ticket links to tracker issues first. |
| Ticket issue status sync | Inbound issue events update post links only. Ticket issue links are built (`support/TICKETS.md`, "Tracker issue links"). |
| `verifyQuillsIntegrationSyncReference`, recovery `reconcile`/`keep_remote`/`link_existing` | Remote item inspection per provider; search exists, inspection does not. |
| Post activity entry for an inbound status change | `recordActivity` takes a teammate actor; the change is audited as a system change. |
| GitHub inbox channel (issue comments into conversations) | The source's second webhook consumer; needs the GitHub channel account flow. |
