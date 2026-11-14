# P9 route set: reporting and data transfer runs

All paths are under `/quills/{workspaceId}`. Every route is for teammates and uses `defineQuillsRoute`.
`reporting/index.ts` mounts this set. The source rows are in `docs/quills-port/ledger/phase-P9.md`.

## Boundary map

```
Tables and owning schema:  quills.posts, post_votes, post_comments, post_statuses, boards, board_projects,
                           principal, user, companies, conversations, conversation_messages, changelog_entries,
                           changelog_entry_posts, kb_articles, status_incidents, status_subscriptions (reads);
                           visitor_stats_daily, visitor_top_stats (rollup reads; the rollup writes them);
                           export_runs, import_runs, files, post_external_links, post_tags,
                           post_tag_assignments (runs); public.storage_cleanup (through the existing trigger)
Actor and workspace:       authenticated context (defineQuillsRoute); the job reads the initiator from the run row
Permissions:               reads: workspace:read + quills:read; runs: quills:manage_settings
Persisted relationships:   board_projects decides board visibility (feedback/visibility.ts) for every
                           feedback aggregate, the posts and users exports and the import's boards
Transactions:              one scoped transaction per request. A run job claims the run, builds or reads the
                           file outside a transaction, then settles the run and finishes the job in one
                           transaction. An import writes all of its rows in that settling transaction.
External effects:          presigned GET URLs (local signing); in the job only: PUT of the export file,
                           GET of the import file. Object deletion stays with the shared cleanup worker.
Completion checks:         authenticated endpoint, tenant/object access, read/export, mutation, worker and
                           storage lifecycle
```

