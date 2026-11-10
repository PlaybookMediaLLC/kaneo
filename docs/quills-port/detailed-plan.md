# Detailed plan: per endpoint

Status: plan only.

The per-endpoint plan has two parts:

1. **Generated tables**, one file per phase: `ledger/phase-P1.md` to `ledger/phase-P10.md`.
   Each of the 940 ported capabilities has one row.
2. **This document**: how to read a row as a route declaration, how duplicate rows merge,
   and the final route set for P0 and P1, which are the first phases to build.

## 1. How to read a generated row

| Column | Meaning | Declaration field |
|---|---|---|
| operationId | Stable key of the capability | `operationId` |
| Proposed route | Method and path under `/quills/{workspaceId}` | `method`, `path` |
| Action | One of Kaneo's five Quills actions | `action` |
| Audience | Who calls it in the source | `audience` (P3 and later) |
| Source permission | The Quackback permission keys found in the call chain | `sourcePermission` |
| Tables | Tables that the call chain reads or writes | the boundary map |
| Outbox event | Proposed event type for a mutation | `event` |
| Side effects | Modules that the call chain enters: `email`, `events`, `jobs`, `webhooks`, `integrations`, `storage`, `realtime`, `ai`, `workflows`, `notifications` | the worker handler that the event needs |
| Tests | Test profile (see below) | fixture and feature tests |
| Source | Quackback file and function | the code to read before the port |

Test profiles:

| Profile | Tests |
|---|---|
| `contract` | The table-driven suite. Automatic for every declaration with a fixture. |
| `two-workspace` | The fixture seeds the object in workspaces A and B. The checks `foreign-ids` and `other-workspace` use it. |
| `read-leak` | Feature test: private, deleted and test-customer rows, protected fields and counts do not leak. |
| `rollback` | The contract check `rollback`, plus a feature test when the mutation writes more than one table. |
| `native-link` | Private project denied, authorized project allowed, stored relationship used. |
| `worker-retry` | Handler test: retry, deduplication, lost lease. The handler arrives in P4 (mail, webhook) or P7 (integration). |
| `storage-lifecycle` | Reference, cleanup, expired verification, cross-workspace reference. |
| `audience` | The check table of the declared non-teammate audience. |

Boundary map template (one per phase PR, required by `apps/api/AGENTS.md`):

```
Tables and owning schema:      <from the Tables column, all `quills`; name each `public` table read>
Actor and workspace source:    authenticated context (helper)
Permissions:                   workspace:read + quills:<action>; native: <map or none>
Persisted relationships:       <board_projects | post_tasks | teams.kaneo_team_id | none>
Transaction:                   one scoped transaction per request; platform reads in platform-reads.ts
External effects:              <events → handler>, none in the request
Completion checks:             <rows of the evidence table that apply>
```

## 2. Merge rule for duplicate capabilities

Quackback exposes many operations twice: an `/api/v1` handler for API keys and a server
function for the dashboard. Kaneo serves a session and an API key through the same route.

1. The `/api/v1` handler gives the route shape (method, path, operationId).
2. A server function for the same resource and verb merges into that route. Its extra input
   fields and response fields are added to the schema when the dashboard needs them.
3. A server function with no `/api/v1` twin gets its own route under the same resource path.
4. Two source capabilities with different audiences never merge. A portal route and a teammate
   route stay separate declarations.
5. When the merged capabilities name different source permissions, the route takes the stricter action.
6. The merged row keeps every source ID in `ledger/overrides.json` (`mergedInto`), so the count still balances.

## 3. Action mapping

Kaneo has five Quills actions. Quackback has about one hundred permission keys.

| Source key | Kaneo action |
|---|---|
| Read keys (`*_VIEW`, `POST_VIEW_PRIVATE`) and public reads | `read` |
| Content keys with a create verb (`POST_CREATE`, changelog or article create) | `create` |
| Content keys with an update verb (`POST_EDIT`, `POST_SET_*`, `COMMENT_EDIT`, moderation, merge, reply, assign) | `update` |
| Delete verbs on content | `delete` |
| Configuration keys (`SETTINGS_*`, `BOARD_MANAGE`, `STATUS_MANAGE`, `TAG_MANAGE`, `WEBHOOK_MANAGE`, `INTEGRATION_MANAGE`, `SLA_MANAGE`, attribute definitions, audit log) | `manage_settings` |

