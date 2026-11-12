# P8b assistant and AI features: final route set

Source rows: `docs/quills-port/ledger/phase-P8.md` (the `assistant` section) and the AI rows that
earlier slices deferred (`feedback`, `support/CONVERSATIONS.md`, `support/TICKETS.md`,
`content/ROUTES.md`). The format follows `detailed-plan.md` §5.

Teammate paths are under `/quills/{workspaceId}`; the widget paths are under
`/quills-public/{workspace}`. Every route uses `defineQuillsRoute` and has a sibling
`*.fixture.ts`, so `framework/contract.test.ts` checks every route. `assistant.test.ts` holds
the feature tests (real PostgreSQL, a local provider server, workspaces A and B).

## Boundary map

```
Tables and owning schema:  quills: settings (assistant_config), assistant_guidance_rules,
                           assistant_snippets, agent_skills, assistant_web_sources,
                           assistant_documents, connectors, assistant_pending_actions,
                           assistant_tool_calls, assistant_events, assistant_involvements (read),
                           ai_usage_log, kv_store (runs), post_merge_suggestions, posts,
                           post_tag_assignments, post_sentiment, conversations,
                           conversation_messages, conversation_summaries,
                           conversation_attribute_definitions, tickets, ticket_types,
                           ticket_summaries, kb_articles, kb_categories, kb_article_translations,
                           events, audit_log, job_queue. public (read only, through
                           framework/platform-reads.ts): workspace members, roles, project access.
Actor and workspace:       authenticated context (helper). Worker: withQuillsSystemWorkspace with
                           the job's workspace; the requester comes from the stored run or event.
Permissions:               workspace:read + quills:<action>. Configuration is manage_settings.
Persisted relationships:   board_projects (posts and suggestions: both posts on boards the caller
                           sees); a pending action's stored conversation.
Transaction:               one scoped transaction per request. A provider call never runs inside
                           one: request-only input calls it in `load`; anything that reads Quills
                           data is a run or an event that the quills.ai worker answers (read,
                           release, call, then write with the job's completion).
External effects:          provider calls (OpenAI-compatible, 60-second timeout, fixed error text);
                           web-source fetches through the public-destination guard; connector
                           requests (see "Connectors"). No mail.
```

## Provider

`provider.ts` calls `QUILLS_AI_BASE_URL` with `fetch` (`/chat/completions`, `/embeddings`).
Configuration: `QUILLS_AI_BASE_URL`, `QUILLS_AI_MODEL`, `QUILLS_AI_API_KEY` (optional),
`QUILLS_AI_EMBEDDING_MODEL` (optional, 1536 dimensions). See the database guide's "AI provider".
Without a provider each AI route returns 409 `AI is not configured`, and background AI work
finishes with no work. Provider failures map to fixed messages (409, 502); the provider's text
and the key never reach a response, a run or `ai_usage_log`. Each call writes one usage row.

## How tool calls are authorized

1. The copilot request needs `quills:read`. It stores a run; the worker answers it.
2. Before the worker acts, it re-reads the requester's current role
   (`memberQuillsActions`): a removed or downgraded requester's run fails with no provider call.
3. A read tool returns only what a teammate may read: `search_help_center` reads published
   articles; `search_knowledge` reads snippets with audience `public` or `team`, and documents
   and fetched web pages when the copilot's `documents` knowledge setting is on.
4. A write tool never runs in the worker. It becomes a pending action only when the requester
   holds the tool's action (`update`) now; otherwise the call is recorded `denied`. A viewer's
   copilot therefore proposes nothing and changes nothing (`assistant.test.ts`).
5. `approveQuillsAssistantAction` declares `action: "update"`, so the framework checks the
   approver's `quills:update` and API-key scope. Every write tool's action is `update`; a test
   fails if a tool needs another permission. Approval runs the tool in the approver's request
   through the same support functions (`setStatus` with `requireClosable`, `setPriority`,
   `resolveLiveTag` and `attachTag`) and records the same change event, named for the approver.
   A rejected, expired or decided action returns 409 and never runs.

## Configuration (manage_settings)

