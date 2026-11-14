# RFC 0003: Teammate feedback screens and 20 feedback-value features

Status: accepted for implementation (2026-11-13). Owner: the integration lane (Z).
Base branch: `feat/quills-feedback-value`, cut from `feat/portal-userjot-parity` at `8c118460`.

## 1. Summary

This RFC adds 20 capabilities that help a workspace get better feedback from its customers,
and the teammate screens that RFC 0002 (decision D24) reserved for RFC 0003. The research
behind the list is in the PR description of #148 (Canny, Featurebase, Intercom, Productboard,
ProductLift, Upvoty, Nolt, Savio and ProdPad sources).

The work runs in waves of parallel lanes. Wave 0 adds the shared seams. Wave 1 builds the
features. Lane Z integrates, regenerates the shared artifacts and runs the review team.

## 2. Rules for every lane

1. Follow `AGENTS.md`, `apps/api/AGENTS.md` (the API contract), `apps/api/src/database/quills/README.md`
   and `scripts/quills-web/README.md` (conformance rules C1 to C23). The contract wins over this RFC.
2. API routes use `defineQuillsRoute`, bounded Zod inputs and responses, a sibling `*.fixture.ts`,
   `recordQuillsChange` inside the same transaction as each mutation, and the non-disclosing
   error conventions. Teammate routes use the `quills` actions `read`, `create`, `update`,
   `delete` and `manage_settings` from `@kaneo/permissions`. Portal and widget routes use their
   audience resolvers in `framework/audience.ts`.
3. Only lane S0-API writes Quills migrations. A lane that needs a schema change it did not get
   stops and reports it; lane Z adds a forward migration.
4. Web pages come from the quills-web CLI (`page`, `part`, `form`, `query`, `mutation`, `type`).
   Teammate pages use the audience `teammate` that lane S0-WEB adds.
5. External effects (mail, CRM, issue trackers, AI providers) run after commit through job
   handlers with a delivery ledger key, retries and tests, like `jobs/handlers/notification.ts`.
6. AI calls go through the existing assistant provider (`assistant/provider.ts`) and its usage
   log and budget. A portal or widget AI route is rate limited and returns a bounded result.
7. Evidence before a lane reports done: focused API tests with a real `quills_<lane>` database,
   `pnpm --filter @kaneo/api typecheck`, web tests for the touched paths, the web typecheck,
   `node scripts/quills-web/cli.mjs check`, and `pnpm lint`. Report skipped checks separately.
8. Do not edit files that another lane owns (section 5). Shared files are listed in section 6.

### Test database

Each lane creates its own disposable database in the local container `kaneo-w2-postgres`
(host port 54414, user `postgres`):

```sh
docker exec kaneo-w2-postgres createdb -U postgres quills_<lane>
export QUILLS_TEST_DATABASE_URL="postgres://postgres:<password>@127.0.0.1:54414/quills_<lane>"
```

Read the password with `docker inspect kaneo-w2-postgres` and never print it.

## 3. Decisions

