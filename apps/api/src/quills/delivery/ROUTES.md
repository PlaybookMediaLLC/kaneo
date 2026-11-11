# P4 delivery: final route set and worker handlers

Source rows: `docs/quills-port/ledger/phase-P4.md` (38 capabilities). This file applies the merge rule
(`detailed-plan.md` §2) and the action mapping (§3). The format follows `detailed-plan.md` §5.

All paths are under `/quills/{workspaceId}`. Every route below is for teammates and uses `defineQuillsRoute`.
Each route module has a sibling `*.fixture.ts`, so `framework/contract.test.ts` checks every route.

## Boundary map

```
Tables and owning schema:  quills: webhooks, in_app_notifications, notification_preferences,
                           post_subscriptions, changelog_subscriptions, posts, post_votes, boards,
                           board_projects, principal, customer_identity, hook_deliveries, email_log,
                           job_queue, events. public (read only, through framework/platform-reads.ts):
                           project, workspace_member, user, project access.
Actor and workspace:       authenticated context (helper). Workers: withQuillsSystemWorkspace.
Permissions:               workspace:read + quills:<action>. No native permissions.
Persisted relationships:   board_projects (a linked board is visible only to a user who can open
                           one of its projects).
Transaction:               one scoped transaction per request. Webhook URL check and secret
                           generation run in `load`, after the permission checks, before the transaction.
External effects:          none in a request. Workers send after commit (see "Worker handlers").
```

## Webhooks

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsWebhooks` | `GET /webhooks` | manage_settings | `webhooks` | - | contract; secret never listed |
| `getQuillsWebhook` | `GET /webhooks/{webhookId}` | manage_settings | `webhooks` | - | contract; secret never returned |
| `createQuillsWebhook` | `POST /webhooks` | manage_settings | `webhooks`, `boards` | `webhook.created` | contract, rollback; SSRF; secret once |
| `updateQuillsWebhook` | `PATCH /webhooks/{webhookId}` | manage_settings | `webhooks`, `boards` | `webhook.updated` | contract, rollback |
| `deleteQuillsWebhook` | `DELETE /webhooks/{webhookId}` (soft delete) | manage_settings | `webhooks` | `webhook.deleted` | contract, rollback |
| `rotateQuillsWebhookSecret` | `POST /webhooks/{webhookId}/rotate` | manage_settings | `webhooks` | `webhook.secret_rotated` | contract, rollback; secret once |

Merged: 11 (`listQuillsWebhooks`+`fetchQuillsWebhooks`, `getQuillsWebhooks`, `createQuillsWebhooks`+`createQuillsWebhook`,
`updateQuillsWebhooks`+`updateQuillsWebhook`, `deleteQuillsWebhooks`+`deleteQuillsWebhook`,
`createQuillsWebhooksRotate`+`rotateQuillsWebhookSecret`). The `/api/v1` handler gives the shape.

- Action: `WEBHOOK_MANAGE` maps to `manage_settings`. `WEBHOOK_VIEW` maps to `read` in §3, but list and get
  also need `manage_settings`: a target URL can carry the receiver's credentials. Instance webhooks are also admin only.
- The URL must be a public HTTPS address after DNS resolution (the instance webhook check, reused through
  `framework/webhook-config.ts`). Credentials and fragments in the URL are refused.
- The secret appears once, in the create and rotate responses. It is stored encrypted with
  `NOTIFICATION_SECRET_ENCRYPTION_KEY`; without that key, create and rotate return 409.
- `events` must be catalogue types (`changeSchema`). `boardIds` (≤ 50) must be live boards of the workspace.
- At most 25 live webhooks per workspace (soft cap, as in the source).
- A workspace archive import keeps webhooks but disables them. An admin turns them on again.

## In-app notifications (the caller's own)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsNotifications` | `GET /notifications` (`limit` ≤ 100, `offset`, `unreadOnly`) | read | `in_app_notifications`, `posts`, `boards`, `board_projects` | - | contract, read-leak |
| `getQuillsNotificationUnreadCount` | `GET /notifications/unread-count` | read | `in_app_notifications` | - | contract |
| `markQuillsNotificationRead` | `POST /notifications/{notificationId}/read` | read | `in_app_notifications` | none (personal) | contract, rollback |
| `archiveQuillsNotification` | `POST /notifications/{notificationId}/archive` | read | `in_app_notifications` | none (personal) | contract, rollback |
| `markQuillsAllNotificationsRead` | `POST /notifications/read-all` | read | `in_app_notifications` | none (personal) | contract, rollback |
| `archiveQuillsReadNotifications` | `POST /notifications/archive-read` | read | `in_app_notifications` | none (personal) | contract, rollback |

