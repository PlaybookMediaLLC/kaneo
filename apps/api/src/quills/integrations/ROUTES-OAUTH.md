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

| Source | Route | operationId |
|---|---|---|
| `getAsanaConnectUrl` | `GET /oauth/asana/connect` | `startQuillsAsanaOAuthConnect` |
| `fetchAsanaProjectsFn` | `GET /integrations/{integrationId}/destinations` | `listQuillsIntegrationDestinations` |

- Boundary: the map at the top of this file. Both routes need `manage_settings`. The provider calls
  only `app.asana.com`, with no transaction open.
- Connect: the callback exchanges the code at `/-/oauth_token`, then reads `/api/1.0/users/me`. It
  stores the first Asana workspace of the account in `config.workspaceGid`. The sealed secrets are
  `accessToken`, `refreshToken` and `expiresAt`.
- Destinations: one kind, the projects of that workspace (one page of 100, `archived=false`). The
  route keeps only IDs of 1 to 30 letters and digits.
- Refresh: an access token that is due within a minute is refreshed first. Asana keeps the refresh
  token. A refused refresh (400) is 409: reconnect. A missing or out-of-range `expires_in` stores no
  expiry, so that token is never refreshed.
- Tests: `providers/asana.test.ts` (local provider server): connect with sealed tokens, the limit of
  200, the ID filter and `archived=false`, a refused `kind`, refresh with the new expiry, refused
  refresh, an account without a workspace (400), an out-of-range expiry, and malformed answers (400
  and 502 with fixed text).

| Difference from the source | Reason |
|---|---|
| A connect without an Asana workspace, or with a failed profile read, fails. The source stored `unknown` and the name "Asana". | The project list needs the workspace. |
| Asana filters archived projects (`archived=false`). The source filtered them after the call. | A page of 100 holds only active projects. |
| The refresh also sends `redirect_uri`. | Asana's token endpoint documents it for both grants. |
| No task creation, status sync, webhook or token revoke at disconnect. | Delivery and status sync are out of scope for #131. |

### ClickUp

| Source | Route | operationId |
|---|---|---|
| `getClickUpConnectUrl` | `GET /oauth/clickup/connect` | `startQuillsClickupOAuthConnect` |
| `fetchClickUpSpacesFn` | `GET /integrations/{integrationId}/destinations` (default kind, or `?kind=space`) | `listQuillsIntegrationDestinations` |
| `fetchClickUpListsFn` | `GET /integrations/{integrationId}/destinations?kind=list&parent=<space ID>` | `listQuillsIntegrationDestinations` |

- Boundary: the map at the top of this file. Both routes need `manage_settings`. The provider calls
  only `app.clickup.com` and `api.clickup.com`, with no transaction open.
- Connect: the callback exchanges the code at `/api/v2/oauth/token`, then reads `/api/v2/team`. It
  stores the first ClickUp workspace (a team in the API) in `config.teamId`. The sealed secret is
  `accessToken`; ClickUp tokens do not expire.
- Destinations: `destinationKinds: { space: {}, list: { parent: "space" } }`. Spaces come from the
  stored team. Lists are the folderless lists of one space. The route lists the team's spaces first
  and refuses a space that is not among them (404), so the token never reads another team's space.
  The route keeps only IDs of 1 to 30 letters and digits.
- Tests: `providers/clickup.test.ts` (local provider server): connect with a sealed token, spaces by
  default and by kind, lists with the limit of 200, a foreign space refused before the list call,
  refused kind and parent values, an account without a team (400), and malformed answers (400 and
  502 with fixed text).

| Difference from the source | Reason |
|---|---|
| A connect without a ClickUp team fails. The source stored `unknown`. | The space list needs the team. |
| A list request names a space of the stored team. The source listed any space ID it got. | Authorization: the token may reach more teams. |
| No task creation, status sync or webhook. | Delivery and status sync are out of scope for #131. |

### Trello

The connect is deferred: Trello returns the token in the URL fragment, and no page reads it yet.
`providers/trello.ts` exists but is not in `providers/index.ts`. So Trello stays "not available" in
the catalog, and none of its three entry points has a route.

| Source | Route when registered | State |
|---|---|---|
| `getTrelloConnectUrl` | `GET /oauth/trello/connect` (`startQuillsTrelloOAuthConnect`) | Open: the callback cannot complete |
| `fetchTrelloBoardsFn` | `GET /integrations/{integrationId}/destinations` (default kind, or `?kind=board`) | Open: no connection can exist |
| `fetchTrelloListsFn` | `GET /integrations/{integrationId}/destinations?kind=list&parent=<board ID>` | Open: no connection can exist |

Built in `providers/trello.ts` (tests: `providers/trello.test.ts`, with fetch answered in the test):

- `authorizeUrl`: `https://trello.com/1/authorize` with `callback_method=fragment`,
  `response_type=token`, `scope=read,write`, `expiration=never`, and `return_url` set to the signed
  callback with the state. The client ID is the Trello API key.
