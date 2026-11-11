# P6b route table: public help center, public status page and widget help

All paths are under `/quills-public/{workspace}`. `{workspace}` is a workspace ID or slug.
`quills/public.ts` mounts `content/public/index.ts` and `widget/help/index.ts`. Every route
uses `defineQuillsRoute`. The `Audience` column is the declaration's `audience` field. For a
route that is not a teammate route, the action is for the ledger only: the audience resolver
and the gates below authorize. The source rows are in `docs/quills-port/ledger/phase-P6.md`
(deferred rows) and `phase-P4.md` (status subscriptions).

## Boundary map

```
Tables and owning schema:      quills: settings (portal_config, feature_flags,
                               help_center_config, widget_config, metadata.statusSettings;
                               read only), kb_categories, kb_articles,
                               kb_article_translations, kb_category_translations,
                               hc_redirect_rules (read), kb_article_feedback,
                               kb_search_queries (insert), segments, user_segments (read),
                               principal (read: teammate author names), status_components,
                               status_component_groups, status_component_events,
                               status_incidents, status_incident_updates,
                               status_incident_components (read), status_subscriptions,
                               unsubscribe_tokens, rate_bucket, audit_log, events, job_queue.
                               public: no table is read.
Actor and workspace source:    portal: the Kaneo session (optional on reads); widget: the
                               widget session Bearer token (optional on reads); public: none.
                               The workspace comes from the path through withQuillsAudience.
Permissions:                   none of Kaneo's. The gates and visibility predicates below
                               authorize. A teammate on these routes is a visitor.
Persisted relationships:       principal -> user_segments (segment gates),
                               kb_article_feedback.principal_id (one vote per principal),
                               status_subscriptions.principal_id, unsubscribe_tokens.principal_id.
Transaction:                   one scoped transaction per request; a rate limit runs first in
                               its own committed transaction.
External effects:              none in a request. Mutations record outbox events only; the mail
                               worker sends status subscriber mail after commit.
Completion checks:             tenant/object access, mutation, read/search (evidence table,
                               apps/api/AGENTS.md). Authenticated-endpoint rows apply to the
                               portal and widget session paths.
```

## Gates