## Reporting reads

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsAnalyticsData` | `GET /reporting/analytics?period=7d\|30d\|90d\|12m` | read | posts, post_votes, post_comments, principal, post_statuses, boards, changelog_entries | - | contract, `reporting.test.ts` (hidden board, test customer, deleted post) |
| `fetchQuillsAdminOverview` | `GET /reporting/admin-overview` | read | conversations, posts, post_statuses, post_votes, changelog_entries, changelog_entry_posts, kb_articles, status_incidents, status_subscriptions | - | contract, `reporting.test.ts` |
| `getQuillsTeamCounts` | `GET /reporting/team-counts` | read | conversations, principal, tickets, ticket_statuses, merge_suggestions, posts, boards, board_projects, feedback_signals | - | contract, `team-counts.test.ts` (spam, test customer, hidden board, deleted ticket, workspace B) |
| `getQuillsVisitorAnalyticsData` | `GET /reporting/visitor-analytics?period=…&surface=all\|portal\|widget` | read | visitor_stats_daily, visitor_top_stats | - | contract, `reporting.test.ts` (rollup leaves out test customers) |

- `getQuillsTeamCounts` (RFC 0004) gives the counts of the teammate app navigation. Each count uses the
  rule of the list that it counts: the inbox open queue, `listQuillsTickets` with `statusCategory=open`,
  `fetchQuillsMergeSuggestionSummary` and the pending autopilot list.
- Feedback analytics are computed from live rows under the caller's board visibility. The
  `analytics_daily_stats` and `analytics_top_posts` snapshots count every board, so these routes do not read them.
- A period is whole UTC days with today included (as in visitor analytics); the previous period has the same
  length. Totals, the daily series, the board breakdown and the top posts use the same window.
- The visitor rollup (`database/quills/visitor-rollup.ts`) now leaves out page views whose principal is a test
  customer, runs its steps in order on one transaction client, writes no zero rows, skips a workspace that has
  no page views, and runs hourly from `runQuillsRetention`.
- Known limit (unchanged from the source): page-view partitions keep 90 days, so the `12m` top lists cover
  about 90 days.
- Post activity (`activity.ts#fetchActivityForPost`) is already `listQuillsPostActivity` in `feedback/posts.ts`.
- `getQuillsAnalyticsData` also merges `changelog.ts#topViewedChangelogsFn` (RFC 0001, lane M1).
  `changelogLimit` (1 to 20, default 5, as the source's `limit`) sets the length of
  `changelog.topEntries`, and each entry has its `publishedAt`. The list keeps its rule: published,
  not deleted, not scheduled, most views first. The source required `CHANGELOG_VIEW_DRAFT`; here
  the route's `read` applies, as for the other changelog reports.

## Visitor tracking beacon (`track.ts`, public)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `createQuillsTrack` | `POST /quills-public/{workspace}/track` (JSON or text/plain; 120 per minute per client) | public | create | page_views, visitor_devices, kv_store (daily salt), settings (read) | none (analytics) | contract, `track.test.ts` |

- Body: `url`, `referrer`, `surface` (`portal` or `widget`), `device` (the source's `deviceId`, named as in
  `POST /widget/device`: a caller-chosen value). 404 while the surface is off. Always `{}` otherwise.
- Stored: the page's origin and path (no query string), the campaign source or the external referrer's host,
  the CDN country, coarse device, browser and OS names, and `sha256(salt, origin, ip, user agent)`. The salt is
  per workspace and UTC day and expires after 48 hours (kv_store), so a hash cannot be linked across days or
  workspaces. No raw IP or User-Agent is stored with a view, as in the source. Like the source's rate bucket,
  the rate limit keeps the client IP in `rate_bucket` until retention removes the expired window (now 10,000
  rows per workspace and run).
- Nothing is stored for Do Not Track or Global Privacy Control, a bot, a URL that is not http(s), a widget with
  visitor analytics off, or a day with no page-view partition. The route never creates a partition, and the
  server clock sets `occurred_at`. With device tracking off, the device ID is dropped.
- Deviations: schema errors answer 400 and an exceeded rate limit 429 (the source drops both and answers 204).
  `isbot` and Bowser are not installed: a short pattern list classifies bots and devices. The `page.visited`
  workflow trigger is not dispatched. The beacon only touches a `visitor_devices` row that a widget session
  linked; it never creates one, because nothing removes device rows and the caller chooses the ID.

## Transfer runs

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsExportRuns` | `GET /transfer/export-runs?limit=1..50` | manage_settings | export_runs (the caller's own) | - | contract, `transfer.test.ts` |
| `createQuillsExportWorkspace` | `POST /transfer/export-runs` (`kind`: posts, users, companies, conversations) | manage_settings | export_runs | `export.requested` → `quills.transfer` job | contract (rollback, outbox), `transfer.test.ts` |
| `getQuillsExportRuns` | `GET /transfer/export-runs/{runId}` | manage_settings | export_runs (own) | - | contract (foreign run), `transfer.test.ts` |
| `listQuillsExportRunsDownload` | `GET /transfer/export-runs/{runId}/download` | manage_settings | export_runs (own) | - | contract, `transfer.test.ts` (expired run, other teammate) |
| `listQuillsImportRuns` | `GET /transfer/import-runs?limit=1..50` | manage_settings | import_runs | - | contract |
| `createQuillsImport` | `POST /transfer/import-runs` (`key`, `contentType`, `size`, `name`, `boardId`) | manage_settings | files, import_runs | `import.requested` → `quills.transfer` job | contract (rollback, outbox, foreign board and key), `transfer.test.ts` |
| `getQuillsImportRuns` | `GET /transfer/import-runs/{runId}` | manage_settings | import_runs | - | contract, `transfer.test.ts` |

Merged: `createQuillsExportWorkspace` also replaces the synchronous CSV routes `listQuillsExport`,
`listQuillsExportUsers`, `listQuillsExportCompanies` and `listQuillsExportConversations`. `listQuillsExportRuns`
replaces `listQuillsExportRunsRuns` (`routes/api/export/runs.ts`), and `listQuillsImportRuns` replaces
`listQuillsImportRunsRuns` (`routes/api/import/runs.ts`).

### Export rules

- An export holds only rows that its initiator can read: posts on boards the initiator can see, no deleted rows,
  no test customers. User activity counts cover only those posts. For that reason, every export run route returns
  only the caller's own runs; another teammate's run is not found.
- One pending or running export per workspace (the existing partial unique index; 409). A new request fails
  the active run only when no pending or running job will settle it (its job failed or was removed), so a
  stopped job cannot hold the slot and a live worker is never overtaken.
- The job writes the key on the run before the upload. Every failure clears the key, so the storage trigger
  queues the object for cleanup. If another attempt settled the run while this one uploaded, the job queues
  its own key for cleanup. The existing retention step clears the key after `expires_at` (7 days).
- The file is built 1,000 rows at a time, so memory stays near the byte limit.
- Bounds: 50,000 rows and 64 MB per file. A larger export fails with a reason. The job checks that the initiator
  can still read Quills before it reads rows.
- A run is never retried. A later attempt that finds the run still running fails it.

### Import rules

- The client uploads with `POST /files/uploads` (purpose `file`). The route verifies the object (CSV type,
  at most 10 MB), takes the object lock and registers the key in a hidden `files` row (soft-deleted, so file
  reads never show it). The job deletes that row when it settles the run, and the trigger queues the object.
- All or nothing: the job checks every row first (title, content, board slug among the boards the initiator can
  see, status by slug or name, tags by name, author email, created_at, duplicate source_id). One invalid row
  fails the run with an error report of at most 100 rows and writes nothing.
- A row whose `source_id` an earlier import created is skipped and counted in `totals.skipped`.
- Authors: an existing customer by email (the directory's customer rule), a new customer for an unknown email,
  else the initiator. The email of a teammate (a platform read of member addresses) or a test customer is a
  row error. New customers are inserted in batches.
- `created_at` accepts ISO dates only.
- Import settles run one at a time per workspace (a transaction advisory lock), so a CSV submitted twice
  imports each `source_id` once. Tested with two concurrent drains.
- A write failure after inserts rolls the whole import back (tested with an injected trigger failure).

## Not built in this slice

| Source | Reason |
|---|---|
| Workspace archive export and import runs | The archive holds integration credentials and rows on boards the caller cannot see. `db:transfer:quills` stays the operator path. |
| Analytics support metrics (CSAT, first response, time to close, teammate performance, conversation volume) and contributors, followers, leads, verified rate, signups by source | Not ported. SLA reporting is `getQuillsSupportReporting`. |
| Import dry run, auto-created boards, statuses and tags, vote counts and voters, update on reimport | Not ported. Unknown values are row errors; a reimport skips rows by `source_id`. |
| Download audit events | A read route records no event in the framework. |
| An export by an instance administrator who is not a member | The job reads as the initiator and requires a current Quills reader, so the run fails with a clear message. |

## Follow-ups (review should-fix items not done here)

- `post_votes` has no `(workspace_id, created_at)` index, so the momentum and vote-series queries read every
  vote of the workspace. Needs a schema migration.
- A run executes inline in the shared drain loop, so other Quills jobs on that instance wait while it runs. A
  separate drain needs a scheduler change in an upstream file.
