# P5b support: tickets, macros, SLA, support settings and email channel (teammate routes)

Source rows: `docs/quills-port/ledger/phase-P5.md`. This file applies the merge rule
(`detailed-plan.md` §2) and the action mapping (§3). The format follows `detailed-plan.md` §5.

All paths are under `/quills/{workspaceId}`. Every route below is for teammates and uses `defineQuillsRoute`.
Each route module has a sibling `*.fixture.ts`, so `framework/contract.test.ts` checks every route.
The router is `support/tickets-router.ts`.

## Boundary map

```
Tables and owning schema:  quills: tickets, ticket_statuses, ticket_types, ticket_activity,
                           ticket_subscriptions, ticket_links, ticket_conversations,
                           conversation_messages, conversations, conversation_tags,
                           conversation_tag_assignments, macros, sla_policies, sla_events,
                           office_hours_schedules, workflows (read), settings, principal, teams,
                           companies, channel_accounts, email_sending_domains, email_log,
                           audit_log, events, job_queue.
                           public (read only, through framework/platform-reads.ts): workspace_member.
Actor and workspace:       authenticated context (helper).
Permissions:               workspace:read + quills:<action>. No native permissions.
Persisted relationships:   ticket_conversations (customer pair 1:1, provenance), ticket_links
                           (one tracker per ticket). Assignees: principal.kaneo_user_id must be a
                           current workspace member (memberUserIds in `load`).
Transaction:               one scoped transaction per request; the member list is read in `load`.
External effects:          none in a request. Mutations write audit, event and job rows only.
                           No mail, webhook, WebSocket, DNS or provider call.
Completion checks:         authenticated endpoint, tenant/object access, mutation or batch,
                           read/search, schema or ownership constraint (ticket numbers).
```

Ticket numbers come from the existing allocator: the `quills.tickets_number_seq` sequence behind
`tickets.number` (bigserial), with the `tickets_number_uq (workspace_id, number)` unique index.
Routes never write `number`. Transfer imports keep their numbers and advance the sequence
(`quills.advance_imported_sequences`). `tickets.test.ts` creates 20 tickets in parallel in two
workspaces through `quills_runtime` and checks that the numbers are distinct, and that the database
refuses a reused number. `nextval` cannot hand out a number twice, so the test guards the sequence
grant, the unique index and the "routes never write `number`" rule, not a lock.

Locking: a route that changes several tickets locks them in one ID-ordered statement
(`lockTickets`), and a status move or reply-all on a tracker includes the tickets it tracks in that
statement, so two such requests cannot deadlock. A ticket moving to a status takes a share lock on
the status, so it waits for a concurrent status delete and then gets 404.

## Tickets

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsTickets` | `GET /tickets` (type, ticketTypeId, statusCategory, stage, priority, assignee `me`/`unassigned`/ID, teamId, requesterPrincipalId, companyId, search, sort, cursor; `limit` ≤ 100) | read | `tickets`, `ticket_statuses`, `ticket_types`, `principal`, `teams`, `companies`, `settings` | - | contract, read-leak, page-bounds |
| `getQuillsTicket` | `GET /tickets/{ticketId}` | read | same | - | contract, two-workspace |
| `createQuillsTicket` | `POST /tickets` | create | `tickets`, `ticket_types`, `ticket_conversations`, `conversations`, `conversation_messages`, `ticket_subscriptions`, `ticket_activity` | `ticket.created` | contract, rollback, concurrency |
| `setQuillsTicketStatus` | `POST /tickets/{ticketId}/status` | update | `tickets`, `ticket_statuses`, `ticket_activity`, `ticket_links`, `conversation_messages` | `ticket.status_changed` | contract, rollback, feature |
| `setQuillsTicketPriority` | `POST /tickets/{ticketId}/priority` | update | `tickets`, `ticket_activity` | `ticket.priority_changed` | contract, rollback |
| `assignQuillsTicket` | `POST /tickets/{ticketId}/assign` (`me`, null clears) | update | `tickets`, `principal`, `teams`, `ticket_subscriptions`, `ticket_activity` | `ticket.assigned` | contract, rollback |
| `bulkUpdateQuillsTickets` | `POST /tickets/bulk` (≤ 100 IDs, all-or-nothing) | update | as the single routes | `ticket.bulk_updated` | contract, rollback, batch |

Merged: 14. `listQuillsTickets` = `listQuillsTicketsIndex` + `listQuillsTickets` + `searchQuillsTickets`.
`getQuillsTicket` = `getQuillsTickets` + `getQuillsTicket`. `createQuillsTicket` = `createQuillsTickets` +
`createQuillsTicket`. Status, priority and assign each merge the `/api/v1` POST (`createQuillsTicketsStatus`,
`createQuillsTicketsPriority`, `createQuillsTicketsAssign`) with the server function. `bulkQuillsUpdateTickets`.

- Action: `TICKET_VIEW` → read, `TICKET_CREATE` → create, `TICKET_ASSIGN`/`TICKET_SET_STATUS` → update.
- Every ID is checked in this workspace: ticket type (live), requester, company, source conversation,
  assignee (current member), team (live), status (live), cursor ticket.

## Ticket thread and activity

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsTicketMessages` | `GET /tickets/{ticketId}/messages` (`before`, `includeInternal`, `limit` ≤ 100) | read | `conversation_messages`, `ticket_conversations`, `principal` | - | contract, read-leak, feature |
| `replyQuillsTicket` | `POST /tickets/{ticketId}/reply` (`replyAll` on a tracker) | update | `conversation_messages`, `conversations`, `tickets`, `ticket_subscriptions`, `ticket_links` | `ticket.replied` | contract, rollback, feature |
| `addQuillsTicketNote` | `POST /tickets/{ticketId}/note` (`shareWithConversation`) | update | `conversation_messages`, `tickets`, `ticket_conversations` | `ticket.note_added` | contract, rollback |
| `listQuillsTicketActivity` | `GET /tickets/{ticketId}/activity` (≤ 200) | read | `ticket_activity`, `principal` | - | contract |

