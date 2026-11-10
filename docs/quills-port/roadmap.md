# Roadmap: Quackback capability in Kaneo's API

Status: plan only. The numbers come from the generated ledger (`ledger/summary.md`).
Source commit: Quackback `42ef2e01`.

## Totals

| Item | Count |
|---|---|
| Quackback route files (one ledger row each) | 514 |
| Port | 378 |
| Reuse Kaneo | 90 |
| UI-only | 45 |
| Out of scope | 1 |
| Source capabilities (874 server functions + 217 HTTP handlers) | 1,091 |
| Capabilities to port | 940 |
| Capabilities that Kaneo already owns or that are out of scope | 151 |
| Tables that the ported capabilities use | 133, all present in Kaneo's `quills` schema |
| Ported capabilities that are not for teammates | 316 |
| Ported capabilities that cross the identity boundary | 280 |

The 940 is an upper limit on endpoints. Quackback has two entry points for many operations:
a `/api/v1` handler and a server function. At each phase kickoff, they merge into one
declaration per resource, verb and audience (see `detailed-plan.md`, section 2).

## Order

The order follows dependency first, then risk.

```
P0 framework ─► P1 feedback ─► P2 directory, settings, files ─► P3 portal and widget
                                        │                              │
                                        └──────────► P4 delivery ◄─────┘
                                                        │
                    P5 support ◄────────────────────────┤
                    P6 help center, status ◄────────────┤
                    P7 integrations ◄───────────────────┘
                    P8 automation, assistant  (needs P5 and P7)
                    P9 reporting, transfer    (needs all data domains)
                    P10 operations            (needs P6 for help-center domains)
```

- P1 is first because it has teammate routes only, and its tables have no external effects that must be delivered.
- P3 is the first phase with callers who are not teammates. It is the highest authorization risk.
- P4 adds the first real worker handlers (mail, webhooks). P5 to P8 need them.
- P5 is the largest phase (220 capabilities, 91 tables). It comes after the audience and delivery work that it depends on.

## Rules for every phase

Each phase has the same entry and exit steps.

Entry (kickoff):

1. Rerun `node scripts/quills-port/build-ledger.mjs`. Fix any failed check.
2. Write the boundary map for the phase in the PR description (the template is in `detailed-plan.md`, section 1).
3. Merge duplicate source capabilities into final declarations. Fix the paths, actions and events.
4. Run `node scripts/quills-port/check-upstream.mjs`. It must pass.

