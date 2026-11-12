# RFC 0001: Port the remaining Quackback server capabilities

| Field | Value |
|---|---|
| Status | Accepted. The owner decided D7 to D11 on 2026-11-11 (section 3). Lane Z merged the eleven lanes into `feat/quills-131-integration` (section 13). The settings undo is pending. |
| Issue | [#131](https://github.com/PlaybookMediaLLC/kaneo/issues/131) (76 entry points) |
| Target | `apps/api/src/quills` in this repository |
| Reference | `../quackback/apps/web/src` at commit `42ef2e01` (read-only) |
| Executors | 13 subagents. Model: Opus 5. Effort: high. One git worktree for each agent. |
| Base branch | `staging` |

## 1. Summary

The Quills port (#128) left 76 Quackback entry points without a Kaneo route.
This RFC divides them into 11 implementation lanes, one seam lane and one integration lane.
Each lane has one agent, one branch and one pull request into `staging`.

| Group | Entry points | Result of this RFC |
|---|---|---|
| Assigned to a lane | 73 | Kaneo routes with contract fixtures |
| Blocked by a product decision (#129) | 1 | Not built. The widget handoff stays open. |
| Web-only (#130) | 2 | Not built. The header setters belong to the portal pages. |

## 2. Rules for every lane

The contract in [`apps/api/AGENTS.md`](../../apps/api/AGENTS.md) is mandatory. These rules add the parallel-work limits.

1. Read `apps/api/AGENTS.md`, [`framework.md`](framework.md) and the nearest `ROUTES.md` before you write code.
2. Write the boundary map first. Put it in the slice's `ROUTES.md` and in the pull request description.
3. Declare each route with `defineQuillsRoute`. Add a sibling `*.fixture.ts`.
4. Use one scoped transaction for each change. Call `recordQuillsChange` in the same transaction.
5. Never call a provider or fetch a URL inside a transaction. Use `prepare`, `call`, then the handler.
6. Use `createGuardedFetch` from `apps/api/src/import/guarded-fetch.ts` for each URL that comes from user input.
7. Do not read the Quackback repository as a runtime dependency. Adapt the code into this checkout.
8. Do not edit a file that another lane owns (section 5).
9. Do not run `pnpm --filter @kaneo/api db:generate:quills`. Only lane Z generates migrations (section 6).
10. Do not commit `apps/docs/openapi.json` conflicts by hand. Regenerate with `pnpm openapi:check:fix`.
11. Do not push, merge or open a pull request. Lane Z does that after the owner approves.

### Evidence that each lane must give

Run these commands from the repository root. Set `QUILLS_TEST_DATABASE_URL` to a disposable database named `quills_*`.

```sh
pnpm --filter @kaneo/api test:quills
pnpm --filter @kaneo/api typecheck
pnpm --filter @kaneo/api build
pnpm openapi:check:fix
pnpm exec vp check
```

The completion report must contain:

- The boundary map.
- Each command and its result. Report a skipped database test as skipped, not as passed.
- The contract findings for each new route: `registered`, `denied-action`, `api-key-scope`, `foreign-ids`, `strict-response`, `rollback`, `bounded-inputs`.
- The ledger rows that the lane closed (source path and function name).
- The behavior differences from the source, for the `ROUTES.md` "differences" table.
- The Feature Flow review verdict.

## 3. Decisions

The owner decided these on 2026-11-11. No lane waits for a decision.

| # | Question | Decision |
|---|---|---|
| D7 | Decision D6 said "providers by demand". Do we now port all 13 providers? | **Port all 13.** Lanes P1 to P4 run. This replaces D6 for the providers in #131. |
| D8 | Live agent presence has no store in Kaneo. Which design? | **Heartbeat rows in `quills.kv_store`** with a 90-second expiry, the same pattern as typing markers. No new table. `agentsOnline` counts unexpired rows. |
| D9 | Which token does a sidebar app present? The source uses a better-auth OAuth client, and Kaneo owns identity. | **A Kaneo API key with `quills` scopes, bound to one `apps` row.** No second token system. The app routes still get a separate audience and separate contract checks, because the caller is an app and not a teammate. |
| D10 | How much of the Slack and GitHub agent runtime do we port? | **The settings routes, the hook route and the worker handler** that each setting turns on. |
| D11 | Where do settings receipts live? | **In the settings write itself.** A settings write records its receipt (the before and after values) in the metadata of its own audit row, as the source does (`settings-registry/undo.ts` reads `audit_log` rows of type `settings.applied`). No new table and no migration. |

Rules that follow from D11:

- Each settings area declares an allowlist of the fields that a receipt can hold. A secret, a token or a credential never enters a receipt.
- Undo finds the receipt by its audit row ID in the caller's workspace. It refuses when a later write changed the same setting.
- Undo writes a new audit row (`settings.undone`). It does not edit the receipt row: audit history is append-only.

### Decisions for lane X1 (design review, 2026-11-11)

The design step found that decision D9 does not fit the current schema. The owner decided these four points.

| # | Question | Decision |
|---|---|---|
| D12 | `apps.oauth_client_id` is `NOT NULL` with a foreign key to `oauth_client`. How does an app row bind to an API key? | **Add a nullable column `apps.api_key_id`**, with a partial unique index on `(workspace_id, api_key_id)`. Make `oauth_client_id` nullable. Add `apps` to `OMITTED_TABLES` in `transfer/archive.ts`. This is the one migration of this RFC. |
| D13 | No route creates, binds or disables an app. | **Lane X1 adds three teammate routes** with `manage_settings`: list, create and update, under `/app-registrations`. They are outside the 7 entry points of #131. |
| D14 | No product path creates an API key with `quills` scopes. | **The create route mints the scoped key** and returns its secret one time. Kaneo's general API-key flow does not change. |
| D15 | A bound key could still call teammate routes within its scopes. | **Confine it.** A teammate route refuses a key that has an active app binding in the path workspace (403 `APP_KEY_CONFINED`). |

The full design is in `apps/api/src/quills/apps/ROUTES.md` on the X1 branch.

Not decided here: the widget handoff. It stays with #129.

## 4. Lanes

Each lane names its source files, its target files and its special risks.
Source paths are relative to `../quackback/apps/web/src`. Target paths are relative to `apps/api/src/quills`.

### Wave 0: one agent, before all other lanes

#### Lane S0: seams for parallel work (0 entry points)

Purpose: change the shared files once, so that later lanes add files and do not edit the same lines.

| Step | Change |
|---|---|
| 1 | Move each entry of `oauthProviders` in `integrations/oauth-providers.ts` to `integrations/providers/<name>.ts`. Keep one `integrations/providers/index.ts` that collects them. |
| 2 | Replace the four `startConnect("...")` lines in `integrations/oauth.ts` with a loop over the provider registry. |
| 3 | Add two optional capabilities to the `OAuthProvider` type: `contact` (CRM lookup by email) and `connectWithKey` (Azure DevOps uses a personal access token, not OAuth). |
| 4 | Add every event type and entity type from section 7 to the enums in `events.ts`, in one commit. |
| 5 | Add one heading for each provider in `integrations/ROUTES-OAUTH.md`. Each provider lane fills only its own heading. |
| 6 | Add an empty `capabilities` entry list for this RFC in `docs/quills-port/ledger/overrides.json`. Only lane Z edits it later. |

Acceptance: no route, operation ID or response changes. `pnpm openapi:check` reports no difference. The contract suite passes with the same route count (679).

### Wave 1: eleven agents in parallel, after S0 merges

#### Lane P1: issue trackers I (8 entry points)

| Provider | Entry points | Source |
|---|---|---|
| Jira | `getJiraConnectUrl`, `fetchJiraProjectsFn`, `fetchJiraIssueTypesFn` | `integrations/jira/server` (1,433 lines) |
| Linear | `getLinearConnectUrl`, `fetchLinearTeamsFn` | `integrations/linear/server` (1,115 lines) |
| Azure DevOps | `connectAzureDevOpsFn`, `fetchAzureDevOpsProjectsFn`, `fetchAzureDevOpsWorkItemTypesFn` | `integrations/azure-devops/server` (1,015 lines) |

Target: `integrations/providers/{jira,linear,azure-devops}.ts` and their fixtures.
Path: reuse the P7b model. Connect URL becomes `GET /oauth/{type}/connect`. Project, team and type lists become `GET /integrations/{integrationId}/destinations` with a `kind` query value.
Risks: Jira uses a cloud ID in each API path, so build the host from the stored cloud ID and never from user input. Azure DevOps takes an organization name from the user; validate it against a strict pattern before it enters a URL.

#### Lane P2: issue trackers II (12 entry points)

| Provider | Entry points | Source |
|---|---|---|
| Asana | `getAsanaConnectUrl`, `fetchAsanaProjectsFn` | `integrations/asana/server` (947 lines) |
| ClickUp | `getClickUpConnectUrl`, `fetchClickUpSpacesFn`, `fetchClickUpListsFn` | `integrations/clickup/server` (918 lines) |
| Trello | `getTrelloConnectUrl`, `fetchTrelloBoardsFn`, `fetchTrelloListsFn` | `integrations/trello/server` (891 lines) |
| Monday | `getMondayConnectUrl`, `fetchMondayBoardsFn` | `integrations/monday/server` (660 lines) |
| Notion | `getNotionConnectUrl`, `fetchNotionDatabasesFn` | `integrations/notion/server` (672 lines) |

Target: `integrations/providers/{asana,clickup,trello,monday,notion}.ts` and their fixtures.
Path: the same as lane P1. ClickUp lists and Trello lists are child destinations: the parent ID is a query value, and the handler checks that the parent is a destination of the same integration.
Risk: Trello uses OAuth 1.0a style token return in a URL fragment. Read `lib/server/integrations/oauth-fragment.ts` first.

#### Lane P3: customer context providers (8 entry points)

| Item | Entry points | Source |
|---|---|---|
| HubSpot | `getHubSpotConnectUrl`, `searchHubSpotContactFn` | `integrations/hubspot/server` |
| Intercom | `getIntercomConnectUrl`, `searchIntercomContactFn` | `integrations/intercom/server` |
| Zendesk | `getZendeskConnectUrl`, `searchZendeskUserFn` | `integrations/zendesk/server` |
| Salesforce | `getSalesforceConnectUrl` | `integrations/salesforce/server` |
| Customer context | `fetchCustomerContextFn` | `lib/server/functions/customer-context.ts`, `lib/server/integrations/context.ts` |

Target: `integrations/providers/{hubspot,intercom,zendesk,salesforce}.ts`, `integrations/customer-context.ts` and fixtures.
Path: the three search functions become one route, `GET /integrations/{integrationId}/contacts?email=`, through the `contact` capability. Customer context becomes `GET /people/{principalId}/context`. It reads each connected context provider, and Freshdesk and Stripe, which `integrations/ROUTES.md` deferred to this view.
Risks: Zendesk and Salesforce use a customer subdomain or instance URL in the host. Validate it against the provider's domain suffix. A context response contains third-party personal data: select the fields and bound the size.

#### Lane P4: Microsoft Teams (3 entry points)

Entry points: `getTeamsConnectUrl`, `fetchTeamsTeamsFn`, `fetchTeamsChannelsFn`. Source: `integrations/teams/server` (934 lines).
Target: `integrations/providers/teams.ts` and fixture.
Path: the same as lane P1. Channels are child destinations of a team.
Risk: `ROUTES-OAUTH.md` records that Graph channel messages need tenant admin consent and a bot registration. Write the consent flow into the boundary map before code. If app-only Graph permissions are necessary, stop and report: that is a new credential model.

#### Lane C1: MCP connectors (6 entry points)

Entry points: `createConnectorFn`, `getConnectorFn`, `updateConnectorFn`, `refreshConnectorFn`, `startConnectorOAuthFn`, `routes/oauth/connector.callback.ts#GET`.
Source: `lib/server/functions/assistant-connectors.ts`, `lib/server/domains/assistant/connectors/` (1,153 lines).
Target: extend `assistant/connectors.ts`; add `assistant/connector-client.ts` and fixtures.
Path:
- The table `quills.connectors` exists. Kaneo already lists and deletes connectors.
- Use `@modelcontextprotocol/sdk`, which `apps/api` already installs. Add no dependency.
- The callback is a signed public route. Reuse `mintOAuthState` and the `oauthState` verifier in `framework/signed.ts` with a new provider value.
- The connector URL comes from the user. Every request to it goes through `createGuardedFetch`.
Risks: connector tools run with the assistant's authority. A tool result is untrusted text; do not let it choose a workspace, an actor or a permission. Seal tokens as `integrations.secrets` does. Never return them.

#### Lane G1: agent channels (7 entry points)

| Item | Entry points | Source |
|---|---|---|
| Slack assistant | `getSlackAgentSettingsFn`, `setSlackAssistantEnabledFn` | `integrations/slack/server/agent/` |
| GitHub agent inbox | `getGitHubChannelStatusFn`, `setGitHubInboxEnabledFn`, `retryGitHubAgentMessageFn` | `integrations/github/server/functions.ts`, domains `channel-accounts` and `channels` |
| Inbound hooks | `routes/api/integrations/$type/hooks/$kind.ts#POST` | `lib/server/integrations/app-hook-handler.ts`, `slack-hook-queue.ts` |
| Identify | `routes/api/integrations/$type/identify.ts#POST` | `lib/server/integrations/user-sync-handler.ts` |

Target: `assistant/slack-agent.ts`, `support/github-inbox.ts`, extend `integrations/inbound.ts`, and fixtures.
Path: the hook and identify routes are signed public routes. Add one `SignedVerifier` for each provider signature. The worker handles the event after commit, with a delivery ID for deduplication.
Risks: this is the largest lane (Slack `handler.ts` is 720 lines). A retry must not post a second Slack or GitHub message: store the delivery receipt before the send and reconcile an uncertain outcome. If the lane exceeds one reviewable pull request, divide it into Slack and GitHub and report that.

#### Lane G2: assistant surface (4 entry points)

Entry points: `startAgentConversationFn`, `fetchAssistantInboxCountsFn`, `getConversationAssistantActivityFn` (all in `conversation.ts`), `searchWorkspaceFn` (`ask-search.ts`).
Target: `support/conversation-assistant.ts`, `assistant/search.ts` and fixtures.
Path: counts and search are reads. They must apply the same visibility filter as the inbox list and the board visibility rule, before the count and before the limit.
Risk: an aggregate is a leak path. The fixture must prove that a count excludes private boards and foreign conversations.

#### Lane X1: app sidebar (7 entry points)

Entry points: `routes/api/v1/apps/{boards,link,linked,posts,search,suggest,unlink}`. Source: 487 lines plus two tests.
Target: new folder `apps/` (routes and fixtures); a new `app` audience in `framework/audience.ts`; contract checks in `framework/contract-checks.ts`.
Path:
- Decision D9: the caller presents a Kaneo API key with `quills` scopes, bound to one `apps` row. Ignore the source column `oauth_client_id` as an authority.
- The audience design is reviewed (decisions D12 to D15). Put it in `apps/ROUTES.md` and implement it.
- Write the Drizzle schema change for `apps.api_key_id`. Do not generate SQL: lane Z does that.
- An app route refuses an unscoped key and a session with no key.
- The source tests `link-permission.test.ts` and `boards-actor.test.ts` become contract cases.
- The app audience needs its own checks: a disabled app, an app of workspace B, a scope that the app does not hold, and a link target that the app cannot see.
Risk: this lane is the only one that edits `framework/`. It must not weaken an existing check. `contract.self.test.ts` must still fail on a broken route.

#### Lane S1: support extras (6 entry points)

| Entry point | Source | Note |
|---|---|---|
| `getEmbedPreviewFn` | `embeds.ts` (333 lines) | Guarded fetch. Bound the response size. |
| `unfurlLinkFn` | `link-preview.ts` | Guarded fetch. Cache by URL and workspace. |
| `readTogetherFn` | `read-batch.ts` | A batch read. Every element passes its own route's check. |
| `getEmailChannelStatusFn` | `settings.ts` | Read only. Return no credential. |
| `attributeBreakdownFn` | `support-reporting.ts`, domain `attributeValueBreakdown` | Aggregate. Apply the visibility filter first. |
| `getConversationPresenceFn` | `conversation.ts` | Decision D8: heartbeat rows in `kv_store`, 90-second expiry. Add a heartbeat route for teammates. |

Target: `support/{embeds,link-preview,read-batch,presence}.ts`, extend `support/support-reporting.ts` and `support/support-settings.ts`, and fixtures.
Risk: `readTogetherFn` can become a permission bypass. It must call the same handlers and the same checks as the single routes, and it must bound the batch size.

#### Lane B1: website auto-branding (6 entry points)

Entry points: all six functions in `website-branding.ts`.
Source: `lib/server/domains/assistant/automatic-website-branding.{service,state,actions,availability}.ts` (715 lines).
Target: `settings/website-branding.ts` and fixture; reuse `settings/branding.ts` for the write.
Path: `lookup` and `start` fetch a customer site through `createGuardedFetch`, outside a transaction. `accept`, `decline` and `undo` are mutations with events. Keep the previous branding values so that `undo` restores them.
Risks: the fetched page is untrusted. Bound the size and the redirect count, and accept only image types for a logo. A stored logo goes through the shared storage lifecycle.

#### Lane M1: smaller items (6 entry points)

| Entry point | Source | Target |
|---|---|---|
| `getPublicUserProfileFn`, `getProfileTeamContextFn` | `public-profile.ts` | `portal/public-profile.ts` (portal audience) |
| `receipts.$receiptId.undo.ts#POST` | domain `settings-registry` (628 lines) | `settings/receipts.ts`, and the receipt write in each `settings/*.ts` mutation (decision D11); replaces the "not ported" row in `directory/ROUTES.md` |
| `getCompanyActivityFn` | `companies.ts` | extend `directory/companies.ts` |
| `deleteTestConversationsFn` | `test-customer.ts` | `support/test-conversations.ts` |
| `topViewedChangelogsFn` | `changelog.ts`, domain `listTopViewedChangelogs` | extend the changelog reporting route |

Risks: a public profile must expose only public fields and must respect the portal gate. `deleteTestConversations` must delete only rows that carry the test marker, in the caller's workspace, in one transaction. Settings undo must check that the receipt belongs to the workspace and that the setting did not change again after the receipt. A receipt holds only allowlisted fields.

### Wave 2: one agent, after the lanes report

#### Lane Z: integration (0 entry points)

| Step | Action |
|---|---|
| 1 | Merge the lane branches in the order of section 8. Rebase each one on `staging` first. |
| 2 | Generate the Quills migration for D12 with `pnpm --filter @kaneo/api db:generate:quills`. Inspect the SQL. Confirm that no other lane changed `src/database/quills/schema`. |
| 3 | Run `pnpm openapi:check:fix` after each merge. Inspect the new operations. |
| 4 | Mark each closed ledger row in `docs/quills-port/ledger/overrides.json`. Rebuild with `node scripts/quills-port/build-ledger.mjs ../quackback`. |
| 5 | Update the parity numbers in `docs/quills-port/README.md` and in issue #131. |
| 6 | Run the full evidence commands and `node scripts/quills-port/check-upstream.mjs`. |
| 7 | Run the Feature Flow review team. Report the verdict to the owner. Do not merge without approval. |

## 5. File ownership

A lane edits only its own files. A shared file has one owner.

| File or folder | Owner |
|---|---|
| `integrations/oauth-providers.ts`, `integrations/oauth.ts`, `integrations/providers/index.ts`, `events.ts` | S0 only. After S0, a lane that needs a change reports it to lane Z. |
| `integrations/providers/<name>.ts` | The lane of that provider |
| `framework/**` | X1 only |
| `integrations/inbound.ts` | G1 only |
| `assistant/connectors.ts` | C1 only |
| `support/support-reporting.ts`, `support/support-settings.ts` | S1 only |
| `directory/companies.ts`, `directory/ROUTES.md`, `settings/*.ts` (receipt writes) | M1 only. Lane B1 adds `settings/website-branding.ts` and calls `settings/branding.ts` without editing it. |
| `quills/index.ts` (mount lines) | Each lane adds one line. Lane Z resolves the order. |
| `apps/docs/openapi.json`, `ledger/overrides.json`, `drizzle/quills/**`, `scripts/quills-port/seams.json` | Z only |

No lane adds a seam in an upstream file. If a lane needs one, it stops and reports.

## 6. Migrations

This RFC plans one migration: `apps.api_key_id` (decision D12).

- Lane X1 writes the Drizzle schema change. It does not generate SQL.
- Lane Z generates, inspects and tests the migration: fresh startup, concurrent runners, drift rejection.
- The Quills migration history is linear, so no other lane runs `db:generate:quills`.
- Decision D8 uses `kv_store`. Decision D11 uses the audit row of the settings write. Neither needs a migration.
- A lane that finds another schema need stops and reports. It does not add a table.

## 7. Events that lane S0 registers

Lane S0 adds these names to the `events.ts` enums. A lane that needs another name reports it to lane Z.

| Lane | Event types |
|---|---|
| C1 | `assistant_connector.created`, `assistant_connector.updated`, `assistant_connector.refreshed`, `assistant_connector.connected` |
| G1 | `slack_agent.settings_updated`, `github_inbox.settings_updated`, `github_inbox.message_retried`, `integration.hook_received`, `user.identified` (exists) |
| G2 | `conversation.agent_started` |
| X1 | `app.post_linked`, `app.post_unlinked`, `app.post_created`, `app.registered`, `app.updated`; entity type `app` |
| B1 | `branding.auto_started`, `branding.offer_accepted`, `branding.offer_declined`, `branding.auto_undone` |
| M1 | `settings.undone`, `conversation.test_deleted`. The settings writes keep their existing event types; only the audit metadata gains the receipt. |
| S1 | `presence.heartbeat` uses no event: declare `event: false` with the reason "expiring marker". |
| P1 to P4 | None. They reuse `integration.connected` and the P7b events. |

## 8. Order and dependencies

```
S0 ──► P1  P2  P3  P4
   ├─► C1
   ├─► G1
   ├─► G2
   ├─► X1
   ├─► S1
   ├─► B1
   └─► M1
                    all ──► Z
```

Merge order for lane Z: S0, X1 (it changes the framework), C1, G1, G2, S1, B1, M1, P3, P1, P2, P4.

## 9. Agent settings

| Setting | Value |
|---|---|
| Model | Opus 5 (`model: "opus"`) |
| Effort | `high` |
| Isolation | `worktree`, branched from `staging` after S0 merges |
| Agent type | `backend-developer` for S0, P1 to P4, C1, G1, G2, S1, B1, M1 and Z. `api-designer` for the X1 design step, then `backend-developer` for X1 code. |
| Branch name | `feat/quills-131-<lane>`, for example `feat/quills-131-p1` |
| Brief | Section 2, the lane's part of section 4, sections 5 to 7, and the paths of both repositories. A brief must state what the agent must not touch. |

## 10. Risks

| Risk | Control |
|---|---|
| 13 provider APIs change without notice, and no customer uses them yet. | Accepted in decision D7. Each provider is one file, so one provider can be removed alone. |
| Outbound requests reach an internal address. | `createGuardedFetch` for user URLs. Fixed hosts for providers. A fixture with a private address must get a refusal. |
| A retry sends a second external message (Slack, GitHub, Teams). | Delivery receipt before the send, and a reconcile step. Lane G1 tests the lost-lease case. |
| An aggregate or batch read leaks a private record. | Lanes G2 and S1 filter before they count. The fixture proves it with two workspaces and one private board. |
| The app audience weakens the framework. | Design review before code. `contract.self.test.ts` must still catch a broken route. |
| The integration suite has a known deadlock on `TRUNCATE ... CASCADE` between shards. | Not in scope. Lane Z reruns a deadlocked shard and reports it. It does not hide a different failure. |
| The pull requests are large. | One pull request for each lane. Lane G1 divides if necessary. |

## 11. Out of scope

- The widget handoff (#129) and the portal page header setters (#130).
- Segment. Issue #131 does not list it, although `ROUTES-OAUTH.md` defers it with the other providers.
- Web client work in `apps/web`. Each lane exposes its routes through `@kaneo/libs` types only.
- Background-only domain functions (`sentiment`, `summary`). Kaneo has them in `assistant/engine`.

## 12. Completion

This RFC is complete when:

1. The contract suite passes for each new route, on a real PostgreSQL database.
2. `overrides.json` marks 73 capabilities closed, and the ledger builder exits 0.
3. `check-upstream.mjs` prints `PASSED`.
4. Issue #131 has each box ticked, or a note that names the open decision.

## 13. Status after lane Z

Lane Z merged S0 and the eleven lanes into `feat/quills-131-integration`. The route registry has
742 declarations (679 before), and the OpenAPI document has 1,009 operations (940 before). No
existing operation ID changed.

| Lane | Entry points | State |
|---|---|---|
| S0 | 0 | Merged (seams) |
| X1 | 7 | Built, with the migration of decision D12 (`drizzle/quills/0022_eager_gambit.sql`) |
| C1 | 6 | Built |
| G1 | 7 | Built |
| G2 | 4 | Built |
| S1 | 6 | Built |
| B1 | 6 | Built |
| M1 | 6 | Built. The settings receipt undo followed on `feat/quills-131-m1-undo`. |
| P1 | 8 | Built |
| P2 | 12 | 9 built. Trello (3) is deferred: its connect needs the fragment bridge page. |
| P3 | 8 | Built |
| P4 | 3 | Built |

| Entry points of #131 | Count |
|---|---|
| Built | 70 |
| Deferred: Trello connect, boards and lists | 3 |
| Blocked by a product decision: widget handoff (#129) | 1 |
| Web-only: portal header setters (#130) | 2 |
| Total | 76 |

Completion criterion 2: `build-ledger.mjs` now takes `closed` (and an optional `operationId`) on a
capability override and writes a `closed` column to `capabilities.csv`. `overrides.json` closes the
59 server functions and the 11 route files that the lanes built (70 of the 73 entry points assigned
to lanes). Open: Trello (3); outside the lanes, the widget handoff (#129) and the two web-only
header setters (#130). The ledger reports 70 closed capabilities (the 59 functions and the 11 route
handlers) and exits 0.