Effect on Kaneo's built-in roles: a viewer reads; a member reads, creates and updates;
an admin and an owner also delete and manage settings. The source key stays in the declaration
as `sourcePermission`. Decision D2 in the README covers finer permissions.

## 4. P0 declarations (existing routes on the helper)

| operationId | Route | Action | Native | Project resolver | Tables | Event | Tests |
|---|---|---|---|---|---|---|---|
| `getQuillsWorkspaceContext` | `GET /context` | read | - | - | `settings` | - | contract |
| `listQuillsJobs` | `GET /jobs` | manage_settings | - | - | `job_queue` | - | contract, page-bounds |
| `retryQuillsJob` | `POST /jobs/{jobId}/retry` | manage_settings | - | - | `job_queue`, `audit_log` | existing audit entry | contract, rollback |
| `linkQuillsBoardToProject` | `PUT /boards/{boardId}/projects/{projectId}` | update | `project:read` | `params.projectId` | `boards`, `board_projects` | `board.project_linked` | contract, native-link |
| `unlinkQuillsBoardFromProject` | `DELETE` same path | update | `project:read` | `params.projectId` | same | `board.project_unlinked` | contract, native-link |
| `linkQuillsPostToTask` | `PUT /posts/{postId}/tasks/{taskId}` | update | `project:read` | the task's stored project | `posts`, `post_tasks`; reads `public.task` | `post.task_linked` | contract, native-link |
| `unlinkQuillsPostFromTask` | `DELETE` same path | update | `project:read` | the task's stored project | same | `post.task_unlinked` | contract, native-link |
| `listQuillsLinks` | `GET /links` | read | `project:read` | - (filter in `after`) | `board_projects`, `post_tasks`; reads `public.project`, `public.task` | - | contract, read-leak, page-bounds |
| team binding routes in `teams.ts` | unchanged paths | as today | as today | - | `teams`, `team_members`; reads `public.team` | `team.bound`, `team.unbound` | contract, native-link |

The operation IDs, paths and schemas do not change. `framework.md`, section 6, shows the code for the link routes.

## 5. P1 final route set (feedback core)

All paths are under `/quills/{workspaceId}`. Every route is for teammates. `Merged` shows how
many source capabilities the group replaces (149 in total). The source rows are in `ledger/phase-P1.md`.

