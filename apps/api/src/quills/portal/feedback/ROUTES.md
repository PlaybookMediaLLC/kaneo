# P3b route set: public feedback and customer writes

All routes are under `/quills-public/{workspace}` and use `defineQuillsRoute`. The source rows
are in `docs/quills-port/ledger/phase-P3.md`. The shared logic is in this folder. The widget
declares the same factories with `audience: "widget"` in `../../widget/feedback`.

## Product rule: portals are opt-in

- `portalConfig.enabled` (settings JSON, no migration) is off until a teammate sets it with
  `PUT /quills/{workspaceId}/settings/portal` (`{ "enabled": true }`). The settings read
  returns it.
- While it is off, every `portal` and `public` route returns 404 with the unknown-workspace
  message. This includes the P3a routes `GET /portal/config`, `GET /portal/access`,
  `POST /portal/access-denied`, the `/user/profile` routes and `GET /user/avatar/{customerId}`.
- Routes under `/widget/` follow the widget's own `enabled` flag, not the portal flag.
- A missing flag is off, so every existing installation keeps its portal closed.
- `feedback.test.ts` calls every portal and public route with the portal off. It checks 404,
  no hidden or own value in the body, and no changed row.

## Private portal and the widget (decision to confirm)

On a private portal (`access.visibility: "private"`), portal routes apply the P3a gate
(403 `Portal access required`), and the feed and sitemap are empty. Widget routes admit only a
visitor that the host app identified with a signed token; an anonymous widget session gets
403. The source did not gate its widget functions, so anyone who minted an anonymous session
could read a private portal. This port closes that path. An owner can relax it later, for
example with `access.widgetSignIn`.

## Boundary map

```
Tables and owning schema:  quills: boards, board_projects (read), posts, post_votes,
                           post_comments, post_comment_reactions, post_subscriptions,
                           post_activity, post_edit_history, post_comment_edit_history,
                           post_tags, post_tag_assignments, post_statuses, roadmaps,
                           roadmap_columns, changelog_entries, changelog_entry_posts,
                           changelog_categories, changelog_entry_categories, user_segments,
                           segments, principal, customer_identity, settings, kv_store
                           (receipts, anonymous widget sessions), audit_log, events,
                           job_queue, rate_bucket. public: none.
Actor and workspace:       the framework resolvers (portal: Kaneo session; widget: widget
                           session Bearer; public: none). The workspace comes from the path
                           through withQuillsAudience. No body or query field names an actor.
Permissions:               none of Kaneo's. viewer.ts applies the portal flag, the
                           private-portal gate (403), the widget flag, the board tiers, the
                           author rules and the anonymous switch.
Transaction:               one scoped transaction per request; the count, moderation state,
                           activity row, receipt and outbox event commit together. A rate
                           limit runs first in its own transaction.
External effects:          none; each mutation records one outbox event (follow records none).
```

## What a customer never sees

A teammate on these routes is a customer. These rules apply to lists, details, counts, search,
similar posts, voted posts, roadmap posts, the changelog, the feed and the sitemap:

- boards whose view tier does not admit the caller (`team` never does), deleted boards and
  boards with `board_projects` links
- deleted posts, merged posts in lists, and held (`pending`) posts of other people
- private (internal) comments and held comments of other people; a deleted comment keeps its
  place with empty content and no author
- posts, comments, votes and reactions of test customers (except the test customer's own posts
  and comments)
- drafts, scheduled and deleted changelog entries, and entries whose `segmentIds` or one of
  whose categories' `segmentIds` exclude the caller; the `authenticated` changelog audience
  hides every entry from a caller without sign-in
- team roadmaps, and segment roadmaps outside the caller's segments
- board access matrices, segment IDs, roadmap filters, principal IDs of authors and emails

