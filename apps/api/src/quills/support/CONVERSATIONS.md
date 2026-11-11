# P5a support conversations: final route set

Source rows: `docs/quills-port/ledger/phase-P5.md`, teammate audience, conversation capabilities only.
This file applies the merge rule (`detailed-plan.md` §2) and the action mapping (§3). The format
follows `detailed-plan.md` §5.

All paths are under `/quills/{workspaceId}`. Every route below is for teammates and uses
`defineQuillsRoute`. Each route module has a sibling `*.fixture.ts`, so
`framework/contract.test.ts` checks every route. `support/conversations.test.ts` holds the
feature tests (real PostgreSQL, workspaces A and B).

## Boundary map

```
Tables and owning schema:  quills: conversations, conversation_messages, conversation_message_mentions,
                           conversation_message_reactions, conversation_message_flags,
                           conversation_tags, conversation_tag_assignments, conversation_participants,
                           conversation_attribute_definitions, conversation_views,
                           conversation_view_pins, conversation_summaries, principal, user, teams,
                           segments, user_segments, macros and workflows (read only, tag references),
                           boards, board_projects, posts, post_votes, post_comments, post_activity,
                           post_subscriptions, post_external_links, post_statuses.
                           public (read only, through framework/platform-reads.ts): workspace_member,
                           project and project access.
Actor and workspace:       authenticated context (helper). Never a body or query copy.
Permissions:               workspace:read + quills:<action>. No native permissions.
Persisted relationships:   board_projects (a post route sees only boards whose linked projects the
                           caller can open); post_external_links (conversation to post).
Transaction:               one scoped transaction per request. The member roster and hidden projects
                           are read in `load`, after the permission checks, before the transaction.
                           A bulk update is one transaction: any failure rolls back every row.
External effects:          none in a request. Each mutation records one outbox event. No reply mail,
                           channel delivery or realtime publish runs in the request.
Completion checks:         authenticated endpoint, tenant/object access, mutation or batch,
                           read/search/export, native resource link (post routes).
```

Teammate-only data: `conversation_messages.is_internal` marks internal notes and team-only system
notices. Every message response carries `isInternal`. Message lists leave notes out unless
`includeInternal=true`. Later customer routes must filter on `is_internal = false`.
Reactions, flags and mentions live in their own tables and are read only by these routes.

Test customers: a conversation whose visitor has `test_owner_principal_id` set is a test conversation.
Lists, counts, inbox counts, segment counts, tag counts and attribute value counts leave it out.

Visibility: `quills:read` sees every conversation of the workspace (D2: Kaneo has no
`conversation.view` vs `view_all` split).