### Boards

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsBoards` | `GET /boards` (`?counts=true`) | read | `boards`, `posts` | - | contract, read-leak |
| `getQuillsBoard` | `GET /boards/{boardId}` | read | `boards` | - | contract |
| `createQuillsBoard` | `POST /boards` | manage_settings | `boards` | `board.created` | contract, rollback |
| `updateQuillsBoard` | `PATCH /boards/{boardId}` (includes access settings) | manage_settings | `boards` | `board.updated` | contract, rollback |
| `deleteQuillsBoard` | `DELETE /boards/{boardId}` (soft delete) | manage_settings | `boards`, `board_projects` | `board.deleted` | contract, rollback, native-link |

Merged: 12. Visibility rule for every board and post read: if the board has rows in
`board_projects`, the caller must be able to open at least one linked project. The check uses
`findInaccessibleProjectIds` through `platform-reads.ts`.

### Posts

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsPosts` | `GET /posts` (board, status, tag, owner, search, date, sort, cursor; `limit` ≤ 100) | read | `posts`, `post_statuses`, `post_tag_assignments`, `user_segments` | - | contract, read-leak, page-bounds |
| `getQuillsPostFilterCounts` | `GET /posts/counts` | read | `posts` | - | contract, read-leak |
| `getQuillsPost` | `GET /posts/{postId}` | read | `posts`, `post_votes`, `post_tags`, `principal` | - | contract, read-leak |
| `createQuillsPost` | `POST /posts` | create | `posts`, `post_activity`, `post_subscriptions`, `post_tag_assignments` | `post.created` | contract, rollback |
| `updateQuillsPost` | `PATCH /posts/{postId}` (title, content, ETA, comments lock) | update | `posts`, `post_edit_history`, `post_activity` | `post.updated` | contract, rollback |
| `setQuillsPostStatus` | `PUT /posts/{postId}/status` | update | `posts`, `post_statuses`, `post_activity` | `post.status_changed` | contract, rollback |
| `setQuillsPostBoard` | `PUT /posts/{postId}/board` | update | `posts`, `boards` | `post.moved` | contract, rollback, native-link |
| `setQuillsPostOwner` | `PUT /posts/{postId}/owner` | update | `posts`, `principal` | `post.owner_changed` | contract, rollback |
| `setQuillsPostTags` | `PUT /posts/{postId}/tags` (≤ 50 IDs, all-or-nothing) | update | `post_tag_assignments`, `post_tags` | `post.tags_changed` | contract, rollback, batch |
| `deleteQuillsPost` | `DELETE /posts/{postId}` (soft delete) | delete | `posts` | `post.deleted` | contract, rollback |
| `restoreQuillsPost` | `POST /posts/{postId}/restore` | delete | `posts` | `post.restored` | contract, rollback |
| `listQuillsPostActivity` | `GET /posts/{postId}/activity` | read | `post_activity`, `principal` | - | contract, read-leak |
| `listQuillsPostOwnerCandidates` | `GET /posts/owner-candidates` | read | `principal` (teammates only) | - | contract, read-leak |

Merged: 25. `createQuillsPost` does not accept an author ID in P1 (`POST_SET_AUTHOR` in the source).
The author is `actor.principalId`. Author override returns in P2 with the people directory.
`retryPostIntegrationSync` and `fetchPostExternalLinks` move to P7.