| operationId | Route | Event |
|---|---|---|
| `getQuillsAssistantSettings` | `GET /assistant/settings` | - |
| `updateQuillsAssistantSettings` | `PATCH /assistant/settings` (revision; 409 on a stale revision) | `settings.assistant_updated` |
| `listQuillsGuidanceRules` | `GET /assistant/guidance-rules` | - |
| `createQuillsGuidanceRule` | `POST /assistant/guidance-rules` (≤ 100) | `assistant_guidance.created` |
| `updateQuillsGuidanceRule` | `PATCH /assistant/guidance-rules/{ruleId}` | `assistant_guidance.updated` |
| `deleteQuillsGuidanceRule` | `DELETE /assistant/guidance-rules/{ruleId}` | `assistant_guidance.deleted` |
| `reorderQuillsGuidanceRules` | `PUT /assistant/guidance-rules/order` (every ID once) | `assistant_guidance.reordered` |
| `getQuillsGuidanceRuleStats` | `GET /assistant/guidance-rules/stats` (90 days of usage rows) | - |
| `listQuillsSnippets` | `GET /assistant/snippets` | - |
| `createQuillsSnippet` | `POST /assistant/snippets` (≤ 500) | `assistant_snippet.created` |
| `updateQuillsSnippet` | `PATCH /assistant/snippets/{snippetId}` | `assistant_snippet.updated` |
| `deleteQuillsSnippet` | `DELETE /assistant/snippets/{snippetId}` | `assistant_snippet.deleted` |
| `listQuillsSkills` | `GET /assistant/skills` | - |
| `createQuillsSkill` | `POST /assistant/skills` (unique name) | `assistant_skill.created` |
| `updateQuillsSkill` | `PATCH /assistant/skills/{skillId}` | `assistant_skill.updated` |
| `deleteQuillsSkill` | `DELETE /assistant/skills/{skillId}` | `assistant_skill.deleted` |
| `listQuillsWebSources` | `GET /assistant/web-sources` (status pending, ready or failed) | - |
| `addQuillsWebSource` | `POST /assistant/web-sources` (fetched by the worker) | `assistant_web_source.added` |
| `setQuillsWebSourceEnabled` | `PATCH /assistant/web-sources/{webSourceId}` | `assistant_web_source.updated` |
| `deleteQuillsWebSource` | `DELETE /assistant/web-sources/{webSourceId}` | `assistant_web_source.deleted` |
| `listQuillsAssistantDocuments` | `GET /assistant/documents` | - |
| `uploadQuillsAssistantDocument` | `POST /assistant/documents` (text or Markdown ≤ 100,000 characters) | `assistant_document.created` |
| `deleteQuillsAssistantDocument` | `DELETE /assistant/documents/{documentId}` (soft delete) | `assistant_document.deleted` |
| `listQuillsConnectors` | `GET /assistant/connectors` (no credentials) | - |
| `deleteQuillsConnector` | `DELETE /assistant/connectors/{connectorId}` | `assistant_connector.deleted` |
| `listQuillsAssistantTools` | `GET /assistant/tools` | - |

Merged: the source's seven per-section settings updates are one PATCH. Widget deployment
settings stay with the widget slice.

## Connectors (RFC 0001, lane C1)

A connector is a remote MCP server that a settings manager adds. These routes add, read, change,
refresh and authorize a connector. `connector-client.ts` is the MCP client. The copilot does not
call connector tools yet (see "Not ported").

### Boundary map

```
Tables and owning schema:  quills: connectors, principal (read: the callback's teammate), kv_store
                           (signed delivery receipts), events, audit_log, job_queue. public: none in
                           the route module (the callback's verifier reads the membership and role
                           through framework/platform-reads.ts, as the integration callback does).
Actor and workspace:       teammate routes: authenticated context. Callback: the signed state's
                           workspace and teammate, re-checked against the session. The state also
                           names the connector, and the path must name the same connector.
Permissions:               teammate routes: workspace:read + quills:manage_settings. Callback: the
                           session account still holds quills:manage_settings in the state's workspace.
Persisted relationships:   none. A connector belongs to its workspace (RLS); each ID is read in the
                           caller's scope, so a connector of workspace B is 404.
Transactions:              the connector URL is never reached in a transaction. `prepare` reads in one
                           scoped transaction, `call` reaches the server, and the handler writes in a
                           new one. The handler answers 409 when the URL, the auth mode or the
                           secrets changed between the read and the write.
External effects:          requests to the connector URL and its authorization server: MCP initialize
                           and tools/list, OAuth discovery, client registration, token exchange and
                           refresh. Each request goes through createGuardedFetch (each redirect and the
                           socket address are checked), under one 10-second deadline for each step,
                           and each answer is at most 1 MB. No worker, mail or webhook.
Secrets:                   the bearer token, the OAuth client registration, the code verifier and the
                           tokens are sealed with sealCredentials (NOTIFICATION_SECRET_ENCRYPTION_KEY),
                           as integrations.secrets are. No response, event, audit row or stored error
                           holds them. Server and provider text never reaches a response or last_error.
```