## Conversations

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsConversations` | `GET /conversations` (status, priority, assignee `mine`/`unassigned`/principal, teamId, visitorPrincipalId, channel, source, waitingOnly, tagId, view `all`/`mentions`/`spam`/`created_by_me`, search, sort, cursor; `limit` ≤ 100) | read | `conversations`, `principal`, `user`, `conversation_messages`, `conversation_tag_assignments`, `conversation_tags`, `conversation_message_mentions` | - | contract, read-leak, page-bounds |
| `getQuillsConversation` | `GET /conversations/{conversationId}` | read | `conversations`, `conversation_summaries`, tags | - | contract |
| `exportQuillsConversationTranscript` | `GET /conversations/{conversationId}/transcript` | read | `conversations`, `conversation_messages`, `principal` | - | contract |
| `listQuillsConversationFiles` | `GET /conversations/{conversationId}/files` | read | `conversation_messages` | - | contract |

Merged: 6. `listQuillsConversationsIndex` (v1, shape) + `listQuillsConversations` +
`listQuillsConversationsForUser` (the `visitorPrincipalId` filter); `getQuillsConversations` (v1) +
`getQuillsConversation`; `exportQuillsConversationTranscript`; `listQuillsConversationFiles`
(conversation target; the ticket target belongs to the tickets slice).

## Messages

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsConversationMessages` | `GET /conversations/{conversationId}/messages` (`includeInternal`, `before`; `limit` ≤ 100) | read | `conversation_messages`, reactions, flags, `principal` | - | contract, read-leak |
| `replyQuillsConversation` | `POST /conversations/{conversationId}/reply` | update | `conversation_messages`, `conversations` | `message.created` | contract, rollback |
| `addQuillsConversationNote` | `POST /conversations/{conversationId}/note` (`mentionPrincipalIds` ≤ 20, current members) | create | `conversation_messages`, `conversation_message_mentions`, `conversations` | `message.note_created` | contract, rollback |
| `updateQuillsConversationMessage` | `PATCH /conversation-messages/{messageId}` (the caller's own agent message) | update | `conversation_messages`, `conversations` | `message.updated`, `message.note_updated` | contract, rollback |
| `deleteQuillsConversationMessage` | `DELETE /conversation-messages/{messageId}` (soft delete) | delete | `conversation_messages` | `message.deleted`, `message.note_deleted` | contract, rollback |
| `setQuillsMessageReaction`, `removeQuillsMessageReaction` | `PUT` and `DELETE /conversation-messages/{messageId}/reactions?emoji=` | update | `conversation_message_reactions` | `message.reacted`, `message.unreacted` | contract, rollback |
| `setQuillsMessageFlag`, `removeQuillsMessageFlag` | `PUT` and `DELETE /conversation-messages/{messageId}/flag` | update | `conversation_message_flags` | none (a personal marker) | contract, rollback |
| `listQuillsFlaggedMessages` | `GET /conversation-messages/flagged` (`limit` ≤ 100) | read | flags, `conversation_messages` | - | contract |
| `markQuillsConversationRead` | `POST /conversations/{conversationId}/read` | update | `conversations` | `conversation.read` | contract, rollback |
| `markQuillsConversationUnreadFromMessage` | `POST /conversations/{conversationId}/unread` | update | `conversations`, `conversation_messages` | `conversation.read` | contract, rollback |

Merged: 16. `listQuillsConversationsMessages` (v1); `createQuillsConversationsReply` (v1) +
`sendQuillsAgentMessage`; `createQuillsConversationsNote` (v1) + `addQuillsConversationNote`;
`editQuillsConversationMessage` and `deleteQuillsConversationMessage` (teammate branch only; their
customer branch waits for the audience framework); `addQuillsMessageReaction`,
`removeQuillsMessageReaction`, `setQuillsMessageFlag` (split into set and clear),
`listQuillsFlaggedMessages`; `createQuillsConversationsRead` (v1);
`markQuillsConversationUnreadFromMessage`. The teammate branch of `listQuillsConversationMessages`
(portal audience) is served by the list route; its visitor branch stays with the audience wave.
Reply and note take plain text (≤ 10000). Rich content and attachments are not accepted in this slice.

## Conversation state

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `setQuillsConversationStatus` | `POST /conversations/{conversationId}/status` (close checks required attributes: 409) | update | `conversations`, `conversation_messages`, attribute definitions | `conversation.status_changed` | contract, rollback |
| `snoozeQuillsConversation` | `POST /conversations/{conversationId}/snooze` | update | same | `conversation.status_changed` | contract, rollback |
| `endQuillsConversation` | `POST /conversations/{conversationId}/end` (reason, note ≤ 2000; close checks required attributes unless the reason is spam: 409) | update | same | `conversation.status_changed` | contract, rollback |
| `restoreQuillsConversationFromSpam` | `POST /conversations/{conversationId}/restore-spam` (409 unless spam) | update | same | `conversation.status_changed` | contract, rollback |
| `setQuillsConversationPriority` | `POST /conversations/{conversationId}/priority` | update | same | `conversation.priority_changed` | contract, rollback |
| `assignQuillsConversation` | `POST /conversations/{conversationId}/assign` (`assigneePrincipalId`: a current member, `me` or null) | update | `conversations`, `principal`, `conversation_messages`; reads `workspace_member` | `conversation.assigned` | contract, rollback |
| `assignQuillsConversationTeam` | `PUT /conversations/{conversationId}/team` | update | `conversations`, `teams`, `conversation_messages` | `conversation.assigned` | contract, rollback |
| `captureQuillsVisitorContactEmail` | `PUT /conversations/{conversationId}/contact-email` | update | `conversations`, `principal` | `conversation.updated` | contract, rollback |
| `setQuillsInboxTranslationEnabled` | `PUT /conversations/{conversationId}/translation` | update | `conversations` | `conversation.updated` | contract, rollback |
| `dismissQuillsInboxTranslationSuggestion` | `POST /conversations/{conversationId}/translation/dismiss` | update | `conversations` | `conversation.updated` | contract, rollback |
| `setQuillsAgentAvailability` | `PUT /support/availability` (the caller's own) | update | `principal` | `agent.availability_changed` | contract, rollback |

Merged: 15. `createQuillsConversationsStatus` (v1) + `setQuillsConversationStatus`;
`snoozeQuillsConversation`; `endQuillsConversation`; `restoreQuillsConversationFromSpam`;
`createQuillsConversationsPriority` (v1) + `setQuillsConversationPriority`;
`createQuillsConversationsAssign` (v1) + `assignQuillsConversation`; `assignQuillsConversationTeam`;
`captureQuillsVisitorContactEmail`; the two translation toggles; `setQuillsAgentAvailability`.
Every state route returns the conversation with `changed`; a no-op records no event. A conversation
that leaves `closed` (status, snooze, reply, bulk reopen or snooze) loses its end reason, end note and
spam marker, so a reopened spam-ended thread is back in the lists and counts.

Differences from the source, on purpose:

- `/end` with a reason other than spam checks required attributes, like `/status` and the bulk close.
  The source checks only `/status` and the bulk close.
- Reopening clears the end reason. In the source a reopened spam-ended thread stays hidden from every
  list.
- Deleting (or editing) the latest customer-visible message moves the list preview to the latest one
  left. In the source the deleted text stays in the preview.
- A required-attribute close also applies to API-key callers: Kaneo serves session and API key through
  one route.
- `POST /conversations/{conversationId}/posts` records `post.created` or `post.voted` with
  `messageId` in the payload (one event per request). A reply delivery handler must read that
  `messageId` as well as `message.created`.

## Bulk

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `bulkQuillsUpdateConversations` | `POST /conversations/bulk` (≤ 100 IDs; assign, assign_team, priority, snooze, tag, close, reopen, restore_spam) | update | as the single routes | `conversation.bulk_updated` | contract, rollback, batch |
| `bulkQuillsDeleteConversations` | `POST /conversations/bulk-delete` (≤ 100 spam-ended IDs, hard delete) | delete | `conversations` and its cascades | `conversation.deleted` | contract, rollback, batch |

Merged: 1 (`bulkQuillsUpdateConversations`, split by action: `delete_forever` needs the delete
action). All or nothing: one missing ID, one blocked close or one invalid assignee returns 404 or 409
and changes nothing. The `macro` action belongs to the macros slice.

## Tags

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsConversationTags` | `GET /conversation-tags` (`counts=true`: open real conversations) | read | `conversation_tags`, assignments, `conversations` | - |
| `listQuillsConversationTagUsage` | `GET /conversation-tags/usage` (archived included, total use) | manage_settings | same | - |
| `createQuillsConversationTag` | `POST /conversation-tags` (find or create by name) | manage_settings | `conversation_tags` | `conversation_tag.created` |
| `updateQuillsConversationTag` | `PATCH /conversation-tags/{tagId}` | manage_settings | `conversation_tags` | `conversation_tag.updated` |
| `archiveQuillsConversationTag` | `DELETE /conversation-tags/{tagId}` (409 while a live workflow or macro uses it) | manage_settings | `conversation_tags`; reads `workflows`, `macros` | `conversation_tag.archived` |
| `restoreQuillsConversationTag` | `POST /conversation-tags/{tagId}/restore` | manage_settings | `conversation_tags` | `conversation_tag.restored` |
| `deleteQuillsConversationTag` | `DELETE /conversation-tags/{tagId}/permanent` (archived only) | manage_settings | `conversation_tags`, assignments | `conversation_tag.deleted` |
| `addQuillsConversationTag` | `POST /conversations/{conversationId}/tags` (a live tag) | update | assignments | `conversation.tags_changed` |
| `removeQuillsConversationTag` | `DELETE /conversations/{conversationId}/tags/{tagId}` | update | assignments | `conversation.tags_changed` |

Merged: 12. `fetchQuillsConversationTags` + `fetchQuillsConversationTagsWithCounts`;
`listQuillsConversationTagsForSettings` (own route: it needs the settings action);
`createQuillsConversationTag`; `updateQuillsConversationTag`; `deleteQuillsConversationTag` (archive);
`restoreQuillsConversationTag`; `hardQuillsDeleteConversationTag`; `createQuillsConversationsTags` (v1)
+ `addQuillsConversationTag`; `deleteQuillsConversationsTags` (v1) + `removeQuillsConversationTag`.
The inline "add by name" of `addQuillsConversationTag` mints taxonomy, so it needs the settings action:
call `POST /conversation-tags`, then attach.

## Attributes

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsConversationAttributes` | `GET /conversation-attributes` (`includeArchived`) | read | definitions | - |
| `createQuillsConversationAttribute` | `POST /conversation-attributes` | manage_settings | definitions | `conversation_attribute.created` |
| `updateQuillsConversationAttribute` | `PATCH /conversation-attributes/{attributeId}` (key and type stay fixed; options rename or append) | manage_settings | definitions | `conversation_attribute.updated` |
| `archiveQuillsConversationAttribute`, `restoreQuillsConversationAttribute` | `POST .../{attributeId}/archive`, `POST .../{attributeId}/restore` | manage_settings | definitions | `conversation_attribute.archived`, `.restored` |
| `attributeQuillsValueCounts` | `GET /conversation-attributes/{attributeId}/value-counts` (select only) | read | definitions, `conversations` | - |
| `setQuillsConversationAttributeValue` | `PUT /conversations/{conversationId}/attributes/{key}` | update | `conversations`, definitions | `conversation.attribute_changed` |

Merged: 7. The ticket target of `setQuillsConversationAttributeValue` belongs to the tickets slice.

## Participants, views, inbox, posts

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsConversationParticipants` | `GET /conversations/{conversationId}/participants` | read | `conversation_participants`, `principal`, `user` | - |
| `addQuillsConversationParticipant` | `POST /conversations/{conversationId}/participants` (an existing customer by `principalId` or `email`) | update | `conversation_participants`, `conversation_messages` | `conversation.participant_added` |
| `removeQuillsConversationParticipant` | `DELETE /conversations/{conversationId}/participants/{principalId}` | update | same | `conversation.participant_removed` |
| `listQuillsConversationViews` | `GET /conversation-views` (shared and own private, pinned first) | read | `conversation_views`, pins | - |
| `createQuillsConversationView` | `POST /conversation-views` (≤ 15 rules; tag, team and assignee IDs checked) | create | `conversation_views` | `conversation_view.created` |
| `updateQuillsConversationView` | `PATCH /conversation-views/{viewId}` | update | `conversation_views` | `conversation_view.updated` |
| `deleteQuillsConversationView` | `DELETE /conversation-views/{viewId}` (soft delete, drops pins) | delete | views, pins | `conversation_view.deleted` |
| `pinQuillsConversationView`, `unpinQuillsConversationView` | `PUT` and `DELETE /conversation-views/{viewId}/pin` | update | pins | none (a personal marker) |
| `listQuillsInboxItems` | `GET /inbox` (facet `open`/`waiting`/`closed`/`all`, `kind`, the list filters, sorts `recent`/`oldest`/`created`/`priority`, opaque `cursor`; `limit` ≤ 100) | read | as the list, `tickets` | - |
| `fetchQuillsInboxCounts` | `GET /inbox/counts` (mine, unassigned: open real conversations; open tickets by type, a pair once; test conversations) | read | `conversations`, `tickets`, `ticket_conversations` | - |
| `fetchQuillsInboxSegmentsWithCounts` | `GET /inbox/segments` | read | `segments`, `user_segments`, `conversations` | - |
| `createQuillsPostFromConversation` | `POST /conversations/{conversationId}/posts` (new post by the visitor, or the visitor's vote on `asUpvoteOfPostId`) | create | `posts`, `post_votes`, `post_subscriptions`, `post_activity`, `post_comments`, `post_external_links`, `conversation_messages`, `conversations` | `post.created` or `post.voted` |
| `shareQuillsPost` | `POST /conversations/{conversationId}/share-post` | update | `conversation_messages`, `conversations`, `posts` | `message.created` |
| `getQuillsLinkedPostsForConversation` | `GET /conversations/{conversationId}/posts` | read | `post_external_links`, `posts`, `boards` | - |
| `getQuillsLinkedConversationsForPost` | `GET /posts/{postId}/conversations` | read | `post_external_links`, `conversations` | - |

Merged: 18. The inbox is the source's unified inbox: the conversation branch and the ticket branch
(`support/ticket-list.ts`, shared with `listQuillsTickets`), each paged by its own keyset cursor and
merged in order; the opaque cursor carries both. A customer ticket with a linked conversation lists as
that conversation, and test customers' tickets stay out, as their conversations do. `waiting` maps to
the ticket category `pending`. A conversation-only filter (visitor, tag, channel, source, waitingOnly,
a view) lists conversations only. Items are one closed object (`kind`, then `conversation` or `ticket`),
because the contract's strict-response check reads no unions. The `waiting` sort is not offered: tickets
have no wait clock. Post routes use `feedback/visibility.ts`: a board linked to projects the caller
cannot open hides its posts.

## Assistant surface and outbound start (RFC 0001, lane G2)

Module: `support/conversation-assistant.ts`. Feature tests: `support/conversation-assistant.test.ts`.

```
Tables and owning schema:  quills: conversations, conversation_messages, principal, user,
                           assistant_involvements (read), posts and boards (read, for cited posts),
                           events, audit_log, job_queue. public (read only, through
                           framework/platform-reads.ts): project access (`loadProjects`).
Actor and workspace:       authenticated context (helper). The target customer comes from the body
                           and is checked against this workspace (`loadCustomer`: `isCustomer` and
                           row security).
Permissions:               workspace:read + quills:read (counts, activity); quills:update (start, the
                           source's CONVERSATION_REPLY). No native permissions.
Persisted relationships:   assistant_involvements.conversation_id; board_projects for a cited post.
Transaction:               one scoped transaction per request. The start writes the conversation, the
                           first message and two outbox events together; any failure rolls all back.
External effects:          none in a request. The conversation is an email conversation, so its
                           `message.created` makes the existing reply delivery mail the first message
                           (jobs/handlers/support-mail.ts, one send per event through the ledger).
Completion checks:         authenticated endpoint, tenant/object access, mutation, read/search/export.
```

Visibility: the counts use the inbox list's rule before they count: real conversations (no test
customer) that are not spam, in the caller's workspace. The activity of one conversation follows
`getQuillsConversation`: any conversation of the workspace, 404 otherwise. A cited post shows only
when it is on a board that the caller can see (`feedback/visibility.ts`).

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `startQuillsAgentConversation` | `POST /conversations` (`targetPrincipalId`: an identified customer with a mail address; plain text ≤ 10000) | update | `conversations`, `conversation_messages`, `principal`, `user` | `conversation.agent_started` and `message.created` |
| `fetchQuillsAssistantInboxCounts` | `GET /inbox/assistant-counts` (resolved, escalated, pending) | read | `assistant_involvements`, `conversations`, `principal` | - |
| `getQuillsConversationAssistantActivity` | `GET /conversations/{conversationId}/assistant-activity` | read | `assistant_involvements`, `conversations`, `posts`, `boards` | - |

Differences from the source, on purpose:

- The start takes plain text only, like the reply. It accepts no rich document and no attachments.
- The start refuses a lead (409), a customer with no real mail address (409) and a blocked customer
  (409). The source refuses the first two; a blocked customer would get no mail here, so the start
  fails instead of reporting a delivery that cannot happen.
- A teammate, a test customer or a customer of another workspace is "Person not found" (404). The
  source answers a teammate with a validation error and accepts a test customer.
- The start opens an email conversation, not a messenger one. Kaneo's inbound mail threads only into
  email conversations, and only those mail later replies. The source opens a messenger thread and
  promotes it to email when the customer replies by mail. The first mail therefore uses the reply
  template of an email conversation, not the source's "sent you a message" card.
- The start does not check the `supportInbox` flag. No Kaneo teammate route checks a product flag.
- The start records `conversation.agent_started` (no handler; audit and webhooks) and `message.created`
  (the mail and the customer's live channel), not `conversation.created`. It sends no SLA or workflow
  trigger of its own.
- The counts count distinct conversations, as the list would show them. The source counts involvement
  rows and also counts spam conversations.
- The activity leaves out a cited post on a board that the caller cannot see and a malformed stored
  source, and then returns at most 50 sources. The source returns every stored source.
- Nothing in Kaneo writes `assistant_involvements` yet (the customer agent is not ported). The counts
  and the activity read imported rows and rows that a later agent writes.

## Event catalogue additions

Types: `conversation.status_changed`, `conversation.assigned`, `conversation.priority_changed`,
`conversation.attribute_changed`, `conversation.tags_changed`, `conversation.read`,
`conversation.updated`, `conversation.participant_added`, `conversation.participant_removed`,
`conversation.bulk_updated`, `conversation.deleted`, `message.created`, `message.note_created`,
`message.updated`, `message.note_updated`, `message.deleted`, `message.note_deleted`,
`message.reacted`, `message.unreacted`, `conversation_tag.created`, `conversation_tag.updated`,
`conversation_tag.archived`, `conversation_tag.restored`, `conversation_tag.deleted`,
`conversation_attribute.created`, `conversation_attribute.updated`, `conversation_attribute.archived`,
`conversation_attribute.restored`, `conversation_view.created`, `conversation_view.updated`,
`conversation_view.deleted`, `agent.availability_changed`.
Entities: `conversation`, `conversation_message`, `conversation_tag`, `conversation_attribute`,
`conversation_view`. Payloads carry IDs and enum values only, never message text.

## Not ported in this slice

| Source capability | State | Reason |
|---|---|---|
| `translateQuillsConversationMessages` | deferred (P8) | Needs the AI provider. The toggles are ported. |
| `draftQuillsAttributeDescriptions`, `previewQuillsAttributeDetection` | deferred (P8) | AI authoring. |
| `fetchQuillsCustomerContext` | deferred (P7) | Calls connected integrations. |
| `unfurlQuillsLink`, `getQuillsEmbedPreview` | deferred (audience wave) | Portal audience. Needs a safe outbound fetch, a rate limit and a cache, and help center and ticket embeds. |
| `readQuillsTogether` | not ported | Client read batching; the typed client sends reads in parallel. |
| `getQuillsConversationTicketLink` | out of scope | Ticket links (tickets slice). |
| `attributeQuillsBreakdown`, `supportQuillsReporting` | deferred | Support reporting, not conversations. |
| `sendQuillsConversationTyping`, `getQuillsConversationPresence` | deferred | Realtime only, no plain write; portal or public audience. |
| `captureQuillsVisitorContactEmail` changelog auto-subscribe | part | The address is stored; the changelog subscription side effect waits for a handler. |

Partly ported behavior: replies and notes are plain text without attachments; mentions come from
`mentionPrincipalIds`, not a rich document; editing a note keeps its mentions; team assignment never
distributes to a member (round robin and balanced need presence); the list has no `attributeFilters`,
`segmentIds`, `companyId`, `sla` or `relevance` sort and no `quinn` or `test` view; a timed snooze
needs a sweep job to wake it; replies are not mailed or posted to a channel until a delivery handler
consumes `message.created`.

Known limits, as in the source: the list cursor is a conversation ID whose sort values are read again
on the next page, so a conversation that moves between pages (a new message, a reply) can repeat or
skip rows; the search `ILIKE` cannot use the trigram indexes under row security, so a search reads the
workspace's messages; a bulk update runs its statements one conversation at a time.

## Required migrations

None in this wave. Candidates, not generated:

1. `conversation_tags (workspace_id, lower(name))` unique index: the find-or-create by name is not
   race-free without it (two different-case names can both insert).
2. Indexes for the principal foreign keys that have none, for example
   `conversation_participants (workspace_id, added_by_principal_id)`,
   `conversation_views (workspace_id, created_by_principal_id)`,
   `teams (workspace_id, rr_cursor_principal_id)` and `post_activity (workspace_id, principal_id)`.
   Deleting a workspace with many principals checks each of these by a sequential scan. The
   `directory.test.ts` teardown (10,001 principals) passes the 10-second hook limit when it runs right
   after the contract suite, also without this slice.
3. A search path that works under row security (the `ILIKE` operators are not leakproof), if the
   message search proves slow on real workspaces.

The waiting sort does not need an index: `conversations_waiting_since_id_idx` exists, but the sort's
`coalesce` does not use it.
