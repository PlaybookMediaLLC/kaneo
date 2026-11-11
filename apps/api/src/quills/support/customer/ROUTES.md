# P5c customer support: widget and portal routes, and support delivery

Source rows: `docs/quills-port/ledger/phase-P5.md` (widget, portal and public audiences of the
conversations and tickets slices). The merge rule and the action mapping follow
`detailed-plan.md` §2 and §3. Non-teammate routes are under `/quills-public/{workspace}`;
teammate routes stay under `/quills/{workspaceId}`. Every route uses `defineQuillsRoute` and has a
fixture in `index.fixture.ts`, so `framework/contract.test.ts` checks it. Feature tests:
`customer.test.ts` (real PostgreSQL, workspaces A and B, a loopback SMTP sink).

## Boundary map

```
Tables and owning schema:  quills: conversations, conversation_messages, conversation_message_mentions,
                           tickets, ticket_statuses, ticket_types, ticket_conversations,
                           ticket_subscriptions, ticket_activity, principal, customer_identity,
                           settings, kv_store (idempotency receipts, typing markers, CSAT tokens),
                           rate_bucket, in_app_notifications, unsubscribe_tokens, notification_preferences,
                           channel_accounts and email_sending_domains (read), boards, posts,
                           post_subscriptions, segments, user_segments, events, audit_log,
                           job_queue, hook_deliveries, email_log.
                           public: none in a request. The mail worker reads public.user and
                           public.workspace_member through framework/platform-reads.ts#portalAccount.
Actor and workspace:       widget: the widget session Bearer (framework/audience.ts). portal: the
                           Kaneo session; the customer profile is created on the first write
                           (ensureCustomer). public: no identity; the CSAT token is the credential.
                           teammate (typing): authenticated context.
Permissions:               widget, portal and public: none of Kaneo's. Ownership authorizes:
                           conversations.visitor_principal_id and tickets.requester_principal_id
                           must be the caller's own principal. Teammate typing: quills:read/update.
Persisted relationships:   conversations.visitor_principal_id, tickets.requester_principal_id,
                           ticket_conversations (the ticket's paired conversation),
                           customer_identity.kaneo_user_id (the portal account for the socket and mail).
Transaction:               one scoped transaction per request. The idempotency receipt, the message
                           and the outbox event commit together or not at all.
External effects:          none in a request. Workers send after commit: customer reply mail, mention
                           mail, customer post mail, in-app notices, and the user-socket invalidation.
Completion checks:         authenticated endpoint, tenant/object access, mutation, read, worker.
```

## Switches

- Widget routes: the widget session already needs the widget on. Conversation routes also need the
  messenger tab, ticket routes the tickets tab (`settings/widget.ts#readConfig` defaults). Otherwise 404.
- Portal routes: 404 while `portal_config.enabled` is not true, 403 when the private-portal gate
  denies the caller (`portal/gate.ts#requirePortalAccess`), 404 while the portal's support switch
  (`portal_config.support.enabled`, `settings/portal.ts`) is false.
- Public messenger reads: 404 while the widget is off. The CSAT link reads no switch: like an
  unsubscribe link, a link in a sent mail must work, also in an email-only workspace with the
  portal off (`portal/feedback/feedback.test.ts` lists both CSAT routes with the unsubscribe routes).

## Conversations (widget: `/widget/...`, portal: `/support/...`)

