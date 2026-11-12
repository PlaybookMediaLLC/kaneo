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
Permissions:               teammate routes: workspace:read + quills:<action>. OAuth callbacks and the
                           bridge page: the session account still holds quills:manage_settings; the
                           token post also needs this API's Origin. Webhook: the signature.
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
| `completeQuillsOAuthConnect` | `GET /quills-public/signed/oauth/{type}/callback?state&code` (signed; not for a fragment provider) | manage_settings (session) | `integrations`, `principal`, `kv_store` | `integration.connected` | contract signed table: forged, expired, wrong provider, other session, workspace B, replay |
| `openQuillsOAuthBridge` | `GET /quills-public/signed/oauth/{type}/bridge?state` (signed, HTML; fragment providers) | a state signed for this provider (the POST checks the session and the permission) | `kv_store` | none | contract signed table; `providers/trello-routes.test.ts`: exact headers, no secret, once per state; `oauth-bridge.test.ts`: the scripts run |
| `completeQuillsOAuthFragmentConnect` | `POST /quills-public/signed/oauth/{type}/callback?state` with `{ token }` (signed; fragment providers) | manage_settings (session) | `integrations`, `integration_platform_credentials`, `principal`, `kv_store` | `integration.connected` | contract signed table, plus missing or foreign `Origin`; `providers/trello-routes.test.ts` |

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

The worker sends through the provider registry (FU3a): each provider's `deliver`, for the events in its
`events`. The seam is provider-neutral:

- A 401 proves that nothing was made. A provider with `refresh` refreshes once and sends once more; a
  second 401 asks for a reconnect. GitLab gets this too (before FU3a, a GitLab 401 asked for a
  reconnect at once).
- A provider with `deliveryScopes` sends only when `config.scopes` holds them. Otherwise the sync ends
  `auth_required` with the fixed message "Reconnect the integration to grant write access." and no
  provider call. The job fails at once (no retry).
- A resync after a reconnect sends no create that an earlier installation of the connection sent or
  may have sent to the same channel (its create is `running`, `uncertain` or `succeeded`). This applies
  to every provider, chat and webhook ones too. A `failed` or `auth_required` create was certainly not
  sent, so the resync sends it.
- Adding a channel checks the provider's `target` rule (400 otherwise). The channel schema accepts 1 to
  100 characters without `/`, `\`, `?`, `#`, `%` or control characters.

`providers/README.md` ("Add delivery to a provider") lists what a provider lane adds.

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
                           project and issue type lists (api.atlassian.com). Worker (FU3a): issue
                           create, after the event's transaction committed.
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

Delivery (FU3a, the worker; no route):

- Events: `post.created` only, as in the source hook. A channel is `<project ID>:<issue type ID>`, both
  numeric (a destination of each kind); adding another channel answers 400.