## Portal (Kaneo account; sign-in optional on reads)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsPortalBoards` | `GET /portal/boards` (`counts=true` adds `postCount`) | read | boards, board_projects, posts | - | contract, portal-off |
| `listQuillsPortalStatuses` | `GET /portal/statuses` | read | post_statuses | - | contract, portal-off |
| `listQuillsPortalTags` | `GET /portal/tags` (public tags only) | read | post_tags | - | contract, portal-off |
| `listQuillsPortalPosts` | `GET /portal/posts` (`boardId`, `stage`, `search`, `sort` incl. `random`, `cursor`, `limit` 1-50); without `sort`, the board's `defaultSort`, else newest | read | posts, post_statuses, principal, post_tags, post_votes, post_subscriptions, boards | - | contract, ownership, moderation, voting |
| `findQuillsPortalSimilarPosts` | `GET /portal/posts/similar?title=` (60 per minute per client) | read | posts, post_statuses | - | contract, portal-off |
| `getQuillsPortalPost` | `GET /portal/posts/{postId}` | read | posts, post_votes, post_comments, post_subscriptions | - | contract, moderation |
| `createQuillsPortalPost` | `POST /portal/posts` (20 per 10 min per client) | create | posts, post_votes, post_subscriptions, post_activity, kv_store | `post.created` | contract, rollback, idempotency, moderation |
| `editQuillsPortalOwnPost` | `PUT /portal/posts/{postId}` (30 per 10 min; a held edit goes back to review) | update | posts, post_edit_history | `post.updated` | contract, rollback, ownership, author rules |
| `deleteQuillsPortalOwnPost` | `DELETE /portal/posts/{postId}` (30 per 10 min) | delete | posts, post_activity | `post.deleted` | contract, rollback, ownership |
| `setQuillsPortalVote` | `PUT /portal/posts/{postId}/vote` `{voted, importance?}` (120 per 10 min) | update | post_votes, posts | `post.voted` / `post.unvoted` when changed; `post.vote_importance_set` when the importance changes | contract, rollback, desired state, voting |
| `setQuillsPortalFollow` | `PUT /portal/posts/{postId}/follow` `{following}` (120 per 10 min) | update | post_subscriptions | none: the caller's own subscription | contract, rollback |
| `listQuillsPortalVotedPosts` | `GET /portal/voted-posts` (at most 1,000) | read | post_votes, posts | - | contract |
| `getQuillsPortalUserStats` | `GET /portal/user/stats` (sign-in) | read | posts, post_comments, post_votes | - | contract |
| `listQuillsPortalPostComments` | `GET /portal/posts/{postId}/comments` | read | post_comments, principal, post_comment_reactions | - | contract, moderation |
| `createQuillsPortalComment` | `POST /portal/posts/{postId}/comments` (30 per 10 min) | create | post_comments, posts, kv_store | `comment.created` | contract, rollback, moderation |
| `editQuillsPortalOwnComment` | `PUT /portal/comments/{commentId}` (30 per 10 min; a held edit goes back to review and out of the count) | update | post_comments, post_comment_edit_history, posts | `comment.updated` | contract, rollback, ownership, author rules |
| `deleteQuillsPortalOwnComment` | `DELETE /portal/comments/{commentId}` (30 per 10 min) | delete | post_comments, posts, post_activity | `comment.deleted` | contract, rollback, ownership |
| `setQuillsPortalCommentReaction` | `PUT /portal/comments/{commentId}/reactions` `{emoji, reacted}` (120 per 10 min) | update | post_comment_reactions | `comment.reacted` / `comment.unreacted` when changed | contract, rollback |
| `listQuillsPortalRoadmaps` | `GET /portal/roadmaps` | read | roadmaps, roadmap_columns | - | contract |
| `listQuillsPortalRoadmapPosts` | `GET /portal/roadmaps/{roadmapId}/posts` (`statusId` of a column, `bucketId`, `search`, `sort`, offset paging) | read | roadmaps, posts, boards, post_tag_assignments, user_segments | - | contract |
| `listQuillsPortalChangelog` | `GET /portal/changelog` (offset paging, 1-50) | read | changelog_* , posts, post_votes, principal | - | contract |
| `getQuillsPortalChangelogEntry` | `GET /portal/changelog/{entryId}` | read | same | - | contract |
| `setQuillsPortalChangelogReaction` | `PUT /portal/changelog/{entryId}/reactions` `{emoji, reacted}` (120 per 10 min; RFC 0003, `../changelog-engagement.ts`) | update | changelog_reactions | `changelog.reacted` / `changelog.unreacted` when changed | contract, rollback, uniqueness, foreign entry |
| `markQuillsPortalChangelogRead` | `PUT /portal/changelog/read` (120 per 10 min) | update | changelog_reads | none: the caller's own read mark | contract, rollback, per-caller marks |
| `getQuillsPortalChangelogUnread` | `GET /portal/changelog/unread` (at most 99; 0 without a profile) | read | changelog_entries, changelog_reads, principal | - | contract, per-caller counts |
| `listQuillsPortalMyFeedback` | `GET /portal/my-feedback` (`filter` all, mine, voted or following; offset paging, 1-50; RFC 0003, `../my-feedback.ts`) | read | posts, post_votes, post_subscriptions, boards, post_statuses | - | contract, visibility |

Each changelog entry also returns `reactions` (counts without test customers, and whether the
caller reacted) and `unread`. The read mark is the caller's last mark, else the time its profile
was created, so a new visitor does not see the whole history as new.