- `exchange(token)`: refuses a token that is not 32 to 256 letters and digits (it goes into a
  header). Then it checks the token with `GET https://api.trello.com/1/members/me` and returns it as
  the only secret. The username is the account label.
- `destinationKinds: { board: {}, list: { parent: "board" } }`. Boards are the member's open boards;
  lists are the open lists of one board. Only 24-digit hexadecimal IDs pass. A list answer that is
  not a list is 502.
- Each call sends the key and the token in the `Authorization: OAuth …` header, never in the URL.
  Hosts: `trello.com` and `api.trello.com`.

Missing (from `providers/README.md`, "Trello"):

1. An HTML answer for a signed route. `framework/define-route.ts` allows `raw` answers only as RSS and
   XML for portal, widget and public reads. Lane X1 owns that file.
2. A `callback: "fragment"` option on the provider type, and the GET callback in `oauth.ts` answering
   the bridge page for such a provider without consuming the state. The page reads `token` from
   `location.hash`, removes the fragment with `history.replaceState`, and posts `{ token }` as JSON to
   the same URL with `credentials: "same-origin"`. Headers:
   `Content-Security-Policy: default-src 'none'; script-src 'nonce-…'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
   `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
3. `POST /quills-public/signed/oauth/{type}/callback?state=…` for fragment providers only, with the
   same `oauthState` verifier (valid signature, unexpired, same session account, still holds
   `quills:manage_settings`, single use), an `Origin` header equal to the API origin, and a body of at
   most 4 KiB. The token never enters a log, an event or a response. The handler calls
   `exchange(token, …)`, then `connect`.
4. Then two lines in `providers/index.ts`, a connect fixture `startQuillsTrelloOAuthConnect` in
   `oauth.fixture.ts`, and route tests against the local provider server, as for the other providers.

| Difference from the source | Reason |
|---|---|
| The key and the token travel in the `Authorization` header. The source put them in the query string. | A URL reaches logs and proxies. |
| The API key comes from the OAuth app credentials at each call. The source copied it into `config`. | One place for the key. |
| `exchange` checks the token format before the call. | The token comes from the browser. |
| Lists keep Trello's order. The source sorted them by `pos`. | Trello already answers in board order. |

### Monday

| Source | Route | operationId |
|---|---|---|
| `getMondayConnectUrl` | `GET /oauth/monday/connect` | `startQuillsMondayOAuthConnect` |
| `fetchMondayBoardsFn` | `GET /integrations/{integrationId}/destinations` | `listQuillsIntegrationDestinations` |

- Boundary: the map at the top of this file. Both routes need `manage_settings`. The provider calls
  only `auth.monday.com` and `api.monday.com`, with no transaction open.
- Connect: the callback exchanges the code at `auth.monday.com/oauth2/token`, then reads the account
  name with the GraphQL query `me`. The sealed secret is `accessToken`; Monday.com tokens do not
  expire.
- Destinations: one kind, the boards (`boards(limit: 100, order_by: used_at)`). The route keeps only
  IDs of 1 to 30 letters and digits. A failed GraphQL query (200 with `errors` and no `data`) is 502.
- Tests: `providers/monday.test.ts` (local provider server): connect with a sealed token, the limit
  of 200 and the ID filter, a refused `kind`, and malformed answers (400 and 502 with fixed text).

| Difference from the source | Reason |
|---|---|
| A failed account read fails the connect. The source connected with the name "Monday.com". | The same rule as the other providers: a connect that cannot read the account is not complete. |
| The account label is the Monday.com user name. The source stored no account label. | The integration summary shows `account`. |
| No item creation. | Delivery is out of scope for #131. |

### Notion

| Source | Route | operationId |
|---|---|---|
| `getNotionConnectUrl` | `GET /oauth/notion/connect` | `startQuillsNotionOAuthConnect` |
| `fetchNotionDatabasesFn` | `GET /integrations/{integrationId}/destinations` | `listQuillsIntegrationDestinations` |

- Boundary: the map at the top of this file. Both routes need `manage_settings`. The provider calls
  only `api.notion.com`, with no transaction open.
- Connect: the callback exchanges the code at `/v1/oauth/token`. The OAuth app authenticates with
  HTTP Basic, so the client secret is never in the body. The answer names the workspace and the
  owner. The sealed secret is `accessToken`; Notion tokens do not expire.
- Destinations: one kind, the databases that the teammate shared with the integration
  (`POST /v1/search`, one page of 100, `Notion-Version: 2022-06-28`). The route keeps only UUID IDs.
- Tests: `providers/notion.test.ts` (local provider server): connect with HTTP Basic and a sealed
  token, the limit of 200, UUID filter and titles, a refused `kind`, and malformed answers (400 and
  502 with fixed text).

| Difference from the source | Reason |
|---|---|
| The Notion workspace ID is not stored. | No route uses it. |
| The account label is the owner's name. The source stored no account label. | The integration summary shows `account`. |
| No page creation. | Delivery is out of scope for #131. |

### HubSpot

Filled by lane P3.

### Intercom

Filled by lane P3.

### Zendesk

Filled by lane P3.

### Salesforce

Filled by lane P3.

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