| ID | Question | Decision |
|---|---|---|
| D1 | Where do teammate pages live? | `apps/web/src/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/` (RFC 0002 D24). Page code lives in `apps/web/src/quills/pages/team-*`. |
| D2 | How does a teammate page check access? | The page calls the teammate API; the API is the authority. The page shows a denied state on 403 and never hides a control as an authorization check. |
| D3 | Revenue weighting source | `quills.companies.mrr_cents` through the voter's principal → customer → company link. Aggregated at read time; no copy of revenue on posts. |
| D4 | Vote importance | A nullable column `post_votes.importance` with `nice`, `important`, `critical`. A vote without importance stays valid. |
| D5 | Prioritization score | Columns on `posts`: `score_reach` (int ≥ 0), `score_impact` (0.25, 0.5, 1, 2, 3), `score_confidence` (0 to 100), `score_effort` (> 0, person-weeks). RICE is computed at read time. |
| D6 | Voting-bias controls | Board settings JSON keys `voteDisplay` (`count` or `hidden`) and `defaultSort` (`votes`, `newest` or `random`). Random order is stable per viewer for a day. |
| D7 | Autopilot signals | A table `feedback_signals` holds extracted requests from conversations and tickets. A teammate accepts (new post, or a proxy vote on a matching post) or dismisses. |
| D8 | Surveys | Tables `surveys` and `survey_responses`. Types: `nps`, `csat`, `ces`, `pmf`, `poll`, `open`. One response per principal and survey. |
| D9 | Changelog engagement | Tables `changelog_reactions` (bounded emoji set) and `changelog_reads` (last read time per principal). |
| D10 | Translation cache | A table `content_translations` keyed by entity, locale and a hash of the source text. |
| D11 | Segment boards | A nullable column `boards.visible_segment_ids` (like `roadmaps`). Null means all viewers who pass the board access tier. |
| D12 | Task sync | A board setting maps Kaneo task completion to a post status. A Kaneo task event schedules a Quills job through a durable handoff; the job checks the stored `post_tasks` link. |
| D13 | CRM | HubSpot and Salesforce get a "request" note on the voter's company through the existing integration delivery. Lane L6 adds no new CRM tables; it uses `external_links`. |
| D14 | MCP | New tools in `packages/mcp` call the Quills REST API with the caller's API key. No new server auth. |
| D15 | Weekly digest | A sweep job sends one digest per principal per week when followed posts changed. A notification preference `weeklyDigest` turns it off. |

## 4. Features and boundary maps

Each row lists the owned schema objects, the actor source, the required action, the
transaction boundary and the external effects. "New" marks objects that lane S0-API adds.

### Capture

1. **Feedback autopilot (L1).** A job extracts feature requests from closed conversations and
   tickets with the assistant provider and writes `feedback_signals` (new). Teammate routes
   list, accept and dismiss signals. Accept creates a post or a proxy vote
   (`addQuillsPostProxyVote`) for the customer. Tables: `quills.feedback_signals`,
   `posts`, `post_votes`, `conversations`, `tickets`. Actor: `actor.principalId`. Actions:
   `read` to list, `create` to accept, `update` to dismiss. One transaction per decision, with
   `recordQuillsChange` (`signal.accepted`, `signal.dismissed`). External effect: the AI call in
   the job, with a ledger key per source message. Web: page `team-autopilot`.
2. **In-app surveys (L2).** `surveys` and `survey_responses` (new). Teammate routes create,
   update, close and read results (counts, NPS, CSAT and CES scores). Portal and widget routes:
   the active survey for the caller and one response per principal. Audience checks: segment
   targeting uses `user_segments`. Events: `survey.created`, `survey.updated`,
   `survey.responded`. Web: portal survey card, widget survey prompt, teammate pages
   `team-surveys` and `team-survey`.
3. **Vote importance (L3).** `post_votes.importance` (new). The portal and widget vote bodies
   accept an optional importance. Teammate post reads return counts per importance. Web: a
   small "How important is this?" control after a vote.
4. **AI composer help (L4).** Portal route `improveQuillsPortalPostDraft`: rough text in, a
   suggested title, a problem statement and a board out. Rate limited (10 per 10 min per
   principal), bounded input (4,000 characters) and output. No table. Web: "Improve with AI"
   in the composer.
5. **Help-article suggestions (L4).** The composer searches the public help center while the
   writer types and lists matching articles. No API change. Web only.
6. **Widget screenshot and annotation (L8).** The widget captures the page, lets the customer
   draw boxes and arrows, and uploads the PNG through the existing upload routes. Page URL and
   browser are added to the post metadata that the widget already sends. Package: `packages/widget`.

### Prioritize

7. **Revenue and segment demand (L3).** Teammate route `getQuillsPostDemand` and a demand
   summary on teammate post lists: voter count, company count, MRR sum, top segments, and
   importance counts. Read-only; filters unauthorized boards first. Web: `team-triage` page.
8. **Scoring frameworks (L3).** `posts.score_*` (new). Teammate route `setQuillsPostScore`
   (`update`), sort by RICE in the teammate list. Event `post.scored`.
9. **Voting-bias controls (L3).** Board settings `voteDisplay` and `defaultSort`
   (`manage_settings`). The portal hides counts and orders posts as configured. Portal list
   responses omit `voteCount` when hidden. Web: portal rows without counts; teammate board
   settings form.
