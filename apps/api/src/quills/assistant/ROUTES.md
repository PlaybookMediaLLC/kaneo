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
refresh and authorize a connector. `connector-client.ts` is the MCP client. The copilot calls
connector tools (see "Connector tools").

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

## Connector tools (follow-up FU2)

The teammate copilot calls the tools of the workspace's connectors. Modules:
`connector-tools.ts` (names, policies, input schemas; shared by the worker and the approval
route), `engine/connector-calls.ts` (the calls, their records and the approved-action work) and
`connector-client.ts` (`callTool`). Feature tests: `connector-tools.test.ts`.

### Surfaces

| Surface | Tools today | Connector tools |
|---|---|---|
| Teammate copilot (`engine/copilot.ts`) | The only tool loop: built-in read tools run, write tools propose. | Yes: connectors with `assignments.copilot`, in conversation and ticket turns. |
| Other runs (translation, attribute preview, ticket fields, widget answer) | One provider call, no tools. | No. |
| Slack answers (`engine/slack.ts`) | One provider call, no tools. | No. |
| Customer-facing agent | Not ported. | No. `assignments.agent` stays stored only. |
| Workflows | No provider call. | No. |

### Boundary map

```
Tables and owning schema:  quills: connectors (read; the call writes last_call_at, last_error,
                           error_count and rotated secrets), assistant_tool_calls,
                           assistant_pending_actions, events, audit_log, job_queue. public: none
                           (the worker reads the requester's and the approver's role through
                           framework/platform-reads.ts, as the copilot does).
Actor and workspace:       the job's workspace (withQuillsSystemWorkspace). The actor is the run's
                           requester, or the approver of an approved action. Never a tool result.
Permissions:               a read-group tool needs quills:read (the copilot's action). A write-group
                           tool, and every proposal, needs quills:update now. Approval needs
                           quills:update (the route), and the worker checks it again.
Persisted relationships:   the connector ID in the pending action's arguments, read again in the
                           caller's or the job's workspace.
Transactions:              a connector call never runs in a transaction. Each call: claim (a
                           `started` tool-call row) in one transaction, the call with none open,
                           then the record in a new one. The approval route only decides.
External effects:          MCP initialize and tools/call through `callTool`: the guarded fetch, one
                           deadline for the step, answers of at most 1 MB, the OAuth refresh of the
                           SDK on 401 (once). Connector credentials only: no Kaneo session, API key
                           or ID goes to the server beyond the arguments that the model made.
```

### The loop and its limits

The copilot loop runs in the `quills.ai` worker (`answerCopilot`): at most 4 provider calls and 5
tool calls for each. Connector tools join the built-in tools under these limits:

| Limit | Value |
|---|---|
| Connector tools offered in a run | 32, with at most 40,000 characters of descriptions and schemas in all (connectors by name, tools in catalogue order; a tool that does not fit is skipped) |
| Tool name | `connector_<slug>__<tool>`, at most 64 characters of `[A-Za-z0-9_-]`. A tool name that does not fit gets a cut and an 8-character hash. A name that is already offered is skipped. |
| Tool description to the model | the connector's name and at most 500 characters of the server's text |
| Arguments | a JSON object of at most 8,000 characters, valid for the tool's stored input schema |
| Connector calls that reach the network in a run | 5 |
| Time for all connector calls of a run | 30 seconds of call time (the provider's time does not count); each call has at most 10 seconds and the time that is left; no call starts with less than 1 second left |
| Answer from the server | 1 MB (the client) |
| Result text to the model | 8,000 characters; then `[truncated]` |

The input schema is the stored one (C1 drops a schema over 20,000 characters). The worker makes a
copy whose checks cost work in proportion to its size:

- It removes `pattern` and `patternProperties`: a server's regular expression must not block the
  worker.
- It removes a repeated `type` entry: zod converts the node again for each entry.
- It replaces each local `$ref` with a copy of its target: zod checks a shared target again for
  each use. A remote reference or an anchor is refused.
- It refuses a copy of more than 5,000 nodes or 32 levels (also a reference cycle), a schema that
  is not an object, and a schema that the converter cannot read.

A tool without a usable schema is not offered. The converter gets a registry of its own, so an
`id` in a server's schema does not stay in memory.

### Policies

`toolPolicies` from C1: a per-tool override, else the default of the tool's group.

1. The group is `read` only when the stored annotations say `readOnlyHint` and not
   `destructiveHint`. Any other tool is `write`.
2. A policy value that is not `always`, `approval` or `never` counts as `approval`.
3. `never`: the tool is not offered, and a call to it is denied.
4. `always`, read group: the tool runs in the loop.
5. `always`, write group: the tool runs in the loop only when the requester holds `update`.
6. `approval`: the call becomes a pending action when the requester holds `update`. Otherwise it is
   denied. The default for the write group is `approval`.
7. A connector offers tools only when it is `enabled`, its status is `connected`, and
   `assignments.copilot` is true. A disabled or errored connector offers nothing.
8. New tools: the worker offers only the stored catalogue. A tool that the server added after the
   last refresh is unknown and cannot run. A manager's refresh adds it with its group's default.

### Untrusted text

- A tool result goes to the model in a `tool` message, inside `<tool_result>` with the
  `untrusted()` note. It is never part of the system message. NUL and lone surrogates become
  U+FFFD. A server error (`isError`) and a failed call return fixed text, never the server's text.
- `untrusted()` changes each closing tag of its label in the text (any case or spacing) to
  `<\/label>` in one pass, so the text cannot close the block early. This also protects the
  thread and the other wrapped texts.
- A result cannot change the run: the workspace, the actor, the tool list and the policies are
  fixed before the first provider call. A tool that the result names is still checked against the
  list, and the worker fetches no URL from a result. Each call checks again that its connector is
  enabled, connected and assigned to the copilot, so a connector that a manager turns off gets no
  more calls from a run in progress.
- Tool names and descriptions come from the server: they are namespaced, bounded, and cannot match
  a built-in tool (built-in names never start with `connector_`).

### Approval

1. The copilot stores a pending action (`originRole` `copilot_qa`). Its tool name is the offered
   name. Its arguments are `{connectorId, tool, arguments}`. Its summary names the connector and
   the tool and shows all the arguments (at most 8,000 characters), so the approver sees each
   value that will run.
2. `approveQuillsAssistantAction` (update) checks in its transaction that the connector is in this
   workspace and still offers the tool with a policy other than `never`, and that the arguments fit
   the current schema. It sets the action `approved` and records `assistant_action.approved`. It
   reaches no network. Otherwise it answers 409.
3. `assistant_action.approved` goes to the `quills.ai` worker. The worker acts only on an
   `approved` connector action. It checks the approver's `update` and the connector again, claims
   the call (tool-call key `action:<actionId>`), calls once, and sets the action `executed` or
   `failed` (`result`: `{ok}` only) with `assistant_action.completed`.
4. A second approval answers 409. A repeated job reads the claim first, before any check that may
   have changed since, and never calls again: it copies the recorded outcome, or sets `failed`
   when the outcome is unknown (the worker stopped during the call; the tool-call row stays
   `started`).

### Records

Each connector call writes one `assistant_tool_calls` row: the offered tool name, the status, a
fixed summary, a failure kind in `error`, the duration, the principal, the conversation, the
pending action, and in `args` only `{connectorId, argsBytes, resultBytes}`. A built-in tool's row
keeps the model's arguments (a search query or a status) and never a result. A connector tool's
arguments go to an outside service and can hold any text from the thread, so its row keeps their
size only. The pending action keeps the arguments, as a built-in proposal does: the approval needs
them.

The call key is `<runId>:connector:<hash of name and arguments>:<repeat>`, where `<repeat>`
counts the same call in this attempt. The model can call the same tool with the same arguments
again in one run, and a repeated job attempt that makes the same calls skips the ones that ran. The connector row gets `last_call_at`,
and on a failure a fixed `last_error`. Rotated OAuth tokens are stored only when the stored secrets
did not change during the call and the new secrets still hold tokens (C1's rule). These health
fields record no event.

An import (`transfer/import-archive.ts`) turns each imported connector off (`enabled` false), as
it pauses webhooks and integrations: it sends no thread text until a manager here enables it.

### Events

| Event | Recorded by |
|---|---|
| `assistant_action.completed` (new; payload `status`: `executed` or `failed`) | the worker, when an approved connector action finishes |

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

## Workspace search (RFC 0001, lane G2)

Module: `assistant/search.ts`, ranking helpers in `assistant/search-match.ts`. Feature tests:
`assistant/search.test.ts` (real PostgreSQL, workspaces A and B, a private project).

```
Tables and owning schema:  quills (read only): posts, boards, board_projects, conversations,
                           conversation_messages, ticket_conversations, tickets, kb_articles,
                           changelog_entries, principal, user, companies. public (read only, through
                           framework/platform-reads.ts): project access and the member roster.
Actor and workspace:       authenticated context (helper). Never a body or query copy.
Permissions:               workspace:read + quills:read. No native permissions.
Persisted relationships:   board_projects (a post shows only on a board the caller can see).
Transaction:               one scoped transaction. The projects and the roster are read in `load`.
External effects:          none. No provider call.
Completion checks:         authenticated endpoint, tenant/object access, read/search/export.
```

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `searchQuillsWorkspace` | `GET /search` (`q` ≤ 200, `kind`, `offset` ≤ 100, `limit` ≤ 50) | read | as the boundary map | - |

Each kind applies the visibility rule of its own list in the `WHERE` clause, before its `LIMIT`:

| Kind | Rule (reused helper) | Matched on |
|---|---|---|
| `post` | `filterConditions` of the posts list: live, not merged, no test author, a live board the caller can see | full text, or the title contains the query |
| `conversation` | the inbox list: `realConversation` and `notSpam` | the subject, or a live message (notes too) |
| `ticket` | live, and the requester is not a test customer (`testRequester`, as the inbox) | the title, or a live message on the ticket or its paired conversation |
| `article` | live (drafts too, as `listQuillsHelpCenterArticles`) | full text, or the title |
| `changelog` | live (drafts too, as `listQuillsChangelog`) | full text, or the title |
| `person` | `isCustomer` and identified (as `listQuillsUsers`) | name, display name or email contains the query |
| `teammate` | the teammate principal of a current member (as `listQuillsPrincipals`) | display name contains the query |
| `company` | every company (as `listQuillsCompanies`) | name or domain contains the query |

Ranking follows the source: score = title tier (3 equal, 2 starts with, 1 contains) + `ts_rank`
normalised under 1. Ties go to the newest update, then kind and ID. Each kind reads its best
`offset + limit + 1` rows, so the merged page and `hasMore` are exact up to 100 results.
A "contains" match needs 3 characters; a query of 2 characters uses full text only, and a shorter
query returns nothing.

Known limit, as in the source and the inbox search: the `@@` and `ILIKE` operators are not leakproof,
so under row security no text index serves them. A search without `kind` reads the workspace's live
messages twice (conversations and tickets) and every subject and title; a `kind` narrows the work to
one query. The excerpt of a message match is read by primary key for the kept rows only.

Differences from the source, on purpose:

- Every kind needs only `quills:read`: Kaneo has no `changelog.view_draft`, `help_center.manage`,
  `people.view`, `member.view` or `company.view` split (D2). Drafts are found, as in the lists.
- No product flag narrows the kinds. No Kaneo teammate route checks a product flag.
- Results carry no `href`: Kaneo's web app has no Quills pages yet. The client builds links from
  `kind` and `id`.
- Teammates match on the display name only and return no email, as `listQuillsPrincipals`.
- Full text uses `websearch_to_tsquery('english')`, as the Kaneo lists, not the source's own parser.
- No meaning (semantic) matches: the `semantic` option is not offered. It needs an embedding call in
  `load` and vector reads for each kind.

## Migration

`drizzle/quills/0017_assistant_queue.sql` adds `quills.ai` to `quills.runnable_workspaces`.
No table changes.

## Not ported, or ported in part

| Item | Status | Reason |
|---|---|---|
| Copilot streaming (AG-UI SSE) | Not ported | A provider call cannot run inside the request transaction, and the framework has one transaction per request. The copilot is a run that the worker answers. A two-phase declaration (read, call, write) is a framework change. |
| Workspace assistant threads | Not ported | The source retired them (`workspace-assistant.ts`: nothing creates or reads these threads). |
| Customer-facing agent (Quinn in conversations), involvements | Not ported | Needs the conversation reply pipeline and channel delivery; the analytics routes, the inbox assistant counts and the conversation activity read the existing tables (`support/CONVERSATIONS.md`). |
| Connector tools outside the copilot | Not ported | Only the copilot has a tool loop (see "Connector tools"). `assignments.agent` is stored only. The result of an approved connector call is not shown: the run already ended. |
| Imported connector secrets | Unreadable | The source sealed them with its own key. A refresh then answers `Authorization required`: enter the bearer token again, or authorize again. |
| Document upload of an original file, PDF text extraction | Not ported | Needs a PDF parser dependency and a new `framework/files.ts` purpose. Documents take text or Markdown. |
| Widget assistant deployment | Not ported | Widget slice. |
| Slack assistant | Ported in part | Settings, the event hook and one threaded answer: `integrations/ROUTES-OAUTH.md`, "Agent channels". |
| `my_tone` transform | Not ported | Needs a read of the teammate's replies before the provider call. |
| Feedback posts as a copilot read tool | Not ported | Needs a project-visibility read for the requester inside the worker. |
| Pending-action expiry sweep | Not ported | An expired action returns 409 on decision; its stored status stays `proposed`. |
| Sweep of approved connector actions | Not ported | When the worker job fails three times before it claims the call (for example a database outage), the action stays `approved`: approve and reject answer 409, and nothing runs it. |
| Usage rows for a failed `load` call (transform, draft, semantic search) | Not logged | `load` has no transaction; a failed call returns 502 and writes nothing. |
| API-key scope in the worker | Partial | A request's handler cannot see the API key, so the worker checks the requester's role, not the key's scope. A read-only key can lead to a proposal; approval still checks the approver's role and key scope. |
| Snippet and document embeddings | Not ported | No retrieval reads them yet; `search_knowledge` matches words. Imported embeddings are kept and cleared on edit. |
| Knowledge settings `posts`, `pastConversations`, `tickets`, `changelog`, `status` | Stored only | No retrieval source reads them yet. |
| Copilot guidance | Partial | The first 20 enabled copilot rules, by priority, reach the prompt. |