Merged: 7 (`listQuillsTicketsMessages` + `listQuillsTicketMessages`, `createQuillsTicketsReply` +
`sendQuillsTicketMessage`, `createQuillsTicketsNote` + `addQuillsTicketNote`, `fetchQuillsTicketActivity`).
`TICKET_REPLY` and `TICKET_NOTE` map to update.

## Tracker issue links

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsTicketExternalLinks` | `GET /tickets/{ticketId}/external-links` (≤ 100; and the GitHub/GitLab trackers with their channels) | read | `ticket_external_links`, `integrations`, `integration_event_mappings` | - | contract, feature |
| `linkQuillsTicketIssue` | `PUT /tickets/{ticketId}/external-links` (`integrationId`, `issue`) | update | `ticket_external_links`, `conversation_messages` | `ticket.external_linked` | contract, rollback, feature |
| `createQuillsTicketIssue` | `POST /tickets/{ticketId}/external-links/issue` (`integrationId`, `target`) | update | `integration_sync_operations` | `ticket.issue_requested` | contract, rollback, feature (local provider server) |
| `unlinkQuillsTicketIssue` | `DELETE /tickets/{ticketId}/external-links/{linkId}` | update | `ticket_external_links`, `conversation_messages` | `ticket.external_unlinked` | contract, rollback, feature |

`support/ticket-external-links.ts`. `TICKET_ASSIGN` maps to update. The providers are the ones P7b built
with issues: GitHub (`owner/repo#12` or the issue URL) and GitLab (`<project ID>#12`). The repository or
project must be one of the connection's channels; a link is not checked remotely (no remote inspection
exists). Linking and unlinking add a team-only note to the ticket thread. Create queues one sync operation
per installation, ticket and channel; `jobs/handlers/integration.ts` claims it after commit (the channel
must still be the connection's, the ticket live), creates the issue through the P7b delivery path, links
it (origin `push`) and adds the note. Outcomes follow P7a: an uncertain create is never sent again. The
issue carries the ticket title, its first customer-visible message (≤ 2,000 characters) and the ticket
number, never the requester's name.

## Watchers and read markers

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsTicketWatchStatus` | `GET /tickets/{ticketId}/watch` | read | `ticket_subscriptions` | - | contract |
| `watchQuillsTicket`, `unwatchQuillsTicket` | `PUT`, `DELETE /tickets/{ticketId}/watch` | read | `ticket_subscriptions` | none (personal) | contract, rollback |
| `muteQuillsTicket`, `unmuteQuillsTicket` | `PUT /tickets/{ticketId}/mute` (`days` 1-30), `DELETE` | read | `ticket_subscriptions` | none (personal) | contract, rollback |
| `listQuillsTicketWatchers` | `GET /tickets/{ticketId}/watchers` | read | `ticket_subscriptions`, `principal` | - | contract |
| `addQuillsTicketWatcher`, `removeQuillsTicketWatcher` | `PUT`, `DELETE /tickets/{ticketId}/watchers/{principalId}` | update | `ticket_subscriptions`, `principal` | `ticket.watcher_added`, `ticket.watcher_removed` | contract, rollback |
| `markQuillsTicketRead` | `POST /tickets/{ticketId}/read` | read | `tickets` or the pair `conversations` | none (view state) | contract, rollback |
| `markQuillsTicketUnread` | `POST /tickets/{ticketId}/unread` (`messageId` of this thread) | read | same, `conversation_messages` | none (view state) | contract, rollback |

Merged: 10 (`getQuillsTicketWatchStatus`, `watchQuillsTicket`, `unwatchQuillsTicket`, `muteQuillsTicket`,
`unmuteQuillsTicket`, `listQuillsTicketWatchers`, `adminQuillsAddTicketWatcher`, `adminQuillsRemoveTicketWatcher`,
`markQuillsTicketRead`, `markQuillsTicketUnreadFromMessage`). The source gates the caller's own watch, mute
and read marker on `TICKET_VIEW`, so they are `read`, like the P4 personal subscription routes.

## Links

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsTicketLinks` | `GET /tickets/{ticketId}/links` | read | `ticket_links`, `tickets` | - | contract |
| `linkQuillsTicketToTracker`, `unlinkQuillsTicketFromTracker` | `PUT`, `DELETE /tickets/{ticketId}/tracker/{trackerTicketId}` | update | `ticket_links`, `conversation_messages` | `ticket.tracker_linked`, `ticket.tracker_unlinked` | contract, rollback |
| `linkQuillsTicketToConversation` | `PUT /tickets/{ticketId}/conversations/{conversationId}` | create | `ticket_conversations`, `conversations`, `conversation_messages`, `tickets` | `ticket.conversation_linked` | contract, rollback, feature |
| `listQuillsTicketConversations` | `GET /tickets/{ticketId}/conversations` | read | `ticket_conversations` | - | contract |

Merged: 5 (`getQuillsTicketLinks`, `linkQuillsTicketToTracker`, `unlinkQuillsTicketFromTracker`,
`linkQuillsTicketToConversation`, `getQuillsTicketProvenanceConversations`). The partial unique indexes on
`ticket_conversations` and `ticket_links` hold the 1:1 pair and one-tracker rules; a conflict is 409.

## Ticket statuses, stage labels and types

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsTicketStatuses` | `GET /ticket-statuses` | read | `ticket_statuses` | - |
| `createQuillsTicketStatus`, `updateQuillsTicketStatus`, `deleteQuillsTicketStatus` | `POST /ticket-statuses`, `PATCH` and `DELETE /ticket-statuses/{statusId}` | manage_settings | `ticket_statuses`, `tickets` | `ticket_status.created`, `.updated`, `.deleted` |
| `reorderQuillsTicketStatuses` | `PUT /ticket-statuses/order` (every live ID) | manage_settings | `ticket_statuses` | `ticket_status.reordered` |
| `getQuillsTicketStageLabels`, `setQuillsTicketStageLabels` | `GET`, `PUT /ticket-stage-labels` | read, manage_settings | `settings` | `settings.ticket_stage_labels_updated` |
| `listQuillsTicketTypes` | `GET /ticket-types` (`includeArchived`, `category`) | read | `ticket_types`, `tickets` | - |
| `createQuillsTicketType`, `updateQuillsTicketType` | `POST /ticket-types`, `PATCH /ticket-types/{ticketTypeId}` | manage_settings | `ticket_types`, `tickets` | `ticket_type.created`, `.updated` |
| `archiveQuillsTicketType`, `restoreQuillsTicketType` | `POST /ticket-types/{ticketTypeId}/archive`, `/restore` | manage_settings | `ticket_types` | `ticket_type.archived`, `.restored` |

Merged: 13 (`listQuillsTicketStatusesIndex` + `listQuillsTicketStatuses`, `createQuillsTicketStatus`,
`updateQuillsTicketStatus`, `deleteQuillsTicketStatus`, `reorderQuillsTicketStatuses`, `getQuillsTicketStageLabels`,
`setQuillsTicketStageLabels`, `listQuillsTicketTypes`, `createQuillsTicketType`, `updateQuillsTicketType`,
`archiveQuillsTicketType`, `restoreQuillsTicketType`). `TICKET_MANAGE_TYPES` maps to manage_settings.
Deleting the default status, the last status of a category or a status in use is 409.

## Macros

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsMacros` | `GET /macros` (`surface`) | read | `macros` | - |
| `createQuillsMacro`, `updateQuillsMacro`, `deleteQuillsMacro` | `POST /macros`, `PATCH` and `DELETE /macros/{macroId}` | manage_settings | `macros`, `principal`, `teams`, `conversation_tags` | `macro.created`, `.updated`, `.deleted` |
| `applyQuillsMacro` | `POST /macros/{macroId}/apply` (`conversationId`) | update | `macros`, `conversations`, `conversation_tag_assignments`, `principal`, `teams`, `conversation_tags` | `macro.applied` |

Merged: 5. Apply renders the body and writes the conversation columns the source's workflow actions change:
`assigned_agent_principal_id`, `assigned_team_id`, `priority`, `status` + `snoozed_until` (snooze),
`status` + `resolved_at` (close), `custom_attributes` (set attribute), and a tag assignment.

## SLA, office hours and support settings

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsSlaPolicies` | `GET /sla-policies` (archived included, with referencing workflows) | manage_settings | `sla_policies`, `workflows` | - |
| `listQuillsSlaPolicyOptions` | `GET /sla-policies/options` | read | `sla_policies` | - |
| `getQuillsSlaOfficeHours` | `GET /sla-policies/office-hours` | manage_settings | `settings` | - |
| `createQuillsSlaPolicy`, `updateQuillsSlaPolicy` | `POST /sla-policies`, `PATCH /sla-policies/{slaPolicyId}` | manage_settings | `sla_policies`, `office_hours_schedules` | `sla_policy.created`, `.updated` |
| `archiveQuillsSlaPolicy`, `restoreQuillsSlaPolicy` | `POST /sla-policies/{slaPolicyId}/archive`, `/restore` | manage_settings | `sla_policies`, `workflows` | `sla_policy.archived`, `.restored` |
| `getQuillsDefaultSlaPolicy`, `setQuillsDefaultSlaPolicy` | `GET`, `PUT /support/default-sla-policy` | manage_settings | `settings`, `sla_policies` | `settings.default_sla_policy_updated` |
| `getQuillsOfficeHours`, `setQuillsOfficeHours` | `GET`, `PUT /support/office-hours` | manage_settings | `settings` | `settings.office_hours_updated` |
| `getQuillsConversationRouting`, `setQuillsConversationRouting` | `GET`, `PUT /support/routing` | manage_settings | `settings` | `settings.conversation_routing_updated` |
| `getQuillsEmailAutoAck`, `setQuillsEmailAutoAck` | `GET`, `PUT /support/email-auto-ack` | manage_settings | `settings` | `settings.email_auto_ack_updated` |
| `getQuillsSpamFilterConfig`, `updateQuillsSpamFilterConfig` | `GET`, `PATCH /support/spam-filter` | manage_settings | `settings` | `settings.spam_filter_updated` |

Merged: 17 (`listQuillsSlaPolicies`, `listQuillsSlaPolicyOptions`, `getQuillsSlaOfficeHours`, `createQuillsSlaPolicy`,
`updateQuillsSlaPolicy`, `archiveQuillsSlaPolicy`, `restoreQuillsSlaPolicy`, `fetchQuillsDefaultSlaPolicy`,
`updateQuillsDefaultSlaPolicy`, `fetchQuillsOfficeHours`, `updateQuillsOfficeHours`, `fetchQuillsConversationRouting`,
`updateQuillsConversationRouting`, `fetchQuillsEmailAutoAck`, `updateQuillsEmailAutoAck`, `getQuillsSpamFilterConfig`,
`updateQuillsSpamFilterConfig`). Every source key here (`SLA_MANAGE`, `OFFICE_HOURS_MANAGE`, `SETTINGS_MANAGE`,
`CHANNEL_ACCOUNT_MANAGE`) is a configuration key, so reads and writes need manage_settings; the ledger's
`read`/`update` proposals for office hours and auto-ack are replaced. Policy options keep `CONVERSATION_VIEW` → read.

## Email channel configuration

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `getQuillsEmailChannelConfig` | `GET /support/email-channel` | manage_settings | `channel_accounts`, `email_sending_domains`, `teams` | - |
| `setQuillsInboundForwarding` | `PUT /support/email-channel/inbound` | manage_settings | `channel_accounts`, `teams` | `channel_account.inbound_updated` |
| `clearQuillsInboundForwarding` | `DELETE /support/email-channel/inbound/forwarding` | manage_settings | same | `channel_account.inbound_updated` |
| `setQuillsInboundTrust` | `PUT /support/email-channel/inbound/trust` | manage_settings | same | `channel_account.inbound_updated` |
| `createQuillsSendingAddress` | `POST /support/email-channel/sending-addresses` | manage_settings | `channel_accounts`, `email_sending_domains` | `channel_account.sending_address_saved` |
| `setQuillsSendingAddressSmtp` | `PUT /support/email-channel/sending-addresses/{channelAccountId}/smtp` | manage_settings | `channel_accounts` | `channel_account.smtp_updated` |
| `deleteQuillsChannelAccount` | `DELETE /support/email-channel/sending-addresses/{channelAccountId}` | manage_settings | `channel_accounts`, `email_sending_domains` | `channel_account.deleted` |
| `deleteQuillsSendingDomain` | `DELETE /support/email-channel/domains/{sendingDomainId}` | manage_settings | `email_sending_domains`, `channel_accounts` | `sending_domain.deleted` |
| `restartQuillsSendingDomainChecks` | `POST /support/email-channel/domains/{sendingDomainId}/checks` | manage_settings | `email_sending_domains` | `sending_domain.checks_restarted` |
| `listQuillsRecentEmailLog` | `GET /support/email-log` (latest 50) | manage_settings | `email_log` | - |

Merged: 10 (`getQuillsEmailChannelConfig`, `createQuillsInboundRoute`, `clearQuillsInboundForwarding`,
`updateQuillsInboundTrust`, `createQuillsSendingAddress`, `updateQuillsSendingAddressSmtp`, `deleteQuillsChannelAccount`,
`deleteQuillsSendingDomain`, `restartQuillsSendingDomainChecks`, `listQuillsRecentEmailLog`).
`CHANNEL_ACCOUNT_MANAGE` maps to manage_settings (the ledger's create/update/delete proposals are replaced).
The SMTP user, IMAP settings, poll cursor, signing keys and delivery errors are never returned.

## Reporting

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `getQuillsSupportReporting` | `GET /support/reporting?from&to` (≤ 400 days) | read | `sla_events`, `sla_policies` | - |

Merged: 1 (`supportQuillsReporting`). Test customers' conversations and tickets are left out.

Total: 71 routes for 82 source capabilities.

## In-scope capabilities not implemented

| Source | Reason |
|---|---|
| `exportQuillsTicketTranscript` | Uses the conversation transcript renderer that the conversations slice owns. The thread is readable through `listQuillsTicketMessages?includeInternal=true`. |
| Ticket issue status sync (`updateTicketStatusMappingsFn`) | Inbound issue events update post links only. The ticket links below exist for it. |
| `suggestQuillsTicketFieldValues` | AI suggestion (P8). |
| `sendQuillsTestEmail` | Sends mail. Needs a P4 mail handler with retry and deduplication. |
| `getQuillsEmailChannelStatus` | Built in RFC 0001 lane S1 (`CONVERSATIONS.md`): the mail transport is ported now. |
| `removeQuillsConversationSla` | Mutates a conversation's applied SLA; the SLA clock engine and conversations are not in this slice. |
| `attributeQuillsBreakdown` | Built in RFC 0001 lane S1 (`CONVERSATIONS.md`) as `GET /support/reporting/attribute-breakdown`. |
| Workflow effectiveness inside `supportQuillsReporting` | Workflows are not ported. The route returns the four SLA parts only. |
| `readQuillsTogether` | Blocked in RFC 0001 lane S1 (`CONVERSATIONS.md`): it needs a framework seam. |
| `getQuillsConversationTicketLink`, `assignQuillsConversationTeam` | Inbox and conversation slices. |
| CSAT settings or reporting for teammates | The source has no teammate CSAT read; its CSAT rows are portal and public routes. |

## Deferred rows (not teammate audience)

`createQuillsMyTicket`, `getQuillsConversationLinkedTicket`, `getQuillsMyTicketForm`, `getQuillsMyTickets`,
`getQuillsMyTicketStageLabels`, `getQuillsMyTicketWatchStatus`, `watchQuillsMyTicket`, `unwatchQuillsMyTicket`,
the nine `widgetQuills*` ticket rows, `widgetQuillsSubmitCsat`, `submitQuillsCsat`, `recordQuillsCsatViaToken`,
`validateQuillsCsatEmailToken`, `createQuillsChatEmailInbound`, `createQuillsChatEmailEvents`,
`confirmQuillsEmailChange`, `getQuillsEmailChangeState`, `requestQuillsEmailChange`, `sendQuillsCurrentAddressCode`.
They need the portal/widget audience framework or signed inbound email.

## Required migrations

No migration was generated in this wave. The `recent`, `created` and `oldest` list sorts and the
thread and activity reads use existing indexes. Recommended forward migration (Quills lineage):

| Index | Why |
|---|---|
| `ticket_activity (workspace_id, principal_id)` | The `ON DELETE SET NULL` foreign key has no index. Every principal delete (customer delete, workspace delete) scans the whole table, and these routes add one row per status, priority or assignment change. |
| `ticket_links (workspace_id, linked_by_principal_id)`, `ticket_conversations (workspace_id, linked_by_principal_id)`, `macros (workspace_id, created_by_principal_id)` | The same unindexed principal foreign keys. |
| `sla_events (workspace_id, at)` | The reporting route filters on `at`; without it each of its four queries scans `sla_events`. |
| expression index on the priority rank, `id` | `sort=priority` scans and sorts every ticket. |

Test-suite effect of the first two rows: `stopContract` deletes test workspaces, and each deleted
principal scans every table with an unindexed principal foreign key. The directory test creates
10,001 principals, so in one `test:quills` process its workspace delete becomes slower as the
earlier contract run grows these tables. The support fixtures therefore reuse one customer per
workspace and seed macros and link rows only for the routes that need them.

## Differences from the source

- Visibility: `quills:read` sees every ticket. The source limits `ticket.view` to tickets assigned to the
  caller or the caller's teams and needs `ticket.view_all` for the rest (decision D2).
- Bulk update is all-or-nothing and takes at most 100 IDs. The source applies each ticket separately and
  returns succeeded/failed lists for up to 200.
- Tracker status cascade and tracker reply-all run in the request transaction and commit together. The
  source runs them after commit, best-effort per link.
- Search matches the title or the number. The source also searches message text.
- The ticket view has no SLA chip, last-message preview or attachment data; custom attributes are key/value pairs.
- Messages are plain text. Rich content and attachments wait for the message file lifecycle.
- A reply on a customer pair goes through the conversations slice's reply path
  (`conversation-ops.ts#insertReply`): it reopens a closed conversation, claims an unassigned one, stops
  the wait clock and counts as read. The event stays `ticket.replied`, whose mail entry is the same
  `replyMail` that `message.created` uses. No SLA clock runs (none is ported).
- Tracker reply-all and status cascade reach the linked requesters at delivery: the one tracker event
  fans out per linked ticket (`customer/ROUTES.md`, "Not built, or built in part"). A reply-all copy on a
  pair does not reopen or claim the linked conversation (`insertReply` with `claim` false), as a tracker
  never reopens a closed linked ticket.
- Creating a customer ticket for a requester makes the paired conversation with the minimum columns; no
  `conversation.created` webhook or workflow fires and no SLA hand-off runs. Linking a conversation does not
  hand its SLA to the ticket.
- No watcher notifications are sent: P4 fan-out has no ticket entries yet. The new event types are
  catalogue events, so a webhook can subscribe to them (`delivery/webhooks.ts` accepts every
  `changeSchema` type). It then gets the generic Kaneo payload (type, entity, entity ID and the small
  payload map), not the source's ticket webhook payloads.
- Creating a ticket with `conversationId` uses the conversation only for the default assignee. As in
  the source, the client links the ticket with `linkQuillsTicketToConversation` in a second call.
- As in the source: linking does not check that the ticket's requester is the conversation's visitor,
  and a status edit may change its category without the delete guards.
- The tracker cascade and reply-all have no cap on linked tickets and run one set of queries per
  ticket; a bulk request runs about 6 queries per ticket while it holds the row locks.
- Macro snooze presets wake at 09:00 UTC, not server local time. Macro list needs read (the source needs
  `CONVERSATION_REPLY`); the macro entitlement check is dropped.
- `muteQuillsTicket` requires `days` (the source defaults to 7), so an empty body is rejected.
- Office hours ignore the legacy widget-config schedule.
- Email channel: a new sending address records its domain as pending with no DNS records and no provider
  identity; restarting checks only opens a new 72-hour window; the inbound route records no provider;
  the inbound address tier limit is not enforced.
- Wrong link types, an assignee who is not a current member, and blocked status or type deletes return
  404 or 409, where the source returns 400 or 403.
- Read markers publish no change event and keep the ticket's `updated_at`.