RFC 0003 voting-bias controls: a board's settings JSON holds `voteDisplay` and `defaultSort`.
With `voteDisplay` `hidden`, the portal and widget posts, similar posts, roadmap posts and the vote
response leave out `voteCount`; the vote still works. The `random` order hashes the caller's principal (or "anonymous") and the UTC day,
so one viewer pages through one order for one day. `voting.test.ts` covers these rules.

Every portal write sets `ensureCustomer`, so the caller's customer profile exists before the
write. Every portal route checks the private-portal gate (403 `Portal access required`).

## Widget (widget session Bearer, anonymous or identified)

The same factories under `/widget/`: `listQuillsWidgetBoards`, `listQuillsWidgetPosts`,
`findQuillsWidgetSimilarPosts`, `getQuillsWidgetPost`, `createQuillsWidgetPost`,
`setQuillsWidgetVote`, `setQuillsWidgetFollow`, `listQuillsWidgetVotedPosts`,
`getQuillsWidgetUserStats`, `listQuillsWidgetPostComments`, `createQuillsWidgetComment`,
`setQuillsWidgetCommentReaction`, `listQuillsWidgetChangelog`, `getQuillsWidgetChangelogEntry`,
`setQuillsWidgetChangelogReaction`, `markQuillsWidgetChangelogRead`,
`getQuillsWidgetChangelogUnread`. Without sign-in, a widget visitor reacts only while the
workspace allows anonymous interaction.
Every widget route needs a widget session, also for reads. Edit and delete of own content,
statuses, tags and roadmaps are portal only, as in the source.

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `createQuillsWidgetAnonymousSession` | `POST /widget/anonymous-session` (10 per hour per client) | public | create | customer_identity, principal, kv_store | `user.created` | contract, rollback, anonymous writes |

An anonymous session is an identity, not a permission: anonymous votes, comments, reactions
and posts still need the portal's `features.allowAnonymous` and the board tier.

## Public (no identity)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsPublicChangelogFeed` | `GET /changelog/rss.xml` (RSS 2.0, 50 newest; 30 per minute per client) | read | settings, changelog_* | - | contract, portal-off, private portal |
| `getQuillsPublicSitemap` | `GET /sitemap.xml` (sitemap XML; 30 per minute per client) | read | boards, posts, changelog_entries | - | contract, portal-off, private portal |

Both show what an anonymous visitor of a public portal sees; a private portal gives empty lists.

## Merged source rows

- `listQuillsPortalBoards`: `portal.ts#fetchPublicBoards`, `#fetchPublicBoardBySlug` (the list
  carries slugs), `#fetchBoardCapabilitiesFn`, `widget/posts.ts#widgetFetchBoardCapabilitiesFn`,
  and the boards and board permissions of `#fetchPortalData`.
- `listQuillsPortalPosts`: `public-posts.ts#listPublicPostsFn`, `portal.ts#fetchPublicPosts`,
  the posts and voted posts of `#fetchPortalData`, `widget/posts.ts#widgetListPublicPostsFn`.