### Routes

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `getQuillsConnector` | `GET /assistant/connectors/{connectorId}` | manage_settings | `connectors` | - |
| `createQuillsConnector` | `POST /assistant/connectors` (at most 100; reaches the URL unless `authMode` is `oauth`) | manage_settings | `connectors` | `assistant_connector.created` |
| `updateQuillsConnector` | `PATCH /assistant/connectors/{connectorId}` (no network) | manage_settings | `connectors` | `assistant_connector.updated` |
| `refreshQuillsConnector` | `POST /assistant/connectors/{connectorId}/refresh` | manage_settings | `connectors` | `assistant_connector.refreshed` |
| `startQuillsConnectorOAuth` | `POST /assistant/connectors/{connectorId}/oauth` (returns the authorization URL) | manage_settings | `connectors` | `assistant_connector.updated` |
| `completeQuillsConnectorOAuth` | `GET /quills-public/signed/oauth/connectors/{connectorId}/callback?state&code` (signed) | manage_settings (session) | `connectors`, `principal`, `kv_store` | `assistant_connector.connected` |

Tests: the contract suite (a local MCP and OAuth server in `connector-edge.fixture.ts`) and
`connectors.test.ts` (the OAuth flow, token refresh, private addresses, the URL change, bounds).

### Differences from the source