Merged: 6 (`getQuillsNotifications`, `getQuillsUnreadCount`, `markQuillsNotificationAsRead`, `archiveQuillsNotification`,
`markQuillsAllNotificationsAsRead`, `archiveQuillsAllReadNotifications`).

- Action: the source has no permission (signed-in principal). These routes change only the caller's own rows,
  so `read` is enough: a viewer must be able to manage the notifications sent to them.
- A notification about a deleted post, or a post on a board the caller can no longer see, keeps its row
  but returns a neutral title and body and no post ID.
- Another teammate's notification returns 404.

## Notification preferences (the caller's own)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsNotificationPreferences` | `GET /notification-preferences` | read | `notification_preferences` | - | contract |
| `updateQuillsNotificationPreferences` | `PATCH /notification-preferences` | read | `notification_preferences` | none (personal) | contract, rollback |

Merged: 2. The matrix is an array of `{ type, inApp, email, push }` (≤ 50 types) in the API and a map in the row.
A PATCH `matrix` replaces the stored overrides, as in the source. GET returns defaults and writes nothing.

## Post subscriptions (teammate)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsPostSubscription` | `GET /posts/{postId}/subscription` | read | `post_subscriptions`, `posts`, `boards`, `board_projects` | - | contract |
| `setQuillsPostSubscription` | `PUT /posts/{postId}/subscription` (`level`: `all`, `status_only`) | read | `post_subscriptions` | none (personal) | contract, rollback |
| `deleteQuillsPostSubscription` | `DELETE /posts/{postId}/subscription` | read | `post_subscriptions` | none (personal) | contract, rollback |
| `setQuillsVoterSubscription` | `PUT /posts/{postId}/subscribers/{principalId}` (`level`: `all`, `status_only`, `none`) | update | `post_subscriptions`, `post_votes` | `post.subscription_changed` | contract, rollback |

Merged: 4 teammate capabilities. `subscribeQuillsToPost` and `updateQuillsSubscriptionLevel` merge into the PUT.
`fetchQuillsSubscriptionStatusSubscriptions`, `unsubscribeQuillsFromPost` give the GET and DELETE shapes.
Their portal audience stays separate (rule 4) and is deferred. `adminQuillsUpdateVoterSubscription`
(`POST_VOTE_ON_BEHALF`) maps to `update`.

- The post must be live and its board visible to the caller; otherwise 404.
- The voter route accepts only a principal with a vote on this post. Votes on merged source posts are not followed yet.

## Changelog subscribers (admin)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsChangelogSubscriber` | `GET /changelog-subscribers/{principalId}` | read | `changelog_subscriptions`, `principal` | - | contract |
| `setQuillsChangelogSubscriber` | `PUT /changelog-subscribers/{principalId}` | update | `changelog_subscriptions` | `changelog.subscription_changed` | contract, rollback |
| `importQuillsChangelogSubscribers` | `POST /changelog-subscribers/import` (≤ 5,000 emails) | manage_settings | `changelog_subscriptions`, `customer_identity`, `principal` | `changelog.subscribers_imported` | contract, rollback |

Merged: 3 (`getQuillsChangelogSubscriptionStatus`, `setQuillsChangelogSubscription`, `importQuillsChangelogSubscribers`).

- Action: `PEOPLE_VIEW` maps to `read`, `PEOPLE_MANAGE` to `update`. `CHANGELOG_MANAGE` is a `*_MANAGE`
  configuration key and maps to `manage_settings`: the import subscribes up to 5,000 people at once.
- The path is not `/changelog/subscribers`, so it cannot collide with P1's `/changelog/{entryId}`.
- Deviation from the source: the import never re-subscribes a person who unsubscribed, and `imported`
  counts new subscriptions only.

## Status subscribers

The source has no teammate-only status-subscriber route. All three rows are self-serve on the public status page (deferred).

## Deferred (not teammate)

P3c builds every row below; see `portal/CUSTOMER-ROUTES.md`. `api/devices` is a teammate route there.

| Source row | Audience | Reason |
|---|---|---|
| `getQuillsMyChangelogSubscription`, `subscribeQuillsToChangelog`, `unsubscribeQuillsFromChangelog` | signed-in principal on the public changelog | portal audience (P3 model) |
| `getQuillsMyStatusSubscription`, `subscribeQuillsStatus`, `unsubscribeQuillsStatus` | signed-in principal on the public status page | portal audience |
| `fetchQuillsSubscriptionStatusSubscriptions`, `subscribeQuillsToPost`, `unsubscribeQuillsFromPost`, `updateQuillsSubscriptionLevel` (portal audience) | portal (optional sign-in) | portal audience; teammate twins exist above |
| `previewQuillsUnsubscribeToken`, `processQuillsUnsubscribeToken`, `createQuillsUnsubscribe` | public, token | signed audience |
| `createQuillsDevices`, `deleteQuillsDevices` | public, customer push devices | customer audience |

