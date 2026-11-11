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