| Source | Kaneo |
|---|---|
| `createConnectorFn` with OAuth creates the connector and returns `authorizationUrl`. | Create never starts OAuth. An `oauth` connector, or a `none` connector whose server answers 401, is stored with status `error` and `Authorization required`. The client then calls `startQuillsConnectorOAuth`. |
| The callback is `/oauth/connector/callback` and redirects to the settings page. | The callback is a signed route that names the connector, and it answers JSON (`connected` or `already_used`), as the integration callback does. The state is Kaneo's signed state: bound to the teammate, the workspace and the connector, ten minutes, one use. Each connector registers its own OAuth client with its own redirect URI. |
| `startConnectorOAuthFn` refreshes stored tokens and then answers "already authorized". | Start always begins a new authorization. The stored tokens stay until the callback replaces them. Refresh uses the stored refresh token through the SDK when the server answers 401. |
| The URL is checked once at save time (`checkUrlSafety`), then fetched with a pinned address. | Each request goes through `createGuardedFetch`, so update does not reach the network and a refresh records a refusal as `error`. Create answers 400 for a refused address. |
| A URL change keeps the stored token. | A URL change removes the stored secrets, unless the same request sets a new bearer token, and sets status `error`. A token never goes to a URL that it was not given for. |
| `last_error` and error responses hold the server's message. | Fixed texts only. |
| The tool catalogue is stored as the server sends it. | At most 100 tools from the first `tools/list` page; names of 1 to 128 characters, titles of 200, descriptions of 2,000; an input schema over 20,000 characters is dropped. The tool view has no `isNew` (the source's value is never true after a sync) and no `isOverride` (`toolPolicies.tools` holds the overrides). |
| `getConnectorFn("quackback")` returns the built-in tools. | `listQuillsAssistantTools` lists them; get answers 404 for an unknown ID. |
| Each assignment needs its AI permission. | Every connector route needs `manage_settings`, as all assistant configuration does. |
| No limit. | At most 100 connectors (the list shows 100). |
| The OAuth tokens get an `expiresAt` and a 5-minute refresh buffer. | The tokens are stored as the SDK returns them. The SDK refreshes them when the server answers 401. |

## Runtime

| operationId | Route | Action | Event |
|---|---|---|---|
| `createQuillsAdminAssistantCopilot` | `POST /assistant/copilot` (conversation or ticket; returns a run) | read | `assistant_run.requested` |
| `getQuillsAssistantRun` | `GET /assistant/runs/{runId}` (own runs only) | read | - |
| `createQuillsAdminAssistantTransform` | `POST /assistant/transform` (provider call in `load`) | read | none: usage row only |
| `recordQuillsCopilotEvent` | `POST /assistant/copilot-events` | read | none: telemetry |
| `listQuillsAssistantPendingActions` | `GET /assistant/pending-actions` | read | - |
| `getQuillsAssistantPendingAction` | `GET /assistant/pending-actions/{actionId}` | read | - |
| `approveQuillsAssistantAction` | `POST /assistant/pending-actions/{actionId}/approve` | update | the tool's change event, or `assistant_action.approved` |
| `rejectQuillsAssistantAction` | `POST /assistant/pending-actions/{actionId}/reject` | update | `assistant_action.rejected` |

A run lives in `kv_store` for a day. The worker records `assistant_run.completed`, so clients
reload on `QUILLS_CHANGED` or poll. A run still pending after 30 minutes reads as failed (its
job was lost or ran out of attempts). The copilot is not streamed.

## Suggestions and feedback AI

| operationId | Route | Action | Event |
|---|---|---|---|
| `getQuillsMergeSuggestionsForPost` | `GET /posts/{postId}/merge-suggestions` | read | - |
| `fetchQuillsMergeSuggestionSummary` | `GET /merge-suggestions/summary` | read | - |
| `fetchQuillsMergeSuggestionCountsForPosts` | `GET /merge-suggestions/counts?postIds=` (≤ 100) | read | - |
| `acceptQuillsSuggestion` | `POST /suggestions/{suggestionId}/accept` (`mergePosts`, shared with `mergeQuillsPost`) | update | `post.merged` |
| `dismissQuillsSuggestion` | `POST /suggestions/{suggestionId}/dismiss` | update | `merge_suggestion.dismissed` |
| `restoreQuillsSuggestion` | `POST /suggestions/{suggestionId}/restore` | update | `merge_suggestion.restored` |
| `retryQuillsPostMergeCheck` | `POST /posts/{postId}/merge-check` (409 without an embedding model) | update | `post.merge_check_requested` |
| `listQuillsSimilarPosts` | `GET /posts/{postId}/similar` (stored embeddings; no provider call) | read | - |
| `getQuillsPostSentiment` | `GET /posts/{postId}/sentiment` | read | - |
| `requestQuillsPostSentiment` | `POST /posts/{postId}/sentiment` | update | `post.sentiment_requested` |
| `requestQuillsPostTagBackfill` | `POST /posts/ai-tags/backfill` (≤ 30 posts) | update | `post.tags_backfill_requested` |
| `requestQuillsEmbeddingBackfill` | `POST /assistant/embeddings/backfill` | manage_settings | `assistant.embeddings_requested` |

## Support and help-center AI

| operationId | Route | Action | Event |
|---|---|---|---|
| `requestQuillsConversationSummary` | `POST /conversations/{conversationId}/summary` | update | `conversation.summary_requested` |
| `requestQuillsTicketSummary` | `POST /tickets/{ticketId}/summary` | update | `ticket.summary_requested` |
| `getQuillsTicketSummary` | `GET /tickets/{ticketId}/summary` | read | - |
| `translateQuillsConversationMessages` | `POST /conversations/{conversationId}/messages/{messageId}/translate` (run) | read | `assistant_run.requested` |
| `draftQuillsAttributeDescriptions` | `POST /conversation-attributes/description-draft` (provider call in `load`) | manage_settings | none: usage row only |
| `previewQuillsAttributeDetection` | `POST /conversation-attributes/{attributeId}/detection-preview` (run; writes nothing to the conversation) | manage_settings | `assistant_run.requested` |
| `suggestQuillsTicketFieldValues` | `POST /tickets/{ticketId}/field-suggestions` (run; writes nothing to the ticket) | read | `assistant_run.requested` |
| `requestQuillsArticleTranslation` | `POST /help-center/articles/{articleId}/auto-translate` (enabled locale) | update | `help_center.article_translation_requested` |
| `searchQuillsHelpCenterSemantic` | `POST /help-center/semantic-search` (query embedded in `load`) | read | none: usage row only |

## Analytics (read)

| operationId | Route |
|---|---|
| `getQuillsQuinnPerformance` | `GET /assistant/analytics/performance?from&to` (≤ 366 days) |
| `getQuillsQuinnToolMetrics` | `GET /assistant/analytics/tools?from&to` |
| `getQuillsCopilotUsageMetrics` | `GET /assistant/analytics/copilot?from&to` |

## Widget (audience widget, `/quills-public/{workspace}`)

| operationId | Route | Notes |
|---|---|---|
| `createQuillsWidgetKbAsk` | `POST /widget/kb-ask` | Widget session; 10 per 10 minutes per IP; returns a run. |
| `getQuillsWidgetKbAsk` | `GET /widget/kb-ask/{runId}` | The asking visitor only. |

The answer reads only articles published by now in public categories with no segment gate on
the article or its category, snippets with audience `public`, and documents and fetched web
pages (customer-answerable by design, as in the source) when the customer agent's `documents`
knowledge setting is on.

## Worker (`quills.ai`, `jobs/handlers/ai.ts`)

`jobs/fanout.ts` maps each event below to `quills.ai`; `assistant/engine/index.ts` runs it.
`jobs/worker.ts` drains `quills.ai` in its own loop (one at a time per process); the delivery
pass that the scheduler awaits never claims it, so a slow provider does not delay
`QUILLS_CHANGED`, mail or webhooks.

| Event | Work |
|---|---|
| `assistant_run.requested` | Answers the run (copilot, translation, attribute preview, ticket fields, widget answer). |
| `assistant_web_source.added` | Fetches the page through `createGuardedFetch` (1 MB, 10 seconds) and stores its text. |
| `assistant.embeddings_requested` | Embeds up to 32 posts and 32 articles without an embedding. |
| `post.created`, `post.merge_check_requested` | Embeds the post and stores pending suggestions for likely duplicates (similarity ≥ 0.85, model confidence ≥ 0.7); a pair that already has a suggestion in any status is skipped. |
| `post.sentiment_requested` | Stores the post's sentiment. |
| `post.tags_backfill_requested` | Adds existing tags (`auto_tagged`) and records `post.tags_changed` as the requester, who must still hold `update`. |
| `conversation.summary_requested`, `ticket.summary_requested` | Writes the summary; records `conversation.summarized` / `ticket.summarized`. |
| `help_center.article_translation_requested` | Writes a draft translation. A published translation is never replaced; protected terms stay as they are. |
| `help_center.article_published` | Embeds the article; translates into every enabled locale when the publish recorded `autoTranslate: requested`. A failed locale is skipped and the others are kept. |

The write and the job's completion share one transaction. A background provider failure
retries (three attempts); a run's failure is stored on the run. Each job starts no provider
call after three minutes, so it ends inside its lease.

## Migration

`drizzle/quills/0017_assistant_queue.sql` adds `quills.ai` to `quills.runnable_workspaces`.
No table changes.

## Not ported, or ported in part

| Item | Status | Reason |
|---|---|---|
| Copilot streaming (AG-UI SSE) | Not ported | A provider call cannot run inside the request transaction, and the framework has one transaction per request. The copilot is a run that the worker answers. A two-phase declaration (read, call, write) is a framework change. |
| Workspace assistant threads | Not ported | The source retired them (`workspace-assistant.ts`: nothing creates or reads these threads). |
| Customer-facing agent (Quinn in conversations), involvements, inbox assistant counts and activity | Not ported | Needs the conversation reply pipeline and channel delivery; the analytics routes read the existing tables. |
| Connector tools in the copilot | Not ported | No RFC 0001 entry point runs them. A tool call reaches a user URL, so it needs a network step in the worker's tool loop and in approval. Connector `assignments` and `toolPolicies` are stored only. |
| Imported connector secrets | Unreadable | The source sealed them with its own key. A refresh then answers `Authorization required`: enter the bearer token again, or authorize again. |
| Document upload of an original file, PDF text extraction | Not ported | Needs a PDF parser dependency and a new `framework/files.ts` purpose. Documents take text or Markdown. |
| Widget assistant deployment | Not ported | Widget slice. |
| Slack assistant | Ported in part | Settings, the event hook and one threaded answer: `integrations/ROUTES-OAUTH.md`, "Agent channels". |
| `my_tone` transform | Not ported | Needs a read of the teammate's replies before the provider call. |
| Feedback posts as a copilot read tool | Not ported | Needs a project-visibility read for the requester inside the worker. |
| `searchQuillsWorkspace` (Ask search) | Not ported | Not in this slice's list. |
| Pending-action expiry sweep | Not ported | An expired action returns 409 on decision; its stored status stays `proposed`. |
| Usage rows for a failed `load` call (transform, draft, semantic search) | Not logged | `load` has no transaction; a failed call returns 502 and writes nothing. |
| API-key scope in the worker | Partial | A request's handler cannot see the API key, so the worker checks the requester's role, not the key's scope. A read-only key can lead to a proposal; approval still checks the approver's role and key scope. |
| Snippet and document embeddings | Not ported | No retrieval reads them yet; `search_knowledge` matches words. Imported embeddings are kept and cleared on edit. |
| Knowledge settings `posts`, `pastConversations`, `tickets`, `changelog`, `status` | Stored only | No retrieval source reads them yet. |
| Copilot guidance | Partial | The first 20 enabled copilot rules, by priority, reach the prompt. |