- Help center, portal routes: the portal settings key `enabled` is `true` (default false), the
  `helpCenter` module flag (`settings.feature_flags`, the source's `isFeatureEnabled('helpCenter')`)
  is on, and the private-portal gate admits the caller. Otherwise 404.
- Widget help: the `helpCenter` module flag and the widget's own `enabled` switch. The portal switch
  does not apply: the widget is a separate surface. Otherwise 404.
- Sitemap: the portal help-center gate for an anonymous caller, and `seo.indexable` and
  `seo.sitemapEnabled`. Otherwise 404.
- Status page: the `statusPage` module flag, the page's own `enabled` switch (P6 settings), the
  private-portal gate and the page audience (`public`, `authenticated` = signed in,
  `segments` = a member of an allowed live segment). Otherwise 404. The portal `enabled` key does
  not apply. The subscription GET and DELETE and the token route work while the page is closed, so
  an opt-out always works.

## Visibility

- Article: not deleted, `published_at` set and not in the future, article segment gate passed, in a
  live public category whose segment gate passes. A segment gate is `[]` (everyone) or a list that
  needs the caller's principal in one of the live segments.
- Another locale needs a published translation of a public article. A category needs a non-empty
  translated name. Portal pages take one of the 13 supported codes (400 otherwise) and answer 404
  for a supported locale that is not enabled. Search and the widget take any BCP-47 tag (the widget
  sends its own UI locale, for example `pt-BR`) and read the default locale when the tag has no
  enabled locale.
- A category with no public article is left out. Counts include public subcategories only. A
  category whose parent is not public reports `parentId: null`.
- Status component: live and past its segment gate. Incident: live and linked to a visible live
  component. With a component hidden, the visible components may lower the incident impact, never
  raise it (the source's `deriveViewerImpact`).
- Helpfulness counts, segment IDs, drafts, deleted rows and teammate-only fields are never in a
  response. Public URL IDs (`urlId`) are read only.

## Help center (portal, sign-in optional)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `getQuillsPublicHelpCenter` | `GET /hc` (`locale`) | portal | read | `settings`, `kb_*` | - | contract, feature |
| `getQuillsPublicHelpCenterCategory` | `GET /hc/categories/{categorySlug}` (`locale`) | portal | read | `kb_*` | - | contract, feature |
| `getQuillsPublicHelpCenterCollection` | `GET /hc/collections/{idSlug}` (`locale`) | portal | read | `kb_*` | - | contract |
| `getQuillsPublicHelpCenterArticle` | `GET /hc/articles/{idSlug}` (`locale`) | portal | read | `kb_*`, `principal` | - | contract, feature |
| `listQuillsPublicHelpCenterCategoryArticles` | `GET /hc/categories/{categoryId}/articles` (`locale`) | portal | read | `kb_*` | - | contract |
| `listQuillsPublicHelpCenterEditors` | `GET /hc/editors` (names only, 3 per category) | portal | read | `kb_articles`, `kb_categories`, `principal` | - | contract |
| `resolveQuillsPublicHelpCenterRedirect` | `GET /hc/redirect?path=` | portal | read | `hc_redirect_rules`, `kb_*` | - | contract, feature |
| `searchQuillsPublicHelpCenter` | `POST /hc/search` (60 per minute per client) | portal | read | `kb_*`, `kb_search_queries` | none (analytics row) | contract, feature |
| `recordQuillsPublicArticleFeedback` | `POST /hc/articles/{articleId}/feedback` (30 per 10 min) | portal | create | `kb_article_feedback`, `kb_articles` | `help_center.article_feedback_recorded` | contract, rollback, feature |
| `submitQuillsPublicArticleFeedbackReason` | `POST /hc/feedback/{feedbackId}/reason` (10 per 10 min) | portal | create | `kb_article_feedback` | `help_center.article_feedback_reason_added` | contract, rollback, feature |
| `getQuillsPublicHelpCenterSitemap` | `GET /hc/sitemap.xml` (sitemap XML with hreflang alternates, ≤ 50,000 URLs) | portal (anonymous view) | read | `settings`, `kb_*` | - | contract, feature |

Merged: `listPublicCategoriesFn`, `listPopularPublicArticlesFn` and the config into `GET /hc`;
`getPublicCategoryBySlugFn` and `getPublicCategoryPageFn` into the slug route;
`getPublicCollectionPageFn`; `getPublicArticlePageFn` (with `listPublicArticlesForCategoryFn` as
its sibling list); `listPublicArticlesForCategoryFn`; `listPublicCategoryEditorsFn`;
`resolveHelpCenterRedirectFn`; `searchPublicArticlesFn`; `recordArticleFeedbackFn`;
`submitArticleFeedbackReasonFn`; `routes/hc/sitemap[.]xml.ts`. Localized routes (`/hc/{locale}/...`)
are the `locale` query on each read; the canonical paths in responses keep the source URL form
`/hc/{locale}/articles/{urlId}-{slug}` and `/hc/{locale}/collections/{urlId}-{slug}`.

## Widget help (widget session optional, except the vote)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `listQuillsWidgetHelpCategories` | `GET /widget/help/categories` (`locale`) | widget | read | `settings`, `kb_*` | - | contract |
| `listQuillsWidgetHelpArticles` | `GET /widget/help/articles` (`categoryId`, `locale`, `offset`, `limit` ≤ 100) | widget | read | `kb_*` | - | contract |
| `getQuillsWidgetHelpArticle` | `GET /widget/help/articles/{ref}` (TypeID or slug; default-locale fallback; the visitor's `helpful`) | widget | read | `kb_*`, `kb_article_feedback` | - | contract, feature |
| `setQuillsWidgetHelpArticleFeedback` | `PUT /widget/help/articles/{articleId}/feedback` (session required; 30 per 10 min) | widget | update | `kb_article_feedback`, `kb_articles` | `help_center.article_feedback_recorded` | contract, rollback, feature |
| `searchQuillsWidgetHelp` | `POST /widget/kb-search` (60 per minute per client) | widget | read | `kb_*`, `kb_search_queries` | none (analytics row) | contract, feature |

Merged: `widgetListPublicCategoriesFn`; `widgetListPublicArticlesFn` and
`widgetListPublicArticlesForCategoryFn`; `widgetResolvePublicArticleRefFn`;
`widgetRecordArticleFeedbackFn`; `routes/api/widget/kb-search.ts`. `kb-ask` belongs to P8.

## Status page (portal, sign-in optional) and subscriptions

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `getQuillsPublicStatusPage` | `GET /status` | portal | read | `settings`, all status tables but subscriptions | - | contract, feature |
| `getQuillsPublicStatusIncident` | `GET /status/incidents/{incidentId}` | portal | read | `status_incidents`, updates, links, components | - | contract, feature |
| `getQuillsPublicStatusUptime` | `GET /status/uptime?componentIds=` (≤ 50, `windowDays` ≤ 365) | portal | read | `status_components`, `status_component_events` | - | contract |
| `listQuillsPublicStatusHistory` | `GET /status/history` (`cursor`, `limit` ≤ 50, `before`) | portal | read | incidents, updates, links, components | - | contract, feature |
| `listQuillsPublicStatusFeed` | `GET /status/rss.xml` (RSS 2.0, one item per update; `limit` ≤ 100) | portal | read | incidents, updates, links, components | - | contract, feature |
| `getQuillsMyStatusSubscription` | `GET /status/subscription` | portal | read | `status_subscriptions` | - | contract, feature |
| `subscribeQuillsStatus` | `PUT /status/subscription` (`page`, or visible `components`; 20 per 10 min) | portal | update | `status_subscriptions`, `status_components` | `status.subscribed` | contract, rollback, feature |
| `unsubscribeQuillsStatus` | `DELETE /status/subscription` (keeps the row as the opt-out) | portal | update | `status_subscriptions` | `status.unsubscribed` | contract, rollback, feature |
| `unsubscribeQuillsStatusByToken` | `POST /status/unsubscribe` (`token` in the body; 20 per 10 min) | public | update | `unsubscribe_tokens`, `status_subscriptions` | `status.unsubscribed` | contract, rollback, feature |

Merged: `getStatusPageFn`; `getStatusIncidentPublicFn`; `getStatusUptimeFn`; `listStatusHistoryFn`;
`listStatusFeedFn` and `routes/status/feed.ts`; `getMyStatusSubscriptionFn`, `subscribeStatusFn`,
`unsubscribeStatusFn` (P4 ledger rows `getQuillsMyStatusSubscription`, `subscribeQuillsStatus`,
`unsubscribeQuillsStatus`); the status part of `processUnsubscribeToken`.

Unsubscribe tokens: one mint, `portal/unsubscribe-token.ts#mintUnsubscribeToken` with action
`unsubscribe_status`. It stores the SHA-256 hash in `unsubscribe_tokens.token`, a 30-day expiry and single
use. Both `POST /status/unsubscribe` and the generic `/unsubscribe` routes accept the token. The status
route answers 200 for every token; `changed` says whether it unsubscribed someone.

Subscriber mail (`jobs/handlers/status-mail.ts`): an incident published (`status.incident_published`) or
updated (`status.incident_update_posted`, `status.incident_resolved`), and a maintenance window that starts
(`status.maintenance_started`, a timeline update from scheduled to running, or a window published running).
Only incidents with `notify_subscribers` and not backfilled. Recipients are the live subscriptions (at most
10,000 jobs). The mail shows only the components the subscriber may see (component segment gates); a
components subscription hears only about an incident on one of its components. At send time the module
flag, the page switch, the private-portal gate and the page audience must admit the subscriber, and a
Kaneo account's address must be verified. One mail per event and subscriber (`mail:{eventId}:{principalId}`).

## Not built, or built in part

| Item | Reason |
|---|---|
| Email-only (double opt-in) status subscription and its confirm step | The source keeps no raw-email subscribers: a subscriber is always a principal. A signed-in portal customer needs no confirmation. A confirm mail also needs customer mail delivery (below). |
| Status mail for a scheduled (not started) maintenance window | The mail goes when the window starts, not when it is scheduled. |
| `getRelatedPublicArticlesFn` and semantic search | Related articles and the hybrid ranking need article embeddings (AI, P8). The article page lists the other public articles of its category. |
| `getPublicArticleBySlugFn` (legacy `/hc/articles/{category}/{slug}` URLs) | The portal pages use the stable `{urlId}-{slug}` form; redirect rules cover moved paths. The widget route resolves slugs. |
| Popular articles by views | Nothing increments `view_count` yet, so the six "popular" articles are the newest published ones until it does. |
| Custom help-center domain redirects | Another phase (`help-center-domain.service.ts`). |

## Widget RFC differences (packages/widget, RFC 0003 and 0005)

A thin adapter maps these routes to `HelpArticle` and the help views:

1. Paths are `/quills-public/{workspace}/widget/help/...` and `/widget/kb-search`, not
   `/api/widget/help/...`.
2. Article bodies are Markdown in `content`; there is no `blocks` array or plain-text `body`. The
   adapter derives `body` (plain text) and `blocks` from the Markdown with its own sanitizer.
3. `HelpArticle.category` is a name; the API returns `category: { id, urlId, slug, name }`.
4. `author` is `{ name }` only (no avatar); `url` is the relative `path`; `updatedAt` is the
   translation's time in another locale.
5. RFC 0005 `PUT /api/widget/help/:id/feedback` maps to
   `PUT /widget/help/articles/{articleId}/feedback`. It returns `{ feedbackId, helpful, changed }`,
   not an article projection and revision; the adapter re-reads the article (its `helpful` field)
   if it needs the projection. It needs an identified widget session: anonymous widget sessions do
   not exist yet (P3a).
6. Search is a POST with a JSON body (`query`, `locale`, `limit` ≤ 20) because it records a
   search-term row; the RFC leaves the method open. Matching is PostgreSQL full text plus a literal
   title substring, not the RFC's "every query term" local rule.
7. 404 for an unknown or hidden article (the source widget returned `null`).
8. No `Retry-After` header on 429: the framework's rate limit does not set one.

## Changes outside these folders

- `quills/public.ts`: mounts the two routers.
- `quills/events.ts`: adds `help_center.article_feedback_reason_added`, `status.subscribed`,
  `status.unsubscribed` to the event catalogue.
- `content/help-center/redirect-rules.ts`: exports `normalize`; `content/status/overview.ts`:
  exports `uptimeSeriesFor`. No behavior change.
- `content/index.fixture.ts`, `widget/index.fixture.ts`: export the new fixtures to the contract suite.

## Required migrations

None.