Count: 23 teammate rows closed, 4 rows closed for teammates with the portal audience deferred, 11 rows deferred. Total 38.
`ledger/overrides.json` does not record these merges yet; this slice does not own `docs/quills-port/**`.

## Event catalogue additions

`webhook.created`, `webhook.updated`, `webhook.deleted`, `webhook.secret_rotated` (entity `webhook`),
`post.subscription_changed` (entity `post`), `changelog.subscription_changed` (entity `principal`),
`changelog.subscribers_imported` (entity `workspace`). No payload carries a URL, secret or email address.

## Worker handlers

The `quills.event` job now also fans out (`jobs/fanout.ts`) before its cache broadcast, so a websocket
outage cannot lose deliveries. The worker claims `quills.event` jobs first, then notification, webhook and
mail jobs, so live updates never wait behind slow receivers.
New queues: `quills.webhook`, `quills.mail`, `quills.notification` (`jobs/handlers/`). Migration
`0010_delivery_queues` adds them to `quills.runnable_workspaces`.

| Queue | Payload (Zod) | Job dedupe key | Attempts | Ledger key in `hook_deliveries` |
|---|---|---|---|---|
| `quills.webhook` | `{ eventId, webhookId }` | `{eventId}:{webhookId}` | 5 | `webhook:{eventId}:{webhookId}` |
| `quills.mail` | `{ eventId, principalId }` | `{eventId}:{principalId}` | 5 | `mail:{eventId}:{principalId}` |
| `quills.mail` (copy) | `{ eventId, messageId }` | `{eventId}:{messageId}` | 5 | `mail:{eventId}:{messageId}` |
| `quills.notification` | `{ eventId, principalId }` | `{eventId}:{principalId}` | 3 | `notification:{eventId}:{principalId}` |

- Fan-out: webhooks that list the event type, are active, existed when the event occurred and match the
  board filter. The board is the event's board entity, or the board of its post or comment; an event about
  no board passes the filter. Private comments go to no webhook. Recipients come from the `subscribers` table in
  `jobs/fanout.ts` (event type to recipients and content). Today only current teammates who can read
  Quills and see the post's board are told, never the actor. Customers wait for the portal audience.
  The table has in-app and mail entries for `post.status_changed` and `comment.created`; each mail
  carries its recipient's one-click unsubscribe link. A `direct` entry (portal invites) mails the one
  address its content names, with payload `{ eventId }` and ledger key `mail:{eventId}:direct`.
  See `portal/CUSTOMER-ROUTES.md` (P3c).
- No backlog: `recordQuillsChange` marks new events with `context.deliver`. Older events are never delivered.
- Webhook and mail: the ledger row is committed as `processing` before the external call. The outcome is
  `completed`, `failed` (certainly not delivered; a later attempt may send) or `uncertain` (no automatic
  resend). A `processing` row found by a later attempt becomes `uncertain`. The outcome commits before the
  job finishes, so a lost lease cannot cause a second send.
- Webhook outcomes: 2xx completed. 408, 429 and 5xx retry. Other HTTP codes and private targets fail at once.
  A timeout or broken connection is uncertain. Bodies are signed (`x-kaneo-signature: sha256=…` over
  `{timestamp}.{body}`); `x-kaneo-delivery` is stable across attempts.
- Mail outcomes: an SMTP 4xx reply, a provider 408 or 429, or a full send-rate queue retries. An SMTP 5xx,
  another provider 4xx or a configuration error fails. A provider 5xx or a failure without an answer is
  uncertain. The provider also receives one idempotency key per send. The address and membership are read
  at send time. Each outcome writes an `email_log` row.
- A mail content may name its own ledger key (`ledgerKey`): the CSAT request uses `mail:csat:{conversationId}`,
  one per conversation across events. A `copies` entry (a tracker's reply-all) queues one mail per copy;
  the handler checks again that the entry still names the copy. A `customerAddress` hook decides a
  customer's address at send time for mail that is not about a post (status subscribers).
- Every send carries Resend tags with its workspace and `email_log` row, signed with an HMAC
  (`framework/signed.ts#mailTags`); the log row is written with that ID, so a delivery event finds it.
- In-app: one transaction holds the ledger row, the notification and the job outcome.
- Retention removes ledger rows after the event retention period, except while their event is unpublished.