| operationId (widget / portal) | Route | Action | Event | Tests |
|---|---|---|---|---|
| `listQuillsWidgetConversations` / `listQuillsMyConversations` | `GET {base}/conversations` (`cursor`, `limit` ≤ 50) | read | - | contract, isolation |
| `getQuillsWidgetUnreadCount` / `getQuillsMyUnreadCount` | `GET {base}/unread` (`unreadCount`: team messages) | read | - | contract, watermark |
| `startQuillsWidgetConversation` / `startQuillsMyConversation` | `POST {base}/conversations` (`content` ≤ 10000, `idempotencyKey`; 20 per 10 min) | create | `conversation.created` (none on a replay) | contract, rollback |
| `getQuillsWidgetConversation` / `getQuillsMyConversation` | `GET {base}/conversations/{conversationId}` (latest 30, `teamTyping`) | read | - | contract, isolation, notes |
| `listQuillsWidgetConversationMessages` / `listQuillsMyConversationMessages` | `GET {base}/conversations/{conversationId}/messages` (`before`, `after` with a 30-second overlap, `limit` ≤ 100) | read | - | contract, isolation, notes |
| `sendQuillsWidgetConversationMessage` / `sendQuillsMyConversationMessage` | `POST {base}/conversations/{conversationId}/messages` (60 per 10 min) | update | `message.created` (none on a replay) | contract, rollback, idempotency, concurrency |
| `markQuillsWidgetConversationRead` / `markQuillsMyConversationRead` | `PUT {base}/conversations/{conversationId}/read` (`throughMessageId`) | update | none (view state) | contract, watermark |
| `sendQuillsWidgetConversationTyping` / `sendQuillsMyConversationTyping` | `POST {base}/conversations/{conversationId}/typing` (120 per 10 min) | update | none (lapses in 8 s) | contract |
| `submitQuillsWidgetCsat` / `submitQuillsCsat` | `POST {base}/conversations/{conversationId}/csat` (`rating` 1-5, `comment` ≤ 2000) | update | `conversation.csat_submitted` when something changed | contract, rollback |

Merged: `widgetQuillsGetMyConversations` + `getMyConversationsFn`; `widgetQuillsGetMyConversation` +
`getMyConversationFn`; `widgetQuillsListConversationMessages`; `widgetQuillsSendConversationMessage`
+ `sendConversationMessageFn` (split into start and send); `widgetQuillsMarkConversationRead`;
`widgetQuillsGetMessengerUnread`; `widgetQuillsSendConversationTyping`; `widgetQuillsSubmitCsat` +
`submitQuillsCsat`. The portal twins are the session branch of the same source functions.

- A message response never carries an internal note, a team-only notice, a deleted message, a
  teammate principal ID or an email. A teammate shows as `{ name, avatarUrl }`. `embeds` lists the
  records a teammate shared into the thread (a shared post has empty text and one embed).
- Idempotency keeps its own receipt (`model.ts#claimReceipt`) instead of
  `portal/feedback/receipts.ts`: RFC 0002 proposes at least 7 days and no silent new write for an
  expired key, where the feedback receipt keeps 24 hours and frees an expired key.
- Idempotency (RFC 0002): a receipt in `kv_store` under `(caller principal, scope, key)`, where the
  scope is `new` or the conversation. The primary key serializes a concurrent duplicate behind
  the first request; it then returns the first result with `replayed: true`. Other text with the
  same key, or a key whose 7-day receipt has expired, is 409. The receipt rolls back with the write.
- The read watermark (`visitor_last_read_at`) only moves forward and uses the stored microsecond
  time of the message. Unread counts team (`agent`) messages after it.
- `created_at` is the writer's transaction start, so a message can commit after a later one.
  `after` therefore also returns the 30 seconds before its cursor (merge by message ID). The
  unread count and the read watermark use the same times: a reply whose transaction started before
  the visitor's message but committed after it can count as read (known limit, as in the source).
- A visitor message reopens a closed or snoozed conversation, except one ended as spam.
- CSAT keeps the source's rule: the first score and its time stay; a comment can be added once.

## Requester tickets (widget: `/widget/...`, portal: `/support/...`)