### Votes

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsPostVoters` | `GET /posts/{postId}/voters` | read | `post_votes`, `principal` | - | contract, read-leak |
| `voteQuillsPost` | `PUT /posts/{postId}/vote` (the caller's own vote) | update | `post_votes`, `posts` | `post.voted` | contract, rollback |
| `addQuillsPostProxyVote` | `PUT /posts/{postId}/voters/{principalId}` | update | `post_votes`, `posts`, `principal` | `post.voted` | contract, rollback |
| `removeQuillsPostVote` | `DELETE /posts/{postId}/voters/{principalId}` | update | `post_votes`, `posts` | `post.unvoted` | contract, rollback |

Merged: 8. The vote count on `posts` changes in the same transaction as the vote row.
A concurrency test proves that two parallel votes give the correct count.

### Comments

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsPostComments` | `GET /posts/{postId}/comments` | read | `post_comments`, `post_comment_reactions`, `principal` | - | contract, read-leak |
| `getQuillsComment` | `GET /comments/{commentId}` | read | `post_comments` | - | contract |
| `createQuillsComment` | `POST /posts/{postId}/comments` (internal flag, parent ID) | create | `post_comments`, `post_activity`, `post_mentions` | `comment.created` | contract, rollback |
| `updateQuillsComment` | `PATCH /comments/{commentId}` (own comment: update; another author's: needs update, recorded as a moderation edit) | update | `post_comments`, `post_comment_edit_history` | `comment.updated` | contract, rollback |
| `deleteQuillsComment` | `DELETE /comments/{commentId}` | delete (own comment: update) | `post_comments` | `comment.deleted` | contract, rollback |
| `restoreQuillsComment` | `POST /comments/{commentId}/restore` | delete | `post_comments` | `comment.restored` | contract, rollback |
| `setQuillsCommentPin` | `PUT` and `DELETE /posts/{postId}/pinned-comment/{commentId}` | update | `posts`, `post_comments` | `comment.pinned`, `comment.unpinned` | contract, rollback |
| `setQuillsCommentReaction` | `PUT` and `DELETE /comments/{commentId}/reactions/{emoji}` | update | `post_comment_reactions` | `comment.reacted` | contract, rollback |

Merged: 15. `foreign-ids` covers `parentId`: a parent comment of another post is rejected.

### Tags and statuses

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsTags`, `getQuillsTag` | `GET /tags`, `GET /tags/{tagId}` | read | `post_tags` | - |
| `createQuillsTag`, `updateQuillsTag`, `deleteQuillsTag` | `POST /tags`, `PATCH` and `DELETE /tags/{tagId}` | manage_settings | `post_tags`, `post_tag_assignments` | `tag.created`, `tag.updated`, `tag.deleted` |
| `listQuillsStatuses`, `getQuillsStatus` | `GET /statuses`, `GET /statuses/{statusId}` | read | `post_statuses` | - |
| `createQuillsStatus`, `updateQuillsStatus`, `deleteQuillsStatus` | `POST /statuses`, `PATCH` and `DELETE /statuses/{statusId}` | manage_settings | `post_statuses`, `posts` | `status.created`, `status.updated`, `status.deleted` |
| `reorderQuillsStatuses` | `PUT /statuses/order` (the full ID list) | manage_settings | `post_statuses` | `status.reordered` |

Merged: 24. Tests: contract for all; rollback for mutations. Deleting a status that posts
still use returns 409. `backfillAiTags` moves to P8.

### Roadmaps

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsRoadmaps`, `getQuillsRoadmap` | `GET /roadmaps`, `GET /roadmaps/{roadmapId}` | read | `roadmaps` | - |
| `createQuillsRoadmap`, `updateQuillsRoadmap`, `deleteQuillsRoadmap` | `POST /roadmaps`, `PATCH` and `DELETE /roadmaps/{roadmapId}` | manage_settings | `roadmaps`, `roadmap_columns` | `roadmap.created`, `roadmap.updated`, `roadmap.deleted` |
| `reorderQuillsRoadmaps` | `PUT /roadmaps/order` | manage_settings | `roadmaps` | `roadmap.reordered` |
| `listQuillsRoadmapColumns` | `GET /roadmaps/{roadmapId}/columns` | read | `roadmap_columns` | - |
| `createQuillsRoadmapColumn`, `updateQuillsRoadmapColumn`, `deleteQuillsRoadmapColumn` | `POST /roadmaps/{roadmapId}/columns`, `PATCH` and `DELETE .../columns/{columnId}` | manage_settings | `roadmap_columns` | `roadmap.column_created`, `roadmap.column_updated`, `roadmap.column_deleted` |
| `listQuillsRoadmapPosts` | `GET /roadmaps/{roadmapId}/posts` (column, date bucket, cursor) | read | `posts`, `roadmap_columns`, `post_statuses` | - |

Merged: 22. `foreign-ids` covers the pair `roadmapId` and `columnId`: a column of another roadmap returns 404.

### Changelog

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsChangelog`, `getQuillsChangelogEntry` | `GET /changelog`, `GET /changelog/{entryId}` (drafts included) | read | `changelog_entries`, `changelog_entry_categories`, `changelog_entry_posts` | - |
| `createQuillsChangelogEntry` | `POST /changelog` | create | same | `changelog.created` |
| `updateQuillsChangelogEntry` | `PATCH /changelog/{entryId}` (publish state included) | update | same | `changelog.updated`, and `changelog.published` on the state change |
| `deleteQuillsChangelogEntry` | `DELETE /changelog/{entryId}` | delete | same | `changelog.deleted` |
| `searchQuillsShippedPosts` | `GET /changelog/shipped-posts` | read | `posts`, `post_statuses` | - |
| `listQuillsChangelogCategories` and create, update, delete, reorder | `/changelog/categories` | read, and manage_settings for mutations | `changelog_categories` | `changelog.category_*` |
| `getQuillsChangelogSettings`, `updateQuillsChangelogSettings` | `GET` and `PATCH /changelog/settings` | read, manage_settings | `settings` | `settings.changelog_updated` |

Merged: 21. Two of them, the public changelog reads in the source (`getPublicChangelog`, `listPublicChangelogs`) move to P3.
`changelog.published` is the event that the P4 mail handler uses for subscribers.
Linked post IDs (`linkedPostIds`, ≤ 50) pass `foreign-ids`.

### Moderation, merge, saved views

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsPendingModeration` | `GET /moderation/pending` (`type=post|comment`) | read | `posts`, `post_comments` | - |
| `getQuillsModerationStatus` | `GET /moderation/status` | read | `settings`, `posts`, `post_comments` | - |
| `approveQuillsPost`, `rejectQuillsPost` | `POST /moderation/posts/{postId}/approve`, `.../reject` | update | `posts`, `post_activity` | `post.approved`, `post.rejected` |
| `approveQuillsComment`, `rejectQuillsComment` | `POST /moderation/comments/{commentId}/approve`, `.../reject` | update | `post_comments` | `comment.approved`, `comment.rejected` |
| `setQuillsModerationDefault` | `PUT /moderation/default` | manage_settings | `settings` | `settings.moderation_updated` |
| `getQuillsPostMergePreview` | `GET /posts/{postId}/merge-preview?into=` | read | `posts`, `post_votes` | - |
| `mergeQuillsPost` | `POST /posts/{postId}/merge` | update | `posts`, `post_votes`, `post_comments`, `post_subscriptions`, `post_activity` | `post.merged` |
| `unmergeQuillsPost` | `POST /posts/{postId}/unmerge` | update | same | `post.unmerged` |
| `listQuillsMergedPosts` | `GET /posts/{postId}/merged` | read | `posts` | - |
| `listQuillsPostViews`, `createQuillsPostView`, `deleteQuillsPostView` | `GET` and `POST /post-views`, `DELETE /post-views/{viewId}` | read, create, delete (own view) | `post_views` | `post_view.created`, `post_view.deleted` |

Merged: 22. Merge is the widest mutation in P1 (five tables). It needs its own rollback feature test,
and a test that both posts are in the caller's workspace and on boards the caller can read.

### P1 event catalogue additions

`recordQuillsChange` validates the type against a Zod enum. P1 extends that enum and the
entity enum (`comment`, `tag`, `status`, `roadmap`, `changelog`, `post_view`, `settings`) in
`src/quills/events.ts`. The contract check `outbox` compares each mutation with its declared type,
so a route cannot record an event that the catalogue does not list.

### P1 test files

| File | Content |
|---|---|
| `src/quills/feedback/*.fixture.ts` | One fixture per declaration (seed in A and B, valid input). |
| `src/quills/framework/contract.test.ts` | Picks up every P1 declaration from the registry. No edit. |
| `src/quills/feedback/visibility.test.ts` | Private-project boards, soft-deleted rows, test customers, internal comments. |
| `src/quills/feedback/merge.test.ts` | Merge and unmerge, rollback, counts. |
| `src/quills/feedback/votes.test.ts` | Concurrent votes, proxy votes, count integrity. |
| `src/quills/feedback/batch.test.ts` | Tag sets and reorders are all-or-nothing. |

## 6. P2 to P10

Each phase uses the same procedure: run the kickoff steps in `roadmap.md`, apply the merge rule
in section 2, and write the final route tables in the phase PR in the format of section 5.
The inputs are already per endpoint:

| Phase | Generated plan | Source capabilities |
|---|---|---|
| P2 | `ledger/phase-P2.md` | 129 |
| P3 | `ledger/phase-P3.md` | 86 |
| P4 | `ledger/phase-P4.md` | 38 |
| P5 | `ledger/phase-P5.md` | 220 |
| P6 | `ledger/phase-P6.md` | 128 |
| P7 | `ledger/phase-P7.md` | 84 |
| P8 | `ledger/phase-P8.md` | 76 |
| P9 | `ledger/phase-P9.md` | 17 |
| P10 | `ledger/phase-P10.md` | 13 |

The final route tables for P2 to P10 are not written yet. They depend on decisions D1, D2 and D6,
and on what P1 shows about the merge rule in practice.
