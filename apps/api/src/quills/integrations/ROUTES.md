# P7a integrations: final route set and worker handler

Source rows: `docs/quills-port/ledger/phase-P7.md` (84 capabilities) and two P1 rows that moved here
(`posts.ts#retryPostIntegrationSyncFn`, `posts.ts#fetchPostExternalLinksFn`). This file applies the merge
rule (`detailed-plan.md` §2) and the action mapping (§3) to the provider-neutral core and the providers
that connect with an API key or a webhook URL (decision D6). The format follows `detailed-plan.md` §5.

All paths are under `/quills/{workspaceId}`. Every route below is for teammates and uses `defineQuillsRoute`.
Each route module has a sibling `*.fixture.ts`, so `framework/contract.test.ts` checks every route.

## Boundary map

```
Tables and owning schema:  quills: integrations, integration_event_mappings,
                           integration_sync_operations, integration_sync_attempts,
                           integration_sync_actions, post_external_links, posts, post_comments,
                           post_statuses, boards, board_projects, principal, events, job_queue,
                           audit_log. public (read only, through framework/platform-reads.ts):
                           project and project access (board visibility).
Actor and workspace:       authenticated context (helper). Worker: withQuillsSystemWorkspace.
Permissions:               workspace:read + quills:<action>. No native permissions.
Persisted relationships:   board_projects (a post on a linked board is visible only to a user who
                           can open one of its projects).
Transaction:               one scoped transaction per request. URL checks, credential sealing and
                           the provider credential check run in `load`, after the permission checks,
                           before the transaction.
External effects:          none in a request. The worker delivers after commit (see "Worker handler").
```

## Integrations

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsIntegrations` | `GET /integrations` | read | `integrations` | - | contract; no credential returned |
| `listQuillsIntegrationCatalog` | `GET /integration-catalog` | read | none (static) | - | contract |
| `getQuillsIntegration` | `GET /integrations/{integrationId}` | manage_settings | `integrations`, `integration_event_mappings` | - | contract; no credential returned |
| `updateQuillsIntegration` | `PATCH /integrations/{integrationId}` (enabled, default-target event mappings ≤ 20) | manage_settings | `integrations`, `integration_event_mappings` | `integration.updated` | contract, rollback |
| `deleteQuillsIntegration` | `DELETE /integrations/{integrationId}` | manage_settings | `integrations` (cascades mappings and external links) | `integration.deleted` | contract, rollback |

Merged: 5 (`fetchQuillsIntegrationsList`, `fetchQuillsIntegrationCatalog`, `fetchQuillsIntegrationByType`,
`updateQuillsIntegration`, `deleteQuillsIntegration`).

- Action: `INTEGRATION_VIEW` maps to `read`; `INTEGRATION_MANAGE` maps to `manage_settings`. The single read
  keeps `manage_settings`, as in the source.
- Credentials and webhook URLs are stored encrypted in `integrations.secrets` with
  `NOTIFICATION_SECRET_ENCRYPTION_KEY` and are never returned. `config` holds only the display name and a
  non-secret account label (the webhook host, the Freshdesk domain or the Shortcut workspace slug).
- The single read is by ID (the list gives the ID for each type), so a foreign ID returns 404.
- `config` updates from the source are not accepted: no provider in this build has editable config.
- The catalog lists the source's provider set. `available` is true for the seven providers below; `events`
  lists the event types that a provider delivers (empty for Freshdesk and Stripe).

## Notification channels

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `addQuillsNotificationChannel` | `POST /integrations/{integrationId}/channels` | manage_settings | `integration_event_mappings`, `boards` | `integration.channel_added` | contract, rollback |
| `updateQuillsNotificationChannel` | `PATCH /integrations/{integrationId}/channels/{channel}` | manage_settings | `integration_event_mappings`, `boards` | `integration.channel_updated` | contract, rollback |
| `removeQuillsNotificationChannel` | `DELETE /integrations/{integrationId}/channels/{channel}` | manage_settings | `integration_event_mappings` | `integration.channel_removed` | contract, rollback |

Merged: 3. A channel is a set of event mappings with one target (`target_key`). Only providers whose target is
an item in the account (Shortcut groups) accept channels; a webhook provider sends to its connection and uses
the default-target mappings on `updateQuillsIntegration` (409 otherwise). `boardIds` (≤ 50) must be live boards.

## Sync operations

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsIntegrationSyncHistory` | `GET /integrations/{integrationId}/syncs` (`filter`, `cursor`, `limit` ≤ 50) | read | `integration_sync_operations`, `posts`, `post_comments`, `boards` | - | contract, read-leak |
| `inspectQuillsIntegrationSync` | `GET /integration-syncs/{syncId}` (attempts ≤ 50) | read | `integration_sync_operations`, `integration_sync_attempts` | - | contract, read-leak |
| `recoverQuillsIntegrationSync` | `POST /integration-syncs/{syncId}/actions` (`retry` or `cancel`, `version`, `idempotencyKey`) | manage_settings | `integration_sync_operations`, `integration_sync_actions` | `integration_sync.recovered` | contract, rollback; uncertain never retried |

