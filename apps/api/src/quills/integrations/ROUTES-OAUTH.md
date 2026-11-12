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

```
Tables and owning schema:  quills: integrations, integration_platform_credentials, principal, kv_store
                           (state nonce), events, job_queue, audit_log. public: none.
Actor and workspace:       connect and destinations: authenticated context. Callback: the signed state.
Permissions:               workspace:read + quills:manage_settings (callback: the session account still holds it).
Transactions:              read, call Atlassian with no transaction open, then write in a new one.
External effects:          token exchange and refresh (auth.atlassian.com), accessible resources,
                           project and issue type lists (api.atlassian.com). No issue is created.
```

| Source function | operationId | Route | Action | Tests |
|---|---|---|---|---|
| `getJiraConnectUrl` | `startQuillsJiraOAuthConnect` | `GET /oauth/jira/connect` | manage_settings | contract; `providers/jira.test.ts` |
| `fetchJiraProjectsFn` | `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations?kind=project` (or no `kind`) | manage_settings | contract (GitHub); `providers/jira.test.ts` |
| `fetchJiraIssueTypesFn` | `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations?kind=issue-type&parent=<project ID>` | manage_settings | `providers/jira.test.ts` |

- The callback stores the cloud ID of the first site in `accessible-resources` in `config.cloudId`. A cloud
  ID that is not a UUID refuses the connect (400). Each list checks the stored cloud ID again before it
  builds `https://api.atlassian.com/ex/jira/<cloudId>/…`; a bad value answers 409 with no call.
- Project and issue type IDs are numeric; the route drops any other ID. An issue type list needs a project
  that the project list contains (404 otherwise, with no issue type call).