- `getQuillsPortalPost`: `portal.ts#fetchPublicPostDetail`, `#getCommentsSectionDataFn`,
  `public-posts.ts#getVoteSidebarDataFn`, `#getPostPermissionsFn`, `portal.ts#fetchSubscriptionStatus`
  (the caller's own `following` flag), `widget/posts.ts#widgetFetchPublicPostDetailFn`.
- `listQuillsPortalPostComments`: the comments of `#fetchPublicPostDetail`.
- `setQuillsPortalVote`: `public-posts.ts#toggleVoteFn`, `widget/posts.ts#widgetToggleVoteFn`.
- `setQuillsPortalCommentReaction`: `comments.ts#addReactionFn`, `#removeReactionFn` and the
  widget versions.
- `listQuillsPortalRoadmaps`: `portal.ts#fetchPublicRoadmaps`, `public-posts.ts#listPublicRoadmapsFn`.
- `listQuillsPortalRoadmapPosts`: `portal.ts#fetchPublicRoadmapPosts`, `#fetchPublicRoadmapColumns`
  (one request per column), `#fetchPublicRoadmapDateBuckets` (buckets on the first page),
  `public-posts.ts#getPublicRoadmapPostsFn`, `#getRoadmapPostsByStatusFn`.
- `listQuillsPortalChangelog` and `getQuillsPortalChangelogEntry`: the public parts of
  `changelog.ts`, `widget/changelog.ts`.
- `getQuillsPortalUserStats`: `user.ts#getUserStatsFn`, `widget/user.ts#widgetGetUserStatsFn`.
- Avatars (`portal.ts#fetchAvatars`, `#fetchUserAvatar`): each post, comment and changelog
  author carries `avatarUrl` (http(s) only). P3a keeps `GET /user/avatar/{customerId}`.
- `getQuillsPublicChangelogFeed`: `routes/changelog/feed.ts`; `rss.ts` and `rss[.]xml.ts`
  only redirect to the feed in the source.
- `getQuillsPublicSitemap`: `routes/sitemap[.]xml.ts`.
- The XML routes (`raw` in `defineQuillsRoute`) replace the earlier JSON `/changelog/feed` and
  `/sitemap`; nothing else read them. Page links are `KANEO_CLIENT_URL/portal/{workspaceId}/...`, the
  portal path of the invite and post mails (`feeds.ts#portalUrl`). The feed's self link is
  `KANEO_API_URL/api/quills-public/{workspaceId}/changelog/rss.xml`, as the unsubscribe link builds it.
  The help-center sitemap and the status feed use the same helpers.

## Differences from the source (packages/widget RFCs win)

| Item | Source | Here | Reason |
|---|---|---|---|
| Vote | toggle | desired state `{voted}` | RFC 0003; a retry changes nothing |
| Follow | auto-subscribe on vote and comment | explicit `{following}`; only the author is subscribed on create | RFC 0003: following is interest, not consent |
| Comment vote | none (emoji reactions) | the `👍` reaction | RFC 0003 comment votes without a new table |
| Reactions | any emoji | a bounded set of 7 | RFC 0003 "bounded supported emoji" |
| Create post and comment | no idempotency | optional `idempotencyKey` in the body; same payload replays (`replayed: true`, no second event), another payload is 409 | RFC 0002 receipts; the framework passes no headers |
| Post title | required | optional; the first line of `content` | RFC 0003 `{ body, boardId? }` |
| Board | required | optional; the first board (by name) that accepts the caller | RFC 0003 |
| Status | stored status | stored status plus `stage` (`open`, `planned`, `in_progress`, `shipped`, or null for a closed status): category `complete` is shipped, slugs `planned` and `in_progress` map directly, other active statuses are open | RFC 0003 explicit mapping |
| Comment depth | unbounded | at most 10 levels (409) | RFC 0003 "reject excessive depth" |
| Widget reads | optional session | session required (anonymous or identified) | RFC 0001; an expired session is a 401, not a silent anonymous view |
| Edit and delete rule | `voteCount > 0` blocks, so the author's own vote blocks | a team review, a merged-in post, and votes and public comments by others block; private notes, held comments and test customers do not count, so a refusal shows nothing hidden; an edit goes through moderation again | the source rule blocked every post |
| Team reply rule on comments | any team reply blocks | only a public, published team reply blocks | a private note must not show through a refusal |
| Similar posts | embeddings and full text | full text on any word | no embedding service in this slice |

## Not built in this slice

| Item | Reason |
|---|---|
| 404 before 401/403/429 while the portal is off | The framework counts the rate limit and resolves the caller before the handler. A signed-out caller on a sign-in route gets 401, a blocked account 403. No data leaks. A strict 404 needs a gate hook in `defineQuillsRoute`. |
| Anonymous writes in the portal | A portal caller is a Kaneo session (D1). Anonymous writes go through the widget's anonymous session. |
| Anonymous to identified merge | P3a identify does not take a `previousToken` yet. |
| Tag filters, owner and segment filters, facets, `minVotes`, `responded`, `dateFrom` on the post list | Team-only or not needed by the widget RFC; add when the portal UI needs them. |
| Voter avatars (`FeedbackPost.voters`) | Not served: names of voters are private by default. |
| Edit history display (`showPublicEditHistory`) | No read route for edit history yet. |
| Public user profiles (`public-profile.ts`) | Built in RFC 0001 lane M1; see `../ROUTES.md`, "Public profiles". |
| Request activity (RFC 0005), article feedback, attachments (RFC 0004) | Out of scope; need tables and the storage flow. |
| `holdImages` | Customer content is plain text, so it has no images. Links are found with a plain-text pattern. |
| Retention of anonymous widget people | Each anonymous session creates a customer and a principal. Retention deletes the expired session, not the person. |

## Changes outside this folder

- `settings/portal.ts`: the `enabled` flag (read and update).
- `portal/config.ts`, `portal/access.ts`, `portal/profile.ts`: 404 while the portal is off.
  `profile.ts` uses the shared `httpUrl`.
- `portal/seed.fixture.ts`, `portal/profile.fixture.ts`, `framework/audience.test.ts`: the P3a
  seeds turn the portal on, because it is now off by default.
- `public.ts` mounts this folder and `widget/feedback`.
- `apps/docs/openapi.json` is not regenerated in this slice; run `pnpm openapi:check:fix` at
  merge.