10. **Duplicate review (L7).** Uses the existing merge suggestions and `mergeQuillsPost`.
    Teammate page `team-duplicates`: pending suggestions with both posts, accept or dismiss.
    Portal: when the composer finds a strong match, it offers "Vote for this instead".
11. **Topic and sentiment insights (L7).** Teammate route `getQuillsFeedbackInsights`: tag
    counts, sentiment mix and trend per week for a date range (bounded to 180 days), over
    visible boards only. Web: page `team-insights`.

### Close the loop

12. **Task sync (L6).** Board setting `taskSync` (`statusOnTaskDone`). A Kaneo task completion
    event enqueues a Quills job; the job reads `post_tasks` for that task under the workspace
    scope and sets the mapped post status with `recordQuillsChange` (`post.status_changed`), so
    the existing fanout notifies voters. Cross-schema: the job never trusts a task ID without the
    stored link. Web: teammate board settings field.
13. **Shipped notifications (L5).** A fanout entry for `changelog.published` notifies the voters
    and followers of linked posts in-app and by mail ("ShippedEmail"), with unsubscribe links.
14. **AI changelog drafts (L5).** Teammate route `draftQuillsChangelogFromPosts` (`create`):
    selected shipped posts in, a title and Markdown body out, with the requester count. No
    publish side effect. Web: "Draft from shipped requests" on the teammate changelog page.
15. **Changelog engagement (L5).** `changelog_reactions` and `changelog_reads` (new). Portal and
    widget routes: react, unreact, mark read, unread count. Teammate read: reaction and read
    stats per entry. Web: reaction bar on updates, unread badge on the widget launcher.
16. **My feedback and weekly digest (L5).** Portal route `listQuillsPortalMyFeedback` (my posts,
    my votes, my follows with status). Page `my-feedback`. Digest sweep job and the
    `weeklyDigest` preference (D15).

### Reach and B2B

17. **Segment boards (L8).** `boards.visible_segment_ids` (new). `visibleBoards` filters by the
    viewer's segments. Teammate board settings select segments.
18. **Auto-translation (L4).** Portal route `translateQuillsPortalContent` (post or comment, to
    the viewer locale) with the `content_translations` cache (new). Rate limited. Web:
    "Translate" on posts and comments when the content language differs.
19. **CRM sync (L6).** When a teammate links a post to a CRM company (existing external links),
    or a customer of a linked company votes with importance `critical`, a job adds a note to the
    company in HubSpot or Salesforce. Ledger key per vote and company. Teammate page section
    "Revenue at risk" on `team-triage` (critical votes × MRR).
20. **Agent access (L8).** MCP tools in `packages/mcp`: list and search posts, get a post, create
    a post, vote by proxy, comment, set status, list signals, draft a changelog. They call the
    REST API with the caller's API key.

## 5. Lanes and file ownership

| Lane | Features | Owns |
|---|---|---|
| S0-API | seams | `apps/api/src/database/quills/schema/{feedback-signals,surveys,changelog-engagement,content-translations}.ts`, the new columns, one migration, `events.ts` catalogue entries, transfer/retention/deletion registration, `apps/api/AGENTS.md` worker note |
| S0-WEB | teammate shell | `routes/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/**`, quills-web framework support for the `teammate` audience, `apps/web/src/quills/team/**` shell and navigation |
| L1 | 1 | `apps/api/src/quills/feedback/signals*.ts`, `jobs/handlers/signals*.ts`, `pages/team-autopilot/**` |
| L2 | 2 | `apps/api/src/quills/feedback/surveys*.ts`, `portal/surveys*.ts`, `widget/surveys*.ts`, `pages/team-survey*/**`, `ui/survey-*`, widget survey files |
| L3 | 3, 7, 8, 9 | `feedback/demand*.ts`, `feedback/scores*.ts`, vote importance in `feedback/votes.ts` and `portal/feedback/posts.ts`, board settings keys, `pages/team-triage/**`, portal vote UI |
| L4 | 4, 5, 18 | `portal/feedback/ai*.ts`, `portal/translations*.ts`, composer and post translation UI |
| L5 | 13, 14, 15, 16 | `jobs/fanout.ts` changelog entry, `jobs/handlers/digest*.ts`, `feedback/changelog-ai*.ts`, `portal/changelog-engagement*.ts`, `portal/my-feedback*.ts`, `pages/my-feedback/**`, changelog UI |
| L6 | 12, 19 | `integrations/task-sync*.ts`, `integrations/crm-notes*.ts`, the Kaneo task-event handoff, board `taskSync` setting |
| L7 | 10, 11 | `feedback/insights*.ts`, `pages/team-duplicates/**`, `pages/team-insights/**` |
| L8 | 6, 17, 20 | `packages/widget/**` screenshot files, board segment visibility in `portal/feedback/viewer.ts`, `packages/mcp/src/tools/quills*` |