- Scopes: `read:jira-work write:jira-work offline_access`. The callback stores the granted scopes in
  `config.scopes` (the token answer's `scope`, or the requested ones when it has none). Delivery needs
  `write:jira-work`.
- **Existing connections must reconnect.** A connection made before FU3a has no `config.scopes`: each
  delivery ends `auth_required` with "Reconnect the integration to grant write access." and no call.
- `POST https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/issue`. The stored cloud ID is checked
  before each call (a bad one asks for a reconnect with no issue call; a due token is still refreshed first). The summary is one
  line of at most 255 characters. The description is Atlassian Document Format with plain text nodes:
  each line of the post (at most 2000 characters), a rule, the author and the board.
- The issue key is the link's external ID. The link URL is `<site>/browse/<key>` only when the stored
  site (`account`) is `https://<name>.atlassian.net`; otherwise it is empty.
- Outcomes: see "Providers". A 2xx answer without a valid key is `uncertain`.
- Tests: `jobs/handlers/tracker-delivery.test.ts` (the worker evidence table) and
  `jobs/handlers/provider-send.test.ts`.

| Difference from the source | Reason |
|---|---|
| Scope `read:jira-work write:jira-work offline_access`, not also `manage:jira-webhook` | Delivery creates issues. Status sync (inbound) adds its scope and a reconnect. |
| No status sync; delivery fails closed without the stored write scope | Inbound sync is out of scope. A request that must get 403 is not sent. |
| The channel must name the issue type; the source also took a bare project ID | Jira's create needs an issue type. |
| No "View in …" link in the description | No portal URL exists for a post yet. |
| A connect with no valid cloud ID fails; the source stored `unknown` | The cloud ID enters every API path. |
| `siteUrl` is the connection's `account`, not a `config` value | Only the issue links of delivery use it, after a host check. |
| A malformed list answer is 502, not an empty list or a raw error | Provider text never reaches a response. |

### Linear

```
Tables and owning schema:  quills: integrations, integration_platform_credentials, principal, kv_store
                           (state nonce), events, job_queue, audit_log. public: none.
Actor and workspace:       connect and destinations: authenticated context. Callback: the signed state.
Permissions:               workspace:read + quills:manage_settings (callback: the session account still holds it).
Transactions:              read, call Linear with no transaction open, then write in a new one.
External effects:          token exchange and refresh (api.linear.app/oauth/token), organization and team
                           queries (api.linear.app/graphql). Worker (FU3a): `issueCreate`, after the
                           event's transaction committed.
```

| Source function | operationId | Route | Action | Tests |
|---|---|---|---|---|
| `getLinearConnectUrl` | `startQuillsLinearOAuthConnect` | `GET /oauth/linear/connect` | manage_settings | contract; `providers/linear.test.ts` |
| `fetchLinearTeamsFn` | `listQuillsIntegrationDestinations` | `GET /integrations/{integrationId}/destinations` (one kind: teams) | manage_settings | contract (GitHub); `providers/linear.test.ts` |

- The connection's name and account are the organization's name and URL key. `config` stores only the
  granted scopes (FU3a).
- The list asks for the first 100 teams. A team ID has 1 to 64 letters, digits and `-`; the route drops
  any other ID. The route refuses a `kind`
  or a `parent` (400): Linear has one kind.
- A due token is refreshed before the call; Linear rotates the refresh token. A rejected refresh (400)
  answers 409 "Reconnect".
- Tests against the local provider server: exchange, the team list, a refused kind and parent, refresh
  and rejected refresh, a token answer without a token (400) and a GraphQL answer without teams (502).

Delivery (FU3a, the worker; no route):

- Events: `post.created` only, as in the source hook. A channel is a team ID, a UUID; adding another
  channel answers 400 (the earlier default rule refused UUIDs).
- Scopes: `read,issues:create`. The callback stores the granted scopes in `config.scopes` (the token
  answer's `scope` as a string or a list, or the requested ones when it has none). Delivery needs
  `issues:create`.
- **Existing connections must reconnect.** A connection made before FU3a has no `config.scopes`: each
  delivery ends `auth_required` with "Reconnect the integration to grant write access." and no call.
- One `issueCreate` mutation on `https://api.linear.app/graphql`, with the values as GraphQL variables:
  `teamId`, the title (one line, at most 255 characters) and the Markdown description (the post
  content is Markdown; at most 2000 characters, then the author and the board).
- The issue UUID is the link's external ID (an identifier changes when an issue moves to another team).
  The identifier (`ENG-12`) is the link's display ID and the sync history's `remoteDisplayId`. The URL
  is kept only on `https://linear.app`.
- Linear answers 200 with `errors` for a refused mutation. With no `issueCreate`, only a refusal before
  the write proves that no issue exists: authentication or forbidden errors ask for a reconnect, a rate
  limit waits for a retry, and invalid input, user, GraphQL, usage-limit or feature errors fail. Any
  other error (an internal error or a lock timeout can follow a write) and any other answer without an
  issue is `uncertain`. Provider text is never kept.
- Tests: `jobs/handlers/tracker-delivery.test.ts` and `jobs/handlers/provider-send.test.ts`.

| Difference from the source | Reason |
|---|---|
| Scope `read,issues:create`, not `read,write,issues:create,admin` | Delivery creates issues only. Status sync (inbound) adds its scopes and a reconnect. |
| No status sync; delivery fails closed without the stored scope | Inbound sync is out of scope. A request that must be refused is not sent. |
| A GraphQL refusal is a fixed outcome; the source kept Linear's error message | Provider text never reaches a response or a record. |
| No "View in …" link in the description | No portal URL exists for a post yet. |
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
External effects:          project and work item type lists (dev.azure.com). Worker (FU3a): work item
                           create, after the event's transaction committed.
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

Delivery (FU3a, the worker; no route):

- Events: `post.created` only, as in the source hook. A channel is `<project>:<work item type>`, split
  at the first `:`. Each name follows Azure DevOps' naming rules: at most 64 characters, none of
  `\ / : * ? " ' < > ; # $ { } , + = [ ] |`, no control character, not starting with `_`, `.` or a
  space and not ending with `.` or a space. `%` is refused too (the channel route refuses it), and the
  whole channel has at most 100 characters (the mapping column). Adding another channel answers 400.
- A personal access token has no granted-scope list: the teammate gives it "Work Items (Read & write)".
  A token without it gets 401 or 403, which asks for a reconnect (no refresh, no retry). Existing
  connections do not need to reconnect unless their token lacks that scope.
- `POST https://dev.azure.com/<organization>/<project>/_apis/wit/workitems/$<type>?api-version=7.1`
  with a JSON Patch (`application/json-patch+json`). The stored organization is checked before each
  call; both names are encoded. The title is one line of at most 255 characters. The description is
  HTML in which every part of the post is escaped: one `<p>` per line (at most 2000 characters), `<hr>`,
  the author and the board.
- The work item ID is the link's external ID. The link URL is built on the fixed host
  (`…/<project>/_workitems/edit/<id>`), never taken from the answer. A 2xx answer without a positive
  integer ID is `uncertain`.
- Tests: `jobs/handlers/tracker-delivery.test.ts` and `jobs/handlers/provider-send.test.ts`.

| Difference from the source | Reason |
|---|---|
| The body takes the organization name, not `organizationUrl` | The name enters the URL; a strict pattern checks it. The host is always `dev.azure.com`. |
| No `*.visualstudio.com` organization URLs | The host is fixed. The same organization is on `dev.azure.com`. |
| `config` holds `organization` only, not `organizationUrl` and `organizationName` | One value builds every URL. |
| No status sync | Inbound sync is out of scope. |
| The link URL is built from the fixed host; the source took `_links.html.href` | Every URL comes from a fixed host. |
| The description escapes `'` too, and has no "View in …" link | Post text is never markup; no portal URL exists for a post yet. |
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
  route keeps only gids of 1 to 30 digits.
- Refresh: an access token that is due within a minute is refreshed first. Asana keeps the refresh
  token. A refused refresh (400) is 409: reconnect. A missing or out-of-range `expires_in` stores no
  expiry, so that token is never refreshed.
- Tests: `providers/asana.test.ts` (local provider server): connect with sealed tokens, the limit of
  200, the ID filter and `archived=false`, a refused `kind`, refresh with the new expiry, refused
  refresh, an account without a workspace (400), an out-of-range expiry, and malformed answers (400
  and 502 with fixed text).

Delivery (FU3b, the worker; no route):

- Events: `post.created` only, as in the source hook. A channel is a project gid (1 to 30 digits, the
  destination ID); adding another channel answers 400.
- Scopes: none to add. The authorize URL lists no scopes (the OAuth app's settings grant them), so
  there is no `deliveryScopes` and existing connections do not reconnect. A token that cannot create
  tasks gets 403, which asks for a reconnect.
- `POST https://app.asana.com/api/1.0/tasks` with `{ data: { name, html_notes, projects: [<gid>],
  workspace } }`. The stored `config.workspaceGid` is checked before each call (a bad one asks for a
  reconnect with no call). The name is one line of at most 255 characters. `html_notes` is Asana rich
  text (XML): `<body>`, each line of the post (at most 2000 characters), a blank line, the author and
  the board, with line breaks only. Every part is escaped (`&`, `<`, `>`), and characters that XML
  refuses (control characters, lone surrogates) are dropped.
- The task gid is the link's external ID. The link URL is `permalink_url` only on
  `https://app.asana.com/` (no other host, port or user); otherwise it is empty. A 2xx answer without
  a gid is `uncertain`.
- A due token is refreshed before the call, and a 401 refreshes once and sends once more.
- Tests: `jobs/handlers/asana-delivery.test.ts` (the worker evidence table, the escaped body, the
  stored workspace and channel checks, and the link host rule).

| Difference from the source | Reason |
|---|---|
| A connect without an Asana workspace, or with a failed profile read, fails. The source stored `unknown` and the name "Asana". | The project list needs the workspace. |
| Asana filters archived projects (`archived=false`). The source filtered them after the call. | A page of 100 holds only active projects. |
| The refresh also sends `redirect_uri`. | Asana's token endpoint documents it for both grants. |
| The notes use only `<body>` and line breaks. The source also used `<p>`, `<hr/>` and `<a>`. | Asana rich text does not list `<p>`; no portal URL exists for a post yet. |
| The link URL is kept only on `https://app.asana.com/`. The source kept any `permalink_url`. | A link comes only from the provider's own host. |
| No status sync, webhook or token revoke at disconnect. | Status sync is out of scope. |

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
  The route keeps only IDs of 1 to 30 digits.
- Tests: `providers/clickup.test.ts` (local provider server): connect with a sealed token, spaces by
  default and by kind, lists with the limit of 200, a foreign space refused before the list call,
  refused kind and parent values, an account without a team (400), and malformed answers (400 and
  502 with fixed text).

Delivery (FU3b, the worker; no route):

- Events: `post.created` only, as in the source hook. A channel is a list ID (the child destination;
  1 to 30 digits). The rule cannot tell a list from a space, which is also digits: add a list. A
  task call for an ID that is not a list gets ClickUp's 4xx (`failed`).
- Scopes: none to add. ClickUp has no OAuth scopes (the token acts as the teammate), so existing
  connections do not reconnect. ClickUp tokens do not expire: a 401 or 403 asks for a reconnect.
- `POST https://api.clickup.com/api/v2/list/<list ID>/task` with `{ name, description }`. The list ID
  is encoded. The name is one line of at most 255 characters. The description is plain text (not
  `markdown_description`): each line of the post (at most 2000 characters), a blank line, the author
  and the board. ClickUp shows it as typed, so nothing is escaped.
- The task ID (1 to 64 letters and digits) is the link's external ID. The link URL is `url` only on
  `https://app.clickup.com/`; otherwise it is empty. A 2xx answer without a task ID is `uncertain`.
- Tests: `jobs/handlers/clickup-delivery.test.ts` (the worker evidence table, the plain-text body, the
  channel rule and the link host rule).

| Difference from the source | Reason |
|---|---|
| A connect without a ClickUp team fails. The source stored `unknown`. | The space list needs the team. |
| A list request names a space of the stored team. The source listed any space ID it got. | Authorization: the token may reach more teams. |
| The description is plain text. The source sent Markdown in `description`, which ClickUp shows as typed. | The same text, without Markdown marks that do not render. |
| No "View in …" link in the description. | No portal URL exists for a post yet. |
| The link URL is kept only on `https://app.clickup.com/`; a 2xx without a task ID is `uncertain`. The source kept any answer. | A link comes only from the provider's own host; the task may exist. |
| No status sync or webhook. | Status sync is out of scope. |

### Trello

Trello returns the token in the URL fragment, which no server receives. A bridge page reads it and
posts it to the callback (follow-up FU1; `providers/README.md`, "Fragment providers").

| Source | Route | operationId |
|---|---|---|
| `getTrelloConnectUrl` | `GET /oauth/trello/connect` | `startQuillsTrelloOAuthConnect` |
| (the source's fragment bridge) | `GET /quills-public/signed/oauth/{type}/bridge?state` (HTML) | `openQuillsOAuthBridge` |
| (the source's fragment callback) | `POST /quills-public/signed/oauth/{type}/callback?state` | `completeQuillsOAuthFragmentConnect` |
| `fetchTrelloBoardsFn` | `GET /integrations/{integrationId}/destinations` (default kind, or `?kind=board`) | `listQuillsIntegrationDestinations` |
| `fetchTrelloListsFn` | `GET /integrations/{integrationId}/destinations?kind=list&parent=<board ID>` | `listQuillsIntegrationDestinations` |

- Boundary: the map at the top of this file. The connect route and the token post check
  `manage_settings` for the session account in the state's workspace. Trello is called only at
  `trello.com` and `api.trello.com`, with no transaction open.
- Connect: `authorizeUrl` is `https://trello.com/1/authorize` with `callback_method=fragment`,
  `response_type=token`, `scope=read,write`, `expiration=never`, and `return_url` set to the bridge
  page with the state. The client ID is the Trello API key. The credentials routes return the bridge
  URL as `redirectUri`: add its origin to the allowed origins of the key.
- Bridge page: a static page with one inline script, allowed by the hash of the script that the route
  declares. It reads the token, removes the fragment, then posts `{ token }` to `callback` next to it.
  Headers: a CSP with `default-src 'none'`, `connect-src 'self'` and `frame-ancestors 'none'`,
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. It
  needs only a state that this instance signed for Trello (401 otherwise), also an expired one or one
  from another session, so the token leaves the address even when the post must fail. It opens once for
  each state (its own receipt) and does not use the state up. A second visit gets a page that only
  removes the fragment.
- Token post, in order: `Origin` is the API origin and `Sec-Fetch-Site`, when sent, is `same-origin`
  (else 401); the state signature, expiry and provider (401); the session account is the state's
  (401); it still holds `quills:manage_settings` (403); the body is `{ token }` with at most 2,048
  characters (400); a used state answers `already_used` (200, no change); the OAuth app is saved (409).
  Then `exchange(token)` with no transaction open: a token that is not 32 to 256 letters and digits
  is 400 before any call; Trello's refusal is 409; an answer without a username is 400; no answer is
  502. Last, one scoped transaction seals the token, creates or replaces the connection and records
  `integration.connected`. A failure before that leaves the state usable.
- The page's scripts: `oauth-bridge.test.ts` runs them with stub browser objects: the fragment goes
  before the post, the post goes to `callback` with the state, and the text is fixed on a failure.
- The token goes only into `secrets`. It is never in a URL, a response, an audit row, an event or a
  log line.
- Destinations: `destinationKinds: { board: {}, list: { parent: "board" } }`. Boards are the member's
  open boards; lists are the open lists of one board. The route lists the boards first and refuses a
  board that is not among them (404) before the list call. Only 24-digit hexadecimal IDs pass. A list
  answer that is not a list is 502.
- Each call sends the key and the token in the `Authorization: OAuth …` header, never in the URL.
- Tests: `providers/trello.test.ts` (provider calls, fetch answered in the test) and
  `providers/trello-routes.test.ts` (local provider server and PostgreSQL): the return URL, the bridge
  page headers and body, once per state, also for an expired state or another session; connect with a
  sealed token that is absent from responses, audit rows, events, jobs and every log line of the file;
  replay; forged, expired and foreign states, another session, no session, workspace B, a removed
  member, a lost permission, a GitHub state and the code callback refused; missing, foreign and
  cross-site `Origin`; Trello's refusal (409), a malformed answer (400), no answer (502) and no OAuth
  app (409), each with the state still usable; boards, lists, and a board that is not listed (404
  before the list call). `oauth-bridge.test.ts` runs the page scripts.

| Difference from the source | Reason |
|---|---|
| The key and the token travel in the `Authorization` header. The source put them in the query string. | A URL reaches logs and proxies. |
| The API key comes from the OAuth app credentials at each call. The source copied it into `config`. | One place for the key. |
| `exchange` checks the token format before the call. | The token comes from the browser. |
| Lists keep Trello's order. The source sorted them by `pos`. | Trello already answers in board order. |
| The page is at `/bridge` and posts to `/callback`. The source used one URL for both. | The code callback already owns `GET /callback`. |
| The page allows its script by hash, not a nonce. | The page is static; the route declares the script and the framework hashes it once. |
| The page opens for any state signed for Trello; the post checks the rest. | The page must load to take the token out of the address. |
| The token post needs this API's `Origin`. | Only the bridge page of this instance can post a token. |
| After the post, the page shows a result. The source redirected to its settings page. | The callback answers JSON; a web page is a follow-up. |

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

Delivery (FU3b, the worker; no route):

- Events: `post.created` only, as in the source hook. A channel is a database ID (a lowercase UUID
  with dashes, as the list returns it).
- Scopes: none to add. Notion has no OAuth scopes; the teammate shares each database with the
  integration. Existing connections do not reconnect. Notion tokens do not expire: a 401 or 403 asks
  for a reconnect. A database that is no longer shared answers 404 (`failed`).
- `POST https://api.notion.com/v1/pages` with `Notion-Version: 2022-06-28`, `parent.database_id`, the
  title in `properties.title` (the ID of every database's title property; one line of at most 255
  characters) and `children`: one `paragraph` block of plain `rich_text` for each line of the post (at
  most 2000 characters), a divider, the author and the board. Notion takes at most 100 blocks, so the
  lines after the 96th join one last paragraph. Plain rich text is never read as markup, so nothing is
  escaped.
- The page ID (a UUID) is the link's external ID. The link URL is `url` only on
  `https://www.notion.so/`; otherwise it is empty. A 2xx answer without a page ID is `uncertain`.
- Tests: `jobs/handlers/notion-delivery.test.ts` (the worker evidence table, the plain body, the
  100-block limit, the channel rule and the link host rule).

| Difference from the source | Reason |
|---|---|
| The Notion workspace ID is not stored. | No route uses it. |
| The account label is the owner's name. The source stored no account label. | The integration summary shows `account`. |
| The body is one paragraph per line, a divider, the author and the board. The source sent a callout with an emoji, the whole post in one paragraph and a bookmark to the post. | Notion limits one text to 2000 characters; no portal URL exists for a post yet. |
| The lines after the 96th join one paragraph. | Notion refuses a page with more than 100 blocks. |
| The link URL is kept only on `https://www.notion.so/`; a 2xx without a page ID is `uncertain`. The source kept any answer. | A link comes only from the provider's own host; the page may exist. |

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
- Deadlines (`lookupLimits` in `contacts.ts`): each provider has 8 seconds for its whole chain (a token
  refresh, the lookup and its follow-up reads). The context read has 10 seconds from its start, and its
  providers run at once. At the deadline the provider's requests are aborted, and its entry is `failed`
  with "The provider did not answer in time. Try again." The read does not wait for a call that ignores
  the abort. The contact route answers this text with 502. A refresh that finished before the deadline
  is stored. A refresh that did not finish changes no stored token.
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
providers that hang (one ignores the abort) at the provider budget and at the read's deadline; HubSpot's
chained reads at the budget; a refresh that finished before the deadline (both routes) and one that did not;
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
| Segment outbound sync (segment membership pushed to Segment) | Lane G1 built the Segment connection (`saveQuillsSegmentConnection`) and the identify hook (`receiveQuillsIdentify`), because identify has no other provider. The outbound sync is not ported: RFC 0001 section 11 leaves Segment out of scope. |
| GitLab self-managed instances | The provider host would come from user input; needs the SSRF-checked outbound path and a host field. gitlab.com only. |
| `api/integrations/{type}/hooks/{kind}` kinds `interactions`, `commands`, `options` | The Slack `events` kind is built ("Agent channels"); buttons, the slash command and shortcuts are not ported. |
| `setQuillsIframeHeaders` | Web-only (#130). Lane X1 built the app sidebar routes (`api/v1/apps/**`) and the app registrations with the `app` audience: `apps/ROUTES.md`. |
| `updateTicketStatusMappingsFn`, `updatePushStatusMappingsFn` | Ticket status sync and outbound status push need ticket links to tracker issues first. |
| Ticket issue status sync | Inbound issue events update post links only. Ticket issue links are built (`support/TICKETS.md`, "Tracker issue links"). |
| `verifyQuillsIntegrationSyncReference`, recovery `reconcile`/`keep_remote`/`link_existing` | Remote item inspection per provider; search exists, inspection does not. |
| Post activity entry for an inbound status change | `recordActivity` takes a teammate actor; the change is audited as a system change. |