Exit (acceptance, in addition to the phase's own checks):

1. `contract.test.ts` passes for every declaration, on real PostgreSQL. No skipped database test.
2. `contract.self.test.ts` passes (the suite still catches the three broken routes).
3. `pnpm --filter @kaneo/api test:quills`, `typecheck` and `build` pass.
4. `pnpm openapi:check:fix` is run, and the diff contains only this phase's operations.
5. `check-upstream.mjs` passes. No new seam, unless this roadmap names it.
6. Every ledger row of the phase is marked closed in `ledger/overrides.json` with the PR number.
7. The Feature Flow review gives a Ship verdict.

Migrations: the 147 tables came with the schema import. A phase adds a migration only for an
index, a constraint or a grant that its queries need. Every migration goes through
`pnpm --filter @kaneo/api db:generate:quills`. No phase edits applied SQL.

---

## P0: Framework

| Item | Value |
|---|---|
| Ledger rows closed | 3: `api/v1/-write-validation.ts` and 2 tests (`service-actor-guard`, `write-validation`). Their rules become the helper's validation and the contract checks. |
| Endpoints | 0 new. The 8 existing routes move to the helper: context, jobs list, job retry, 4 link routes, links list, and the team bindings. |
| Work | `framework/define-route.ts`, `registry.ts`, `platform-reads.ts`, `contract.ts`, 3 test files, 1 fixture file per existing route module. |
| Migrations | None. |
| Upstream seams | None. |

Acceptance:

- `pnpm openapi:check` shows no change for the 8 existing operations.
- `apps/web/src/fetchers/quills/platform.ts` compiles with no edit (typed client still infers).
- The contract suite passes for the 8 routes.
- `contract.self.test.ts` reports `registered`, `denied-action` and `api-key-scope` for the route with no permission check.
- `links.ts` is at most half its current size (294 lines today).

## P1: Feedback core (teammates)

| Item | Value |
|---|---|
| Ledger rows closed | 57 port rows: 27 API files under `api/v1/{boards,posts,comments,tags,statuses,roadmaps,changelog,moderation}`, 10 admin pages (`admin/feedback*`, `roadmap`, `changelog`, `moderation`, `settings.{boards,statuses,tags,feedback,changelog,moderation}`), 2 helpers, 18 tests. 3 more pages are UI-only. |
| Source capabilities | 149 (98 server functions, 51 handlers). Expected after the merge: about 85 declarations. |
| Endpoints | Boards, posts, comments, votes, tags, statuses, roadmaps and columns, changelog entries and categories, moderation queue, post merge, post activity, saved post views. See `ledger/phase-P1.md`. |
| Tables | 32, including `boards`, `posts`, `post_comments`, `post_votes`, `post_tags`, `post_statuses`, `roadmaps`, `changelog_entries`, `post_activity`. |
| Migrations | None expected. Index candidates come from the list-query plans (inbox filters, roadmap posts). |
| Deferred inside the phase | Mail, webhooks and integration sync on post events (31 capabilities emit events). P1 records the outbox event. P4 and P7 add the delivery handlers. AI tagging and similarity (15 capabilities) return a "not enabled" result until P8. |
| Identity boundary | 14 capabilities read the source `user` or `invitation` table (voters, comment authors). They use the `principal` projection. |

Acceptance:

- A teammate can do the full flow through the API: create a board, create a post, comment, vote on behalf, set status, tag, merge, add to a roadmap, publish a changelog entry.
- The existing link routes still work with posts and boards made through the new routes (`native-link` tests).
- A post on a board linked to a private project is not returned to a caller who cannot open that project.
- Each mutation writes its declared event. The WebSocket `QUILLS_CHANGED` invalidation arrives for the workspace.
- The soft-delete and restore pairs are tested in both directions.

## P2: Directory, settings, files

| Item | Value |
|---|---|
| Ledger rows closed | 73 port rows: `api/v1/{users,companies,segments,principals,mentions,settings,files}`, `api/{upload,storage,files}`, `api/portal/{files,upload}`, admin pages for people, companies, segments, teams, branding, portal, widget, developers, labs, notifications, audit log; 37 tests. 8 pages are UI-only. |
| Source capabilities | 129 (directory 71, settings 38, files 20). |
| Endpoints | People (customers and leads), user tags, blocking, lead merge, companies and attributes, user attributes, segments and membership, team extensions, portal, branding and widget configuration, audit-log read, upload URLs and file registration. See `ledger/phase-P2.md`. |
| Tables | 58. |
| Migrations | Candidate: none. File routes use the storage triggers that exist. |
| Risk | Files. 42 capabilities touch storage. Each object-bearing field needs the reference probe, cleanup trigger, workspace deletion and transfer handling together (contract, "Mutations, jobs, files and clients"). |
| Identity boundary | 37 capabilities. The people directory lists customers from `customer_identity` and `principal`, never Kaneo members. Teammate lists come from Kaneo's member API (reuse). |

Acceptance:

- Storage tests pass for each file field: upload, replace, delete, expired verification, cross-workspace reference.
- The people list never returns a Kaneo teammate as a customer, and never returns a customer of workspace B.
- Segment evaluation is bounded (page size and time), and its result does not differ by caller role.
- Settings writes need `manage_settings`. Settings reads that carry secrets (widget secret) also need it.
- `settings.name` and `settings.slug` stay read-only through Quills routes (Kaneo owns them).

## P3: Portal and widget audiences

| Item | Value |
|---|---|
| Ledger rows closed | 61 port rows: `_portal/**` pages, `widget*`, `api/widget/**`, `api/user/**`, `api/auth/portal-signin`, `portal-invite`, `auth.widget-handoff`, `api/widget-sso`, changelog feeds, `sitemap.xml`; 28 tests. |
| Source capabilities | 86 (portal 60, widget 26). 77 are not teammate routes. |
| Endpoints | Public boards, posts, roadmaps, changelog; customer post, comment, vote, reaction; customer profile; portal access rules and invites; widget config, identify, session, search. See `ledger/phase-P3.md`. |
| Tables | 37, including `customer_identity`, `widget_origin_session`, `widget_identified_session`. |
| Migrations | Candidate: one constraint or index for the customer-to-Kaneo-user link, if decision D1 needs it. |
| Upstream seam | One planned line in `apps/api/src/index.ts`: `api.route("/quills-public", quillsPublic)` before the session middleware, plus its 3 type-export entries. This is the only planned seam change in the roadmap. |
| Blocked by | Decision D1 (customer sign-in model). |

Acceptance:

- Each audience (`portal`, `widget`, `public`, `signed`) has its own check table in the contract suite, and every P3 declaration passes it.
- A public caller reads only public boards and published content. Private posts, internal comments and segment-limited changelog entries do not leak, including in counts and search.
- A customer can edit or delete only their own post and comment. Tests use two customers in one workspace and one customer in another.
- A widget identify call with a wrong HMAC is rejected. A widget session of workspace A is rejected on workspace B.
- Rate limits exist for anonymous write routes (post, vote, identify).
- No customer becomes a workspace member. `workspace_member` has no new row after any P3 request.

## P4: Delivery

| Item | Value |
|---|---|
| Ledger rows closed | 9 port rows: `api/v1/webhooks/**`, `api/devices`, `unsubscribe`; 4 tests. |
| Source capabilities | 38. |
| Endpoints | Outbound webhooks (create, update, rotate secret, delete), post subscriptions, notification preferences, in-app notifications, changelog and status subscriptions, unsubscribe tokens, push devices. See `ledger/phase-P4.md`. |
| Worker handlers | New, in `src/quills/jobs/`: `quills.mail`, `quills.webhook`, `quills.notification`. Each has validation, a deduplication key, retry with backoff, and a test for a lost lease. Mail uses `packages/email/src/quills`. |
| Tables | 16, including `webhooks`, `hook_deliveries`, `email_log`, `post_subscriptions`, `in_app_notifications`, `unsubscribe_tokens`. |
| Migrations | Candidate: a unique deduplication key on delivery rows, if the tables lack one. |

Acceptance:

- A retry after an uncertain outcome does not send a second mail or webhook (deduplication test).
- A rolled-back mutation sends nothing.
- A webhook secret appears once, in the create and rotate responses, and never in list or get.
- Webhook targets pass an SSRF check (private address ranges are rejected).
- Events recorded in P1 to P3 now produce mail and webhooks. The backlog is not replayed: only events created after the handler is enabled are delivered.

## P5: Support (conversations, tickets, inbox)

| Item | Value |
|---|---|
| Ledger rows closed | 54 port rows: `api/v1/{conversations,tickets,ticket-statuses}`, `api/chat/**`, `csat`, `admin/inbox`, support settings pages; 17 tests. |
| Source capabilities | 220 (196 server functions, 24 handlers). The largest phase. Split it into four PRs: conversations, tickets, inbox and views, channels and SLA. |
| Endpoints | Conversations, messages, notes, assignment, status, priority, tags, attributes, views, participants; tickets, types, statuses, links to conversations; macros; SLA policies; office hours and routing; email channel accounts; CSAT; widget conversations and tickets; message stream. See `ledger/phase-P5.md`. |
| Tables | 91. |
| Migrations | Candidates: indexes for inbox list queries; none for data shape. Ticket numbers keep their allocator. |
| Risk | Realtime (62 capabilities), inbound email (signed webhook), 51 non-teammate capabilities, and 65 identity-boundary capabilities. |

Acceptance:

- Inbound email is accepted only with a valid provider signature, and it lands in the workspace that owns the address.
- A customer sees only their own conversations and tickets (widget audience tests).
- Internal notes never appear in a customer response, in the stream, or in outbound mail.
- Ticket numbers stay unique under concurrent creation (database test through `quills_runtime`).
- The message stream authorizes on connect and stops after membership removal on reconnect.
- Bulk conversation updates are all-or-nothing.

## P6: Help center and status page

| Item | Value |
|---|---|
| Ledger rows closed | 50 port rows: `api/v1/{help-center,status}`, `hc/**`, `_portal/hc/**`, `help*`, `status/**`, admin help-center and status pages; 13 tests. 11 pages are UI-only. |
| Source capabilities | 128 (help center 70, status 58). |
| Endpoints | Articles, categories, translations, redirect rules, article feedback, search; status components, groups, incidents, updates, templates, subscribers, uptime, feeds. See `ledger/phase-P6.md`. |
| Tables | 27. |
| Migrations | None expected. Public help-center URL IDs are preserved. |

Acceptance:

- Draft articles and unpublished incidents are not public, including in sitemaps, feeds and search.
- Public URL IDs do not change after an update or a translation.
- Subscriber import is bounded and rejects a file above the limit.
- Status subscription mail uses the P4 handler.

## P7: Integrations

| Item | Value |
|---|---|
| Ledger rows closed | 18 port rows: `api/integrations/**`, `oauth/$integration/**`, `oauth/connector.callback`, `api/v1/apps/**`, `apps*`, integration settings pages; 3 tests. |
| Source capabilities | 84 (70 server functions for 25 providers, 14 handlers). |
| Endpoints | Connect and callback per provider, credentials, event mappings, notification channels, inbound provider webhooks, external item search, app sidebar routes, sync operations. See `ledger/phase-P7.md`. |
| Tables | 34, including `integrations`, `integration_platform_credentials`, `integration_sync_*`. |
| Decision | D6: which providers to port. Kaneo already has GitHub, Gitea, GitLab, Slack, Discord, Mattermost, Telegram and generic-webhook integrations for tasks. The recommendation is to port the provider-neutral core first, then providers by demand. |

Acceptance:

- Credentials are encrypted at rest and never returned by any route.
- An OAuth callback is bound to the session and workspace that started it (state check).
- Inbound provider webhooks verify the signature and deduplicate by delivery ID.
- An uncertain sync outcome is marked uncertain, not retried blindly (rule 9).

## P8: Automation and assistant

| Item | Value |
|---|---|
| Ledger rows closed | 24 port rows: `api/admin/assistant/**`, `api/v1/suggestions/**`, `api/widget/kb-ask`, automation and assistant admin pages; 11 tests. 12 pages are UI-only. |
| Source capabilities | 76 (assistant 57, automation 19). |
| Endpoints | Workflows, versions, runs; assistant settings, guidance, snippets, documents, web sources, connectors, skills, pending actions; merge and feedback suggestions; copilot. See `ledger/phase-P8.md`. |
| Tables | 82 (the engines read most of the schema). |
| Risk | The assistant acts for a user. Each tool call must pass the same declaration checks as the user's own request. |

Acceptance:

- A workflow or assistant action cannot do what its triggering user cannot do (tests with a viewer).
- Pending actions need approval from a user who holds the action's permission.
- AI usage is logged per workspace, and a provider error does not leak the provider's raw message.
- MCP tools for Quills, if added, register through Kaneo's MCP package and reuse the same declarations.

## P9: Reporting and data transfer

| Item | Value |
|---|---|
| Ledger rows closed | 24 port rows: `api/export*`, `api/import/**`, `api/track`, `admin/analytics`, `admin/settings.imports`; 10 tests. |
| Source capabilities | 17. |
| Endpoints | Analytics reads, visitor tracking, export runs and downloads, CSV exports, import runs. See `ledger/phase-P9.md`. |
| Tables | 30. |
| Note | Workspace transfer exists as an operator command. P9 adds API export and import runs. It does not replace `db:transfer:quills`. |

Acceptance:

- An export contains only rows that the caller can read, and the download link expires.
- Exports are bounded and run as jobs. The request returns a run ID.
- `api/track` accepts anonymous page views with a rate limit and writes only to the page-view partitions.
- Aggregates do not include private or test data for callers who cannot see it.

## P10: Operations (custom domains, fleet wake, usage)

Decision of 2026-11-10: billing, telemetry and the onboarding wizard use Kaneo's own
implementations. Kaneo has no custom domains, fleet wake or usage endpoint, so these are ported.

| Item | Value |
|---|---|
| Ledger rows closed | 5 port rows: `admin/settings.domains` and its test, `api/internal/job-wake` and its test, `api/v1/admin/usage`. |
| Source capabilities | 13. |
| Endpoints | Custom domains for the portal and the help center (read, set, verify), sending-domain and sign-in-domain summaries, the "powered by" flag, usage totals, workspace wipe, job wake. See `ledger/phase-P10.md`. |
| Tables | `settings`, `email_sending_domains`, `ai_usage_log`, and every table for the wipe. |
| Billing link | A declaration gets an optional `entitlement` field. The helper calls Kaneo's `require-entitlement` middleware. Custom domains use it. No Quills billing tables or provider code. |
| Upstream seams | None planned. If Kaneo's entitlement list needs a new key, that edit is in `apps/api/src/billing/config.ts`, an upstream file, and it must be added to `seams.json` first. |
| Risk | Workspace wipe is destructive. Domain verification makes outbound DNS and HTTP requests. Job wake is an internal endpoint. |

Acceptance:

- A domain is active only after verification, and one domain cannot belong to two workspaces (database constraint, tested through `quills_runtime`).
- Workspace wipe needs `manage_settings`, a typed confirmation of the workspace slug, and runs as a job. It deletes Quills data only, and storage cleanup goes through the shared queue.
- Job wake accepts only the internal credential, and it is not in the public OpenAPI document.
- A route with an `entitlement` returns Kaneo's standard upgrade error when the workspace lacks it.

---

## What is not ported

| Group | Route files | Capabilities | Reason |
|---|---|---|---|
| Identity (login, signup, SSO, 2FA, invitations, roles, API keys, member management, ownership) | part of 90 | 87 | Kaneo owns these. No second auth or membership model. |
| Workspace setup and the onboarding wizard | part of 90 | 25 | Kaneo owns workspace setup. Quills defaults initialize on first scoped access. |
| Platform (health, OpenAPI docs, OAuth and MCP metadata, MCP transport, robots) | part of 90 | 15 | Kaneo already serves these. |
| Billing (checkout, plans, invoices, entitlements) | part of 90 | 18 | Kaneo has billing in `apps/api/src/billing`. Quills routes gate through its entitlement middleware. |
| Telemetry and prompts (PLG events, version check, star prompt) | part of 90 | 4 | Kaneo has its own analytics. |
| Source test harness | 1 | 2 | Not product capability. |
| App shell and layouts | 45 | 0 | UI-only. |

Each row and its reason is in `ledger/routes.csv`.
