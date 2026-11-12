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

Filled by lane P3.

### Intercom

Filled by lane P3.

### Zendesk

Filled by lane P3.

### Salesforce

Filled by lane P3.

### Microsoft Teams

Lane P4. Key `teams`, file `providers/teams.ts`. Connect and list only: delivery to a channel is out
of scope for #131, so `events` and `statuses` stay empty.

```
Tables and owning schema:  quills: integration_platform_credentials (the OAuth app), integrations
                           (sealed tokens), and the callback's kv_store, events, job_queue, audit_log.
                           public: none.
Actor and workspace:       the generic routes above: authenticated context; the callback uses the
                           signed state.
Permissions:               quills:manage_settings (connect, callback, destinations).
Transactions:              no provider call in a transaction (prepare, call, handler).
External effects:          requests to login.microsoftonline.com (token) and graph.microsoft.com
                           (lists). Nothing is written in Microsoft.
```

Consent flow:

1. Register the Microsoft Entra app as multitenant ("accounts in any organizational directory"). Add
   the redirect URI of the credentials route as a Web redirect URI. Save the client ID and a client
   secret with `saveQuillsPlatformCredentials`.
2. The connect route returns
   `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize` with the delegated scopes
   `Team.ReadBasic.All Channel.ReadBasic.All offline_access`. The `organizations` endpoint accepts work
   and school accounts of any tenant. It refuses personal Microsoft accounts, which cannot use the
   Teams Graph APIs.
3. Microsoft marks none of these delegated scopes "admin consent required". A user can consent for
   themselves when the tenant's user consent policy allows it.
4. Many tenants restrict user consent (for example to verified publishers only, or to no apps). Then
   Microsoft shows "Need admin approval" and sends no code. A tenant admin grants consent one time for
   the organization: through the same connect, with "Consent on behalf of your organization", or in
   the Microsoft Entra admin center (Enterprise applications, Permissions). Then any teammate can
   connect.
5. Failures, each with a fixed error. Microsoft's error text never reaches a response.
   - The redirect has `error` (for example `access_denied` or `consent_required`) and no `code`: the
     callback answers 400 "The provider did not grant access." It calls nothing.
   - The token endpoint refuses the code (400, for example `invalid_grant` with AADSTS65001 when
     consent was removed): 400 "The provider rejected the request."
   - A refused refresh (400 or 401): 409 "The provider rejected the saved credentials. Reconnect."
   - Graph refuses a list (403): 409 "The connected account may not do this in the provider."
6. No application (app-only) permission and no bot registration. The lists use the signed-in user's
   delegated token. Sending to a channel (`ChannelMessage.Send` or a bot) is delivery.
7. A single-tenant app registration fails at the `organizations` endpoint (AADSTS50194). A tenant ID
   option needs a connect field or a credential field. That is a follow-up.

| operationId | Route | Action | Source | Tests |
|---|---|---|---|---|
| `startQuillsTeamsOAuthConnect` | `GET /oauth/teams/connect` | manage_settings | `getTeamsConnectUrl` | contract |
| `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations` (or `?kind=team`) | manage_settings | `fetchTeamsTeamsFn` | `providers/teams.test.ts` |
| `listQuillsIntegrationDestinations` | `…/destinations?kind=channel&parent=<team ID>` | manage_settings | `fetchTeamsChannelsFn` | `providers/teams.test.ts` |

- Teams: `GET https://graph.microsoft.com/v1.0/me/joinedTeams`. A team ID that is not a GUID is
  dropped.
- Channels: the route first lists the teams and refuses a team that is not in that list (404). The
  provider checks the GUID again before it builds
  `GET https://graph.microsoft.com/v1.0/teams/<team ID>/channels?$select=id,displayName`. A channel
  ID that is not `19:…@thread.…` is dropped.
- Paging follows `@odata.nextLink` only on `https://graph.microsoft.com`, for at most 10 pages and
  200 items. A link to another host ends the list. An answer without a `value` list is 502.
- The access token expires after about one hour. `refresh` uses the same `organizations` token
  endpoint and keeps the new refresh token.
- For delivery (not in #131): a channel ID has `@`, which the channel route and the default
  `validTarget` refuse. A Graph channel message also needs the team ID. The delivery lane adds a
  `target` rule and a target key that holds both IDs. With `events: []`, no channel can be saved now.

| Source | Kaneo |
|---|---|
| `common` endpoint | `organizations` endpoint (work and school accounts only) |
| Scope `ChannelMessage.Send` | Not requested: it is for delivery |
| `/organization` read for the tenant name and ID | Not read: it needs `User.Read`, which is not requested. The name is "Microsoft Teams", with no account |
| Two list functions; any `teamId` | The destinations route with kinds; the team must be one the connection lists |
| Channels carry `isPrivate` | ID and name only |
| First page only | `@odata.nextLink` on the Graph host, up to 200 items |
| Provider error text in thrown errors | Fixed errors |

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