| operationId (widget / portal) | Route | Action | Event | Tests |
|---|---|---|---|---|
| `getQuillsWidgetMyTickets` / `getQuillsMyTickets` | `GET {base}/tickets` (`cursor`, `limit` ≤ 50) | read | - | contract, isolation |
| `createQuillsWidgetMyTicket` / `createQuillsMyTicket` | `POST {base}/tickets` (10 per 10 min) | create | `ticket.created` | contract, rollback |
| `getQuillsWidgetMyTicketForm` / `getQuillsMyTicketForm` | `GET {base}/ticket-form` | read | - | contract |
| `getQuillsWidgetMyTicketStageLabels` / `getQuillsMyTicketStageLabels` | `GET {base}/ticket-stage-labels` | read | - | contract |
| `getQuillsWidgetMyTicketWatchStatus` / `getQuillsMyTicketWatchStatus` | `GET {base}/tickets/{ticketId}/watch` | read | - | contract |
| `watchQuillsWidgetMyTicket` / `watchQuillsMyTicket` | `PUT {base}/tickets/{ticketId}/watch` | update | none (personal) | contract, isolation |
| `unwatchQuillsWidgetMyTicket` / `unwatchQuillsMyTicket` | `DELETE {base}/tickets/{ticketId}/watch` | update | none (personal) | contract |
| `getQuillsWidgetConversationLinkedTicket` / `getQuillsConversationLinkedTicket` | `GET {base}/conversations/{conversationId}/ticket` | read | - | contract, isolation |

Merged: the nine `widgetQuills*` ticket rows and `createQuillsMyTicket`, `getQuillsMyTickets`,
`getQuillsMyTicketForm`, `getQuillsMyTicketStageLabels`, `getQuillsMyTicketWatchStatus`,
`watchQuillsMyTicket`, `unwatchQuillsMyTicket`, `getQuillsConversationLinkedTicket`.

- A requester sees only live customer tickets where they are the requester. A status without a
  public stage shows `stage: null`, so an internal status name never reaches a requester.
- Create: the default status (409 when none), the given or default intake type (customer category,
  intake-visible), answers checked against the customer-visible fields only, a paired conversation
  that carries the thread, the description as the first visitor message, and a requester watch.
  An anonymous visitor without a contact email gets 409.

## Public

| operationId | Route | Audience | Action | Event | Tests |
|---|---|---|---|---|---|
| `validateQuillsCsatEmailToken` | `GET /support/csat-email?token=` | public | read | - | contract, never spends, other workspace |
| `recordQuillsCsatViaToken` | `POST /support/csat-email` (20 per 10 min) | public | update | `conversation.csat_submitted` | contract, rollback, single use |
| `getQuillsWidgetPresence` | `GET /widget/presence` | public | read | - | contract, office-hours unit test |
| `listQuillsWidgetTeamAvatars` | `GET /widget/team-avatars` (3) | public | read | - | contract |

- CSAT token: the format of `portal/unsubscribe-token.ts` (32 random bytes, SHA-256 hash stored,
  30 days), kept in `kv_store` because `unsubscribe_tokens` has no conversation column. The token
  holder must still be the conversation's visitor. A POST spends it; a GET only checks it.
  `mintCsatToken` is the entry point for the mail that carries the rating links. The GET carries
  the token in its query, as the unsubscribe preview does, so access logs can hold a live token.
- Presence: `withinOfficeHours` reads the office hours of `support/support-settings.ts` in their
  timezone, with overnight intervals and holidays. `agentsOnline` is null: Kaneo keeps no live
  agent presence.

## Teammate additions

| operationId | Route | Action | Event | Tests |
|---|---|---|---|---|
| `getQuillsConversationTyping` | `GET /conversations/{conversationId}/typing` | read | - | contract |
| `sendQuillsConversationTyping` | `PUT /conversations/{conversationId}/typing` | update | none (lapses in 8 s) | contract |

## The message stream

- Portal customers: the existing Kaneo user WebSocket (`/api/ws/user`). The worker's event delivery
  (`jobs/worker.ts#deliverQuillsChange`) now also calls `jobs/handlers/customer-stream.ts`, which
  sends `{ type: "QUILLS_CUSTOMER_CHANGED", workspaceId, eventId, conversationId?, ticketId? }` to
  the Kaneo account that owns the conversation or ticket. The session middleware authorizes the
  socket on connect, the socket closes when the session ends, and a reconnect with a revoked session
  is refused. Before each send the worker checks again that the customer is not blocked, the account
  is not banned, and the portal, its private gate and its support switch still admit the customer.
  The message carries IDs only; the client fetches through the routes above. Note events never
  produce it, and a message event for an internal note is dropped. "Track as feedback"
  (`post.created`, `post.voted` with `payload.messageId`) also produces it. Redis stays optional:
  the existing adapter fans out between instances.
