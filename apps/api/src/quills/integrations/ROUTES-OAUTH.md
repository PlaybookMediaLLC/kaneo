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

## Deferred or not implemented

| Source rows | Reason |
|---|---|
| Microsoft Teams | Graph channel messages need tenant consent and a bot registration; not small. By demand (D6). |
| Asana, Azure DevOps, ClickUp, HubSpot, Intercom, Jira, Linear, Monday, Notion, Salesforce, Segment, Trello, Zendesk | Decision D6: they come by demand. |
| GitLab self-managed instances | The provider host would come from user input; needs the SSRF-checked outbound path and a host field. gitlab.com only. |
| `api/integrations/{type}/hooks/{kind}` (Slack interactivity, app hooks) | Their consumers are the Slack assistant and message shortcuts (P8 assistant slice). |
| `api/integrations/{type}/identify` | User-sync providers (Segment and similar) are not in this provider set. |
| `api/v1/apps/**`, `apps*`, `setQuillsIframeHeaders` | The app sidebar authenticates a third-party app with its own token and needs iframe headers; neither fits the signed nor the teammate audience without a new app-token model. |
| `oauth/connector/callback` | Assistant connectors (P8 assistant slice). |
| `updateTicketStatusMappingsFn`, `updatePushStatusMappingsFn` | Ticket status sync and outbound status push need ticket links to tracker issues first. |
| `fetchQuillsTicketExternalLinks`, `linkQuillsTicketIssue`, `createQuillsTicketIssue`, `unlinkQuillsTicketIssue` | Not built in this wave (time). The table `ticket_external_links` and ticket visibility from `support/` are ready for them. |
| `verifyQuillsIntegrationSyncReference`, recovery `reconcile`/`keep_remote`/`link_existing` | Remote item inspection per provider; search exists, inspection does not. |
| Post activity entry for an inbound status change | `recordActivity` takes a teammate actor; the change is audited as a system change. |
| GitHub inbox channel (issue comments into conversations) | The source's second webhook consumer; needs the GitHub channel account flow. |