- The project list is one page of 100 projects (Jira's maximum page). On a site with more projects, a
  project after the first 100 is not listed and cannot be a parent.
- Access tokens expire after one hour. A due token is refreshed before the call; Atlassian rotates the
  refresh token. A rejected refresh (400 or 403) answers 409 "Reconnect".
- Tests against the local provider server: exchange, both kinds, a foreign project, a bad stored cloud
  ID, refresh and rejected refresh, a malformed `accessible-resources` (400) and project list (502).

| Difference from the source | Reason |
|---|---|
| Scope `read:jira-work offline_access`, not `write:jira-work manage:jira-webhook` | Issue #131 lists projects and issue types only. Delivery and status sync add their scopes and a reconnect. |
| No `events` and no status sync | Out of scope for #131. |
| A connect with no valid cloud ID fails; the source stored `unknown` | The cloud ID enters every API path. |
| `siteUrl` is the connection's `account`, not a `config` value | Only the issue links of delivery use it. |
| A malformed list answer is 502, not an empty list or a raw error | Provider text never reaches a response. |

### Linear

```
Tables and owning schema:  quills: integrations, integration_platform_credentials, principal, kv_store
                           (state nonce), events, job_queue, audit_log. public: none.
Actor and workspace:       connect and destinations: authenticated context. Callback: the signed state.
Permissions:               workspace:read + quills:manage_settings (callback: the session account still holds it).
Transactions:              read, call Linear with no transaction open, then write in a new one.
External effects:          token exchange and refresh (api.linear.app/oauth/token), organization and team
                           queries (api.linear.app/graphql). No issue is created.
```

| Source function | operationId | Route | Action | Tests |
|---|---|---|---|---|
| `getLinearConnectUrl` | `startQuillsLinearOAuthConnect` | `GET /oauth/linear/connect` | manage_settings | contract; `providers/linear.test.ts` |
| `fetchLinearTeamsFn` | `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations` (one kind: teams) | manage_settings | contract (GitHub); `providers/linear.test.ts` |

- The connection's name and account are the organization's name and URL key. No `config` value is stored.
- The list asks for the first 100 teams. A team ID has 1 to 64 letters, digits and `-`; the route drops
  any other ID. The route refuses a `kind`
  or a `parent` (400): Linear has one kind.
- A due token is refreshed before the call; Linear rotates the refresh token. A rejected refresh (400)
  answers 409 "Reconnect".
- Tests against the local provider server: exchange, the team list, a refused kind and parent, refresh
  and rejected refresh, a token answer without a token (400) and a GraphQL answer without teams (502).

| Difference from the source | Reason |
|---|---|
| Scope `read`, not `read,write,issues:create,admin` | Issue #131 lists teams only. Delivery and status sync add their scopes and a reconnect. |
| No `events` and no status sync | Out of scope for #131. |
| An organization query that Linear refuses (an HTTP error) fails the connect; the source named it `Linear` | One rule for every call: a refused call is a fixed error. An answer without a name still gives `Linear`, as in the source. |
| `orgId` is not stored | Only the webhooks of status sync use it. |
| A disconnect does not revoke the token | The shared disconnect route revokes no provider token. |

### Azure DevOps

```
Tables and owning schema:  quills: integrations, events, job_queue, audit_log. public: none.
Actor and workspace:       authenticated context.
Permissions:               workspace:read + quills:manage_settings.
Transactions:              connect: `load` checks the token with no transaction open, then one scoped
                           transaction writes the connection and its `integration.connected` event.
                           Destinations: read, call Azure DevOps, then a handler transaction that
                           writes nothing (a personal access token has no refresh).
External effects:          project and work item type lists (dev.azure.com). No work item is created.
```

| Source function | operationId | Route | Action | Tests |
|---|---|---|---|---|
| `connectAzureDevOpsFn` | `saveQuillsAzureDevopsKey` | `PUT /integrations/azure-devops/connection` (`token` ≤ 500, `organization` ≤ 50) | manage_settings | contract, rollback; `providers/azure-devops.test.ts` |
| `fetchAzureDevOpsProjectsFn` | `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations?kind=project` (or no `kind`) | manage_settings | contract (GitHub); `providers/azure-devops.test.ts` |
| `fetchAzureDevOpsWorkItemTypesFn` | `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations?kind=work-item-type&parent=<project name>` | manage_settings | `providers/azure-devops.test.ts` |

- A key provider: no OAuth connect route, no callback and no OAuth app credentials. The token is a
  personal access token, sent as `Basic base64(":" + token)`. It is sealed before the check and never
  returned.
- The organization is letters, digits and inner hyphens (at most 50). The route refuses any other value
  (400) before a call. Each list checks the stored value again; a bad value answers 409 with no call.
- The destination ID is the project or work item type name, as in the source. The project name is
  encoded in the path. A work item type list needs a project that the project list contains (404
  otherwise).
- Each call sends `X-TFS-FedAuthRedirect: Suppress`, so a refused token gets 401 and not a sign-in page.
  On connect, 401 or 403 answers 400. An answer without a list is 502.
- Tests against the local provider server: connect, ten bad organization names with no call, a rejected
  token, both kinds, a foreign project, a bad stored organization, malformed answers (502).

| Difference from the source | Reason |
|---|---|
| The body takes the organization name, not `organizationUrl` | The name enters the URL; a strict pattern checks it. The host is always `dev.azure.com`. |
| No `*.visualstudio.com` organization URLs | The host is fixed. The same organization is on `dev.azure.com`. |
| `config` holds `organization` only, not `organizationUrl` and `organizationName` | One value builds every URL. |
| No `events` and no status sync | Out of scope for #131. |
| A rejected token is 400 with a fixed message; the source returned the provider error | Provider text never reaches a response. |

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
  IDs of 1 to 30 letters and digits.
- A failed GraphQL query (200 with `errors` and no `data`) is 502, for the connect and for the list.
- Tests: `providers/monday.test.ts` (local provider server): connect with a sealed token, the limit
  of 200 and the ID filter, a refused `kind`, and malformed answers (400 on the token call, 502 for a
  failed query on the connect and on the list, with fixed text).

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
  `target` accepts the same UUIDs as channel IDs; the default rule (30 letters and digits) would
  refuse them.
- Tests: `providers/notion.test.ts` (local provider server): connect with HTTP Basic and a sealed
  token, the limit of 200, UUID filter and titles, the channel ID rule, a refused `kind`, and
  malformed answers (400 and 502 with fixed text).

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

## Agent channels (RFC 0001, lane G1)

The Slack assistant, the GitHub inbox channel, the inbound app hook and the identify hook.
Decision D10: each setting comes with the hook route and the worker handler that it turns on.

### Boundary map

```
Tables and owning schema:  quills: settings (assistant_config), integrations,
                           integration_platform_credentials, channel_accounts, channel_threads,
                           channel_identities, conversations, conversation_messages, principal,
                           user, user_attribute_definitions, slack_user_links, teams (read),
                           kv_store (hook payloads and signed receipts), hook_deliveries (send
                           receipts), help_center_articles and assistant_snippets (read),
                           ai_usage_log, events, job_queue, audit_log.
                           public (read only, through framework/platform-reads.ts): workspace
                           members, roles, and the account email of a member.
Actor and workspace:       teammate routes: authenticated context. Signed routes: the workspace of
                           the integration in the path (quills.integration_workspace). Workers:
                           withQuillsSystemWorkspace with the job's workspace. The Slack asker is
                           the teammate that slack_user_links names; a first link needs a current
                           member whose verified account email is the Slack profile email.
Permissions:               settings and status: quills:manage_settings. Retry: quills:update.
                           Slack hook: the Slack signing secret of the workspace's Slack app.
                           GitHub events: the status-sync webhook secret. Identify: the Segment
                           shared secret. The Slack worker answers only a current member whose
                           role holds quills:read now.
Persisted relationships:   channel_accounts.config.integrationId (the inbox's connection);
                           channel_threads (issue `owner/repo#n` to conversation);
                           channel_identities (GitHub user to principal); slack_user_links.
Transactions:              one scoped transaction per request. Provider calls run in `call`
                           (GitHub webhook update) or in a worker with no transaction open.
External effects:          GitHub webhook update (request, `call`); Slack users.info and
                           chat.postMessage, GitHub issue comment create and list (workers, after
                           commit, with a hook_deliveries receipt before each send).
```

### Routes

| operationId | Route | Audience | Action | Tables | Event |
|---|---|---|---|---|---|
| `getQuillsSlackAgentSettings` | `GET /assistant/slack` | teammate | manage_settings | `settings`, `integrations`, `integration_platform_credentials` | - |
| `setQuillsSlackAssistantEnabled` | `PUT /assistant/slack` (`expectedRevision`, `enabled`) | teammate | manage_settings | `settings` | `slack_agent.settings_updated` |
| `getQuillsGitHubChannelStatus` | `GET /channels/github` | teammate | manage_settings | `integrations`, `channel_accounts` | - |
| `setQuillsGitHubInboxEnabled` | `PUT /channels/github/inbox` (`enabled`) | teammate | manage_settings | `integrations`, `channel_accounts`, `teams` | `github_inbox.settings_updated` |
| `retryQuillsGitHubAgentMessage` | `POST /conversation-messages/{messageId}/github-retry` | teammate | update | `conversation_messages`, `conversations` | `github_inbox.message_retried` |
| `saveQuillsSegmentConnection` | `PUT /integrations/segment/connection` (`incomingSecret`) | teammate | manage_settings | `integrations` | `integration.connected` |
| `receiveQuillsAppHook` | `POST /quills-public/signed/integrations/slack/{integrationId}/hooks/events` | signed (Slack) | create | `kv_store`, `settings` | `integration.hook_received` |
| `receiveQuillsIdentify` | `POST /quills-public/signed/integrations/segment/{integrationId}/identify` | signed (Segment) | update | `user`, `user_attribute_definitions` | `user.identified` |
| `receiveQuillsIntegrationWebhook` (extended) | `POST /quills-public/signed/integrations/github/{integrationId}/webhook` | signed (GitHub) | update | `channel_accounts`, `channel_threads`, `channel_identities`, `principal`, `conversations`, `conversation_messages` | `message.created`, `message.updated`, `message.deleted`, `conversation.status_changed` |

- Slack: register `<KANEO_API_URL origin>/api/quills-public/signed/integrations/slack/<integration ID>/hooks/events`
  (the settings read returns it) as the Event Subscriptions URL, and subscribe to `app_mention` and
  `message.im`. Save the app's signing secret with the platform credentials (`signingSecret`). The
  connection ID is stable across reconnects. The hook stores the question in `kv_store` for one day,
  never in the event or audit row.
- GitHub inbox: it uses the status-sync webhook of the connection. Enabling adds `issue_comment` to
  that webhook's events; disabling sets them back to `issues`. A webhook update that fails keeps the
  switch and records `lastError`, as the source does. Enabling or disabling status sync turns the
  inbox off (`status-sync.ts#inboxOff`): a new webhook has `issues` only, and a removed one sends
  nothing. An edit or a delete in GitHub changes only a customer's message, never a teammate reply,
  and events older than the replay horizon change nothing.
- Slack answers: the team ceiling in a direct message, the public ceiling in a channel (a channel can
  hold Slack guests and Slack Connect members).
- Identify: connect Segment with its shared secret, then send identify calls to
  `/api/quills-public/signed/integrations/segment/<integration ID>/identify` (`x-signature`:
  base64 HMAC-SHA1 of the body).

### Worker handlers

| Event | Queue | Handler | Deduplication and reconciliation |
|---|---|---|---|
| `integration.hook_received` (Slack) | `quills.ai` | `assistant/engine/slack.ts` | Receipt key `slack-answer:<hook key>` in `hook_deliveries`, written before `chat.postMessage`. A rerun, a lost lease or an expired lease that finds the receipt does not post: `processing` from a stopped attempt becomes `uncertain` and is never posted again. |
| `message.created` (agent reply on a GitHub conversation), `github_inbox.message_retried` | `quills.webhook` (payload without `webhookId` or `operationId`) | `jobs/handlers/github-comment.ts` | Receipt key `github-comment:<message ID>` (a retry adds its event ID), written before the comment. Each comment carries `<!-- kaneo:<message ID> -->`. A retry first lists the issue's comments since the message and marks the message sent when one has the marker. An uncertain send is never repeated automatically. |

### Behavior differences from the source

| Source | Kaneo |
|---|---|
| Slack: streamed replies, slash command, message shortcut, proposal buttons, feedback reactions, App Home prompts, Stop, thread follow-ups, revocation events | Not ported. The assistant answers an `app_mention` or a direct message with one reply in the thread, from the help center and knowledge (team ceiling, copilot knowledge settings). |
| Slack: the workspace assistant with every workspace tool, with the asker's access in any channel | One provider call over the retrieved sources; no write tools. A channel answer uses public sources only. |
| Slack: an attempt that the job reruns calls the model again before it finds the receipt | The same: a rerun or a replacement worker after a lost lease calls the provider again, then posts nothing. |
| GitHub inbox close and reopen order | The last event to commit wins; ordering needs the issue's remote state time on `channel_threads` (a migration). |
| Slack routing check (`routing`, pooled tenancy) | Not applicable: Kaneo serves each workspace directly. The read returns `hookUrl` and `signingConfigured` instead. |
| Slack signing secret in instance platform credentials | In the workspace's Slack platform credentials (`signingSecret`). |
| GitHub inbox: its own webhook on `config.channelId` | The status-sync webhook; status sync must be on (409 otherwise). |
| GitHub agent replies after the inbox is off still post | The worker posts only while the inbox is on (the message is marked failed). |
| GitHub retry resets any message and posts again | Only a `failed` delivery, or a `pending` one older than ten minutes; a marker check runs first. |
| `retryGitHubAgentMessageFn` takes `messageId` in the body | The message ID is a path parameter. |
| Identify updates only existing users | The same: an unknown email changes nothing (`status: unknown`). `_externalUserId` goes into the metadata, as in the source. No ordering check against newer identify calls. |
| Segment connection through the admin UI | `saveQuillsSegmentConnection` with the shared secret only; outbound Segment sync is not ported. |
| Delivery ticks over SSE | The worker writes `channelDelivery`; clients see it on the next read. |

## Deferred or not implemented

| Source rows | Reason |
|---|---|
| Microsoft Teams | Graph channel messages need tenant consent and a bot registration. Decision D7 (RFC 0001) puts it in scope: lane P4. |
| Asana, Azure DevOps, ClickUp, HubSpot, Intercom, Jira, Linear, Monday, Notion, Salesforce, Trello, Zendesk | Decision D7 (RFC 0001) puts them in scope: lanes P1 to P3 (see "Providers in RFC 0001"). |
| Segment outbound sync (segment membership pushed to Segment) | RFC 0001 section 11 leaves Segment out of scope. Lane G1 builds only the connection and the identify hook, because identify has no other provider. |
| GitLab self-managed instances | The provider host would come from user input; needs the SSRF-checked outbound path and a host field. gitlab.com only. |
| `api/integrations/{type}/hooks/{kind}` kinds `interactions`, `commands`, `options` | The Slack `events` kind is built ("Agent channels"); buttons, the slash command and shortcuts are not ported. |
| `api/v1/apps/**`, `apps*`, `setQuillsIframeHeaders` | The app sidebar authenticates a third-party app with its own token and needs iframe headers; neither fits the signed nor the teammate audience without a new app-token model. |
| `oauth/connector/callback` | Assistant connectors (P8 assistant slice). |
| `updateTicketStatusMappingsFn`, `updatePushStatusMappingsFn` | Ticket status sync and outbound status push need ticket links to tracker issues first. |
| Ticket issue status sync | Inbound issue events update post links only. Ticket issue links are built (`support/TICKETS.md`, "Tracker issue links"). |
| `verifyQuillsIntegrationSyncReference`, recovery `reconcile`/`keep_remote`/`link_existing` | Remote item inspection per provider; search exists, inspection does not. |
| Post activity entry for an inbound status change | `recordActivity` takes a teammate actor; the change is audited as a system change. |