- Widget visitors: no Kaneo account, so no user socket. The widget polls
  `GET .../messages?after={lastMessageId}` and `GET /widget/unread`.
- Not built: the stream token (`widgetQuillsMintConversationStreamToken`) and the SSE route
  (`listQuillsChatStream`). A token needs a transport that accepts it: a new WebSocket upgrade
  route lives in `src/index.ts` (out of scope), and an SSE route under `/quills-public` fails the
  contract's `registered` check and the boundary import rules. Framework change needed: an
  audience-authorized upgrade route mounted from `quills/public.ts`.

## Delivery (`jobs/handlers/support-mail.ts`)

| Event | Who | How | Read again at send time |
|---|---|---|---|
| `message.created` | the customer of an email conversation | direct mail, `ConversationReplyEmail`, ledger `mail:{eventId}:direct` | the message is a live agent message with text, not internal; the conversation channel is `email`; the address and the visitor's block |
| `ticket.replied` | the requester (email pair, `payload.messageId`) and watching teammates | direct mail as above; in-app `ticket_watch` | as above; watcher mute |
| `ticket.status_changed`, `ticket.note_added` | watching teammates | in-app `ticket_watch` (title and ticket title, never note text) | watcher mute |
| `message.note_created` | mentioned teammates | in-app `note_mention` and `NoteMentionEmail` | the note is live |
| `post.status_changed`, `comment.created` | customer subscribers (new) | mail with the P3c unsubscribe link | verified account address, the portal or widget switch, the private-portal gate, the public post visibility rule, the comment visibility rule (never a private or held comment), the mail preference |

- One mail per message: one event per message, a deterministic job key and the P4 ledger. A
  rolled-back write records no event, so nothing is sent (the contract `rollback` check).