## 6. Shared files

Lane Z merges these, so lanes add to them only by appending in their own block:
`apps/web/src/quills/i18n/en-US/*.json` (a lane adds keys to its own feature file; a new
feature file is preferred), `apps/web/src/quills/dev/kit-gallery.tsx`, `apps/web/src/routeTree.gen.ts`,
`apps/docs/openapi.json`, `apps/web/src/quills/test/operation-routes.ts`, `apps/api/src/quills/index.ts`
(router mounts), and `apps/api/src/quills/events.ts` (S0-API registers every event in advance).
Lane Z regenerates `routeTree.gen.ts`, `openapi.json` and `operation-routes.ts` after the merge.

## 7. Order

1. Wave 0: S0-API and S0-WEB in parallel. Both merge into `feat/quills-feedback-value`.
2. Wave 1a: L3, L5, L4, L2 and L1 in parallel, each in its own worktree from the merged base.
3. Wave 1b: L6, L7 and L8.
4. Lane Z: merge in lane order, regenerate the shared artifacts, run the full API and web
   suites, the contract suite and the review team, then open the PR.

## 8. Completion

A feature is done when its API, job, web and docs parts exist, its tests pass under a real
database, conformance and lint pass, and the review team finds no blocking issue. The status of
each feature is kept in section 9.

## 9. Status

| # | Feature | Lane | Status |
|---|---|---|---|
| 1 | Feedback autopilot | L1 | built |
| 2 | In-app surveys | L2 | built |
| 3 | Vote importance | L3 | built |
| 4 | AI composer help | L4 | built |
| 5 | Help-article suggestions | L4 | built |
| 6 | Widget screenshot and annotation | L8 | built |
| 7 | Revenue and segment demand | L3 | built |
| 8 | Scoring frameworks | L3 | built |
| 9 | Voting-bias controls | L3 | built |
| 10 | Duplicate review | L7 | built |
| 11 | Topic and sentiment insights | L7 | built |
| 12 | Task sync | L6 | built |
| 13 | Shipped notifications | L5 | built |
| 14 | AI changelog drafts | L5 | built |
| 15 | Changelog engagement | L5 | built |
| 16 | My feedback and weekly digest | L5 | built |
| 17 | Segment boards | L8 | built |
| 18 | Auto-translation | L4 | built |
| 19 | CRM sync | L6 | built |
| 20 | Agent access (MCP) | L8 | built |

"Built" means that the API, jobs, web and docs parts are merged and the tests pass under a real
database. A feature becomes "done" after the review team (section 8) finds no blocking issue.

Known limits after the merge:

1. HubSpot notes (feature 19) need a write scope. The HubSpot connect URL asks for read scopes
   only, so a HubSpot note fails with `write_access_required` until an operator adds the scope.
2. CRM notes (feature 19) take the company from `companies.externalId`. A workspace that keeps
   the IDs of another system there can send a note to the wrong company.
3. Task sync (feature 12) starts from the in-process `task.status_changed` and `task.moved`
   events. If the process stops between the task update and the enqueue, that one sync is lost.
   A column that becomes final and an import that publishes only `task.updated` do not sync.
4. The widget screenshot (feature 6) shows sticky elements and inner scroll areas at their
   unscrolled position, and images from other origins without CORS stay blank.
5. A survey (feature 2) uses `updated_at` as its activation time, so an edit to an active survey
   moves it to the front.
6. AI features (1, 4, 14 and 18) log their usage but have no workspace budget, because Kaneo has
   no AI budget yet.