Merged: 3 (`listQuillsIntegrationSyncHistory`, `inspectQuillsIntegrationSync`, `recoverQuillsIntegrationSync`).

- `retry` is offered only for `failed` and `auth_required` (certainly not delivered), and only while the
  connection the sync was made for is active and not replaced. A paused or reconnected connection leaves
  `cancel`. An `uncertain` operation is never retried: `cancel` only records that a teammate checked it.
- A `running` operation whose lease expired (its attempt stopped after the claim, for example on the job's
  last attempt, so no job returns) is shown and handled as `uncertain`.
- A repeated `idempotencyKey` returns the current state and changes nothing; the same key for another action
  or operation returns 409. A stale `version` returns 409.
- The request changes only the operation row. The worker enqueues the delivery when it processes the
  `integration_sync.recovered` event, so nothing is sent from an uncommitted request.
- A post or comment source on a board that the caller cannot see is listed without its ID and actions;
  inspecting it returns 404.

## External links

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsPostExternalLinks` | `GET /posts/{postId}/external-links` | read | `post_external_links`, `posts`, `boards` | - | contract, read-leak |
| `retryQuillsPostIntegrationSync` | `POST /posts/{postId}/integration-sync` | manage_settings | `posts`, `boards` | `post.integration_sync_requested` | contract, rollback |

Merged: 2 (`fetchQuillsPostExternalLinks` from P1, `retryQuillsPostIntegrationSync` from P1).

- The post must be visible to the caller (board-project rule). A resync needs a published post.
- A resync queues the post's create delivery for each mapped destination that has none, and restarts a create
  of the same installation that was cancelled before dispatch (its post was unavailable, or the connection was
  paused or remapped). A sent, uncertain or teammate-cancelled create keeps its state; use sync recovery.

## Providers (API key or webhook URL, no OAuth)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `saveQuillsMakeWebhook` | `PUT /integrations/make/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; host allowlist |
| `saveQuillsN8nWebhook` | `PUT /integrations/n8n/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; SSRF |
| `saveQuillsZapierWebhook` | `PUT /integrations/zapier/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; host allowlist |
| `saveQuillsNtfy` | `PUT /integrations/ntfy/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; SSRF |
| `saveQuillsFreshdeskKey` | `PUT /integrations/freshdesk/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; key check |
| `saveQuillsShortcutToken` | `PUT /integrations/shortcut/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; key check |
| `saveQuillsStripeKey` | `PUT /integrations/stripe/connection` | manage_settings | `integrations` | `integration.connected` | contract, rollback; key check |

Merged: 7. A save creates the connection or replaces it (a reconnect starts a new installation, so queued
deliveries of the old one are cancelled). Event mappings and channels stay.

- Make (`*.make.com`, `*.integromat.com`) and Zapier (`hooks.zapier.com`) accept HTTPS URLs on their own
  hosts only. n8n and ntfy accept a URL that resolves to a public address (the instance webhook check).
  Credentials and fragments in a URL are refused. ntfy needs a valid topic and takes an optional token.
- The source sends a test message to a webhook URL when it is saved. This port does not: like a Quills
  webhook, the first delivery shows the result in the sync history, and a request sends nothing.
- Freshdesk, Shortcut and Stripe check the key with one GET to the provider's fixed API host (10 s timeout,
  no redirect, no retry), as the source does. A rejected key returns 400 and an unreachable provider 502.
  Provider response text is never returned. Keys and tokens must be printable ASCII (400 otherwise).
- Without `NOTIFICATION_SECRET_ENCRYPTION_KEY`, a save returns 409 before any outbound call.
- `framework/integration-config.ts` gives route modules only checks: sealing, the webhook URL check and the
  GET credential check. The worker's Shortcut POST lives in `jobs/handlers/integration-send.ts`.

## Worker handler

Integration deliveries run on the `quills.webhook` queue with the payload `{ operationId }` (see
"Required migration"). `jobs/worker.ts` sends a job to `runIntegrationJob` or `runWebhookJob` by its payload.

| Step | Behavior |
|---|---|
| Fan-out | After the `quills.event` job's webhook fan-out, `fanOutIntegrations` writes one `integration_sync_operations` row per active integration, enabled mapping and target, and enqueues its job. Only events with the delivery mark, and only for connections made before the event. The operation key deduplicates a rerun; a create (`post.created`, resync) has one operation per post and destination. Private comments and other boards (mapping filter) are skipped. The row stores the trigger and status in `destination` (no event-retention dependency) and `source_record_id`, so the shared purge trigger cancels queued deliveries and clears remote data when a post or comment is deleted or unpublished. |
| Claim | Re-reads the live integration (active, same installation), mapping, board filter and source (live and published; a comment's post too). A changed one cancels the operation. Then it records an attempt and sets `running`, `dispatched_at` and a 5-minute lease before the external call. |
| Outcome | `succeeded`; `retry_wait` (HTTP 408, 429, webhook 5xx, DNS failure) with job backoff, `failed` on the job's last attempt; `failed` (other 4xx, non-public destination); `auth_required` (401, 403, unreadable credentials); `uncertain` (timeout, broken connection, Shortcut 5xx, a create without an ID). |
| Uncertain | Never sent again. A job that finds its operation still `running` (an earlier attempt stopped after its claim) marks it `uncertain`; with no job left, the routes show it as `uncertain`. |
| Links | A Shortcut story writes a `post_external_links` row (origin `event`), unless the connection was deleted during the call; the operation keeps the remote ID either way. |
| Health | Success sets `last_outbound_at` and clears the error; a failure sets a mapped `last_error`. |

Payloads: Make, n8n and Zapier get the source's generic JSON (`event`, `timestamp`, `post`, `status_change`,
`comment`) without author email or portal URLs; ntfy gets a push message; Shortcut gets a story for
`post.created`. Each request has `x-kaneo-delivery: <operationId>` except ntfy. A deletion notice is not
delivered: the purge trigger stops deliveries about a deleted post, as in the source.

A workspace archive import pauses imported integrations, as it disables imported webhooks.
Sync operations are kept (a create's key prevents a duplicate remote item); attempts are small. The source
prunes attempts and results of finished operations after 90 days; that pruning is a follow-up.

## Required migrations (not generated in this wave)

1. `quills.runnable_workspaces` (migration `0010_delivery_queues.sql`) lists the queues that make a workspace
   runnable. A `quills.integration` queue needs a forward migration that adds it there, and an entry in
   `QUILLS_QUEUES` after `quills.notification`. Until then the handler uses `quills.webhook`: the same
   outbound-HTTP class, lease, retry and retention rules, a strict payload per handler and a distinct
   deduplication key prefix (`integration:`). Cost: the claim order puts the webhook queue before mail and
   notifications, so a backlog of slow integration deliveries (up to a 10-second timeout each) delays them.
2. The sync history reads `integration_id` ordered by `created_at, id`. No index covers it
   (`integration_sync_history_idx` starts with `provider`), so a page sorts every row of the integration.
   Add an index on `(workspace_id, integration_id, created_at, id)`.

## Deferred or not implemented

P7b (`ROUTES-OAUTH.md`) built the platform credentials, `searchQuillsExternalItems`,
`fetchQuillsIntegrationDestinations` (as a post-commit provider call), the GitHub, GitLab, Slack and
Discord OAuth providers, the OAuth connect and callback routes and the inbound status webhook.
The rows below keep their P7a reasons; `ROUTES-OAUTH.md` lists what is still deferred.

| Source rows | Reason |
|---|---|
| `saveQuillsPlatformCredentials`, `fetchQuillsPlatformCredentialsMasked`, `deleteQuillsPlatformCredentials` | No provider in this build declares platform (OAuth app) credentials, so no request can succeed. They come with the first OAuth provider. |
| `searchQuillsExternalItems` | None of the seven providers implements remote item search. |
| `fetchQuillsIntegrationDestinations`, `fetchQuillsShortcutProjects` | The outbound read needs the stored token. Inside the request transaction it would hold a pooled connection during network I/O; a post-commit step needs a framework change. Shortcut stories work without a group, and a channel accepts a known group ID. |
| `verifyQuillsIntegrationSyncReference`; recovery actions `reconcile`, `keep_remote`, `link_existing` | Need remote item inspection, which none of the seven providers has. |
| Ticket sync retry | Ticket issue links are built (`support/TICKETS.md`); a failed ticket create is retried through sync recovery. |
| Freshdesk and Stripe customer context | The source has no event delivery for them; the context lookup belongs to the people and support views. |
| Shortcut inbound status webhook, every `api/integrations/{type}/{webhook,hooks,identify}` row | Inbound provider webhooks need a signed audience. |
| Every OAuth provider and `oauth/{integration}/**`, `oauth/connector/callback`, `*ConnectUrl` rows | OAuth connect and callback need a public, state-bound audience. |
| `api/v1/apps/**`, `apps*`, `setQuillsIframeHeaders` | App sidebar routes need a signed audience. |
| `saveQuillsSegmentConnection` and other provider rows | Not in this slice's provider set. |
| Integration service principal | The source creates one per connection for inbound actions; outbound delivery does not need it. |