- The From address is a verified support sending address of the conversation (its channel account,
  else its team's support address) or the platform sender. `sendingIdentity` is the only place a
  `SendingIdentity` is minted.
- Fan-out sends no per-watcher mail for a direct entry, and mails customer subscribers only for
  entries with `customers: true`. A direct entry may decide at fan-out whether the event has mail
  (`direct` as a function), so a messenger or visitor message queues no mail job; the mail
  handler still reads everything again at send time.

## Widget RFC differences (adapter notes)

| RFC | Here |
|---|---|
| `/api/widget/conversations...` | `/quills-public/{workspace}/widget/conversations...` |
| `Idempotency-Key` header | `idempotencyKey` body field (the framework gives handlers no headers) |
| `revision` on every result | none: message IDs order the thread; `after` resynchronizes |
| `GET /conversations/:id` with an opaque cursor | latest 30 with `hasMore`; older with `/messages?before=` |
| `PUT /read` returns the watermark and revision | returns `{ unreadCount, changed }` |
| `Conversation.title`, `messages[].body`, `author` string, `sentAt` | `subject`/`preview`, `content`, `author.name`, `createdAt` |
| `GET /api/widget/bootstrap` | not built; the adapter composes the list routes |
| unread count result | `{ unreadCount }`, team messages after the watermark |
| polling resynchronization | `after` overlaps the 30 seconds before its cursor; merge by message ID |
| attachments on send, attachment URLs | not accepted; responses carry `{ name, contentType, size }` only (RFC 0004 not built) |
| 413 for an over-long body, 429 with `Retry-After`, 503 | 400 for an over-long body; 429 without `Retry-After`; no 503 |
| expired key: tombstone or explicit error | 409 while the receipt row exists; after the kv sweeper removes it, the key is a new write |
| realtime through `publishEvent()` and the WebSocket | portal customers: user socket invalidation; widget visitors: polling |
| `articleId` context on a conversation | not supported |

## Not built, or built in part

| Item | Status | Reason |
|---|---|---|
| Stream token and SSE stream | not built | See "The message stream". |
| Contact email change (`confirmQuillsEmailChange`, `getQuillsEmailChangeState`, `requestQuillsEmailChange`, `sendQuillsCurrentAddressCode`) | built for anonymous visitors | `widget/contact-email.ts` (`/widget/contact-email...`). A portal customer's address is the Kaneo account email, which Kaneo's auth owns; an identified widget visitor's comes from the host's signed token (both 403). Codes are derived from the widget secret and the pending request (`framework/signed.ts#contactEmailCode`), never stored; 15 minutes, 5 tries, single use, 5 code mails per visitor and hour plus the per-client rate limit. The worker mails them (`user.contact_email_code_requested`). |
| Status incident subscriber mail and its token reconciliation | built | `jobs/handlers/status-mail.ts`; one unsubscribe mint (`portal/unsubscribe-token.ts#mintUnsubscribeToken`). See `content/public/ROUTES.md`. |
| The mail that carries CSAT rating links | built | `conversation.status_changed` to closed on an email conversation (the source's close mail): one `CsatRequestEmail` per conversation (ledger key `mail:csat:{conversationId}`, and not when the mail log already holds one), with five links from `mintCsatToken` to the portal rating page `/portal/{workspace}/csat?token=&rating=` (as in the source; apps/web has no such page yet, so the links wait for it). Not for spam, a rated conversation, or a close by the customer. A bulk close (`conversation.bulk_updated`) names no conversation and sends none. |
| Delivery to the requesters of tickets that a tracker links | built | The one tracker event fans out at delivery: reply-all copies carry `repliedAllFromMessageId`, so the mail entry queues one mail per copy on an email pair (`mail:{eventId}:{messageId}`), and the socket tells each linked requester once. A status move tells the requesters of linked tickets now in the new status. |
| Mail for an embed-only reply ("share post", "track as feedback") | not built | The message has no text; the mail would be empty. The customer sees the embed in the thread, and portal customers get the socket invalidation. |
| Reply-To and threading headers on customer reply mail | built | Reply-To is the conversation's signed reply address (`framework/signed.ts#replyAddress`); Message-ID is `<{messageId}@{inbound domain}>`; In-Reply-To and References name up to 20 earlier mails of the thread. |
| Teammate mail for a new visitor message | not built | The source mails an offline assignee; Kaneo has no presence to decide "offline". Teammates get the `QUILLS_CHANGED` invalidation. |
| Watcher mail | not built | The ticket templates are requester-facing; watchers get in-app notices. |
| Presence `agentsOnline`, `nextOpenAt` | part | No live presence store; office hours only. |
| Conversation participants | not built | Only the visitor reads a conversation; the source also lets added participants read it. |
| Linked ticket with tickets off | differs | 404, where the source returns null. |

## Edits to existing files

- `quills/events.ts`: event types `conversation.created`, `conversation.csat_submitted`.
- `quills/public.ts`: mounts `support/customer/portal.ts` and `widget/support/index.ts`.
- `quills/index.ts`: mounts `support/customer/typing.ts`.
- `quills/portal/index.fixture.ts`: exports `../support/customer/index.fixture`, so the contract suite and
  the portal-off test of `portal/feedback/feedback.test.ts` find the fixtures.
- `quills/portal/feedback/feedback.test.ts`: the two CSAT link routes join the always-on unsubscribe routes.
- `quills/settings/widget.ts`: exports `readConfig` (the widget tab switches).
- `quills/support/message-model.ts`: exports `embedsOf`.
- `quills/support/support-settings.ts`: exports `officeHoursSchema`.
- `quills/framework/platform-reads.ts`: `portalAccount` (a worker read of the account behind a portal customer).
- `quills/jobs/fanout.ts`: the support entries, the `customers` flag, customer mail jobs, no per-watcher mail for a direct entry, `direct` as a fan-out predicate, `commentId` on a comment mail.
- `quills/jobs/handlers/mail.ts`: a customer recipient goes through `customerPostAddress` (with the comment).
- `quills/jobs/worker.ts`: `deliverQuillsChange` also calls `deliverCustomerChange`.

## Required migrations

None. Receipts, typing markers and CSAT tokens use `kv_store` (expiring rows); the reads use the
existing `conversations_visitor_principal_idx` and ticket indexes.
