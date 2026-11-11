# P6 route table: help center and status page (teammate routes)

All paths are under `/quills/{workspaceId}`. Every route in this file is for teammates.
The source rows are in `docs/quills-port/ledger/phase-P6.md`. The merge rule and the
action mapping are in `docs/quills-port/detailed-plan.md`, sections 2 and 3.

Action decisions:

- `HELP_CENTER_MANAGE` covers all help-center work in the source. Articles and article
  translations are content: `create`, `update`, `delete`. Categories, category translations,
  redirect rules and help-center settings are structure or configuration: `manage_settings`
  (the P1 precedent for changelog categories, tags and boards). Reads are `read`.
- `STATUS_PAGE_PUBLISH` (incidents, maintenance, updates) is content: `create`, `update`,
  `delete`. `STATUS_PAGE_MANAGE` (components, groups, templates, subscribers, history reset,
  settings writes) is configuration: `manage_settings`. Reads of non-sensitive data are `read`.
  Subscriber lists and exports hold customer emails, so they keep the source gate: `manage_settings`.
- A restore needs the action of the delete it undoes (P1 precedent).
- A full reorder list holds at most 500 IDs. A parent with more live children cannot be
  reordered through these routes; `position` on create and update still works.

## Boundary map

```
Tables and owning schema:      quills.kb_categories, kb_articles, kb_article_feedback,
                               kb_article_translations, kb_category_translations,
                               hc_redirect_rules, kb_search_queries, segments (read),
                               principal (read), user (read, customer emails), settings
                               (help_center_config, metadata.statusSettings),
                               status_component_groups, status_components,
                               status_component_events, status_incidents,
                               status_incident_updates, status_incident_components,
                               status_incident_templates, status_subscriptions.
                               No public table is read.
Actor and workspace source:    authenticated context (defineQuillsRoute)
Permissions:                   workspace:read + quills:<action>; native: none
Persisted relationships:       none (no board_projects, post_tasks or team links)
Transaction:                   one scoped transaction per request
External effects:              none in the request; outbox events only (P4 handlers deliver)
Completion checks:             authenticated endpoint, tenant/object access, mutation or
                               batch, read/search/export (evidence table, apps/api/AGENTS.md)
```

## Help center

### Categories

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsHelpCenterCategories` | `GET /help-center/categories` (`deleted`, `offset`, `limit` ≤ 100) | read | `kb_categories`, `kb_articles` | - | contract, page-bounds |
| `getQuillsHelpCenterCategory` | `GET /help-center/categories/{categoryId}` | read | `kb_categories` | - | contract |
| `createQuillsHelpCenterCategory` | `POST /help-center/categories` | manage_settings | `kb_categories`, `segments` | `help_center.category_created` | contract, rollback |
| `updateQuillsHelpCenterCategory` | `PATCH /help-center/categories/{categoryId}` (nesting: depth ≤ 3, no cycle) | manage_settings | `kb_categories`, `segments` | `help_center.category_updated` | contract, rollback, feature |
| `deleteQuillsHelpCenterCategory` | `DELETE /help-center/categories/{categoryId}` (soft; subtree and its articles; their redirect rules) | manage_settings | `kb_categories`, `kb_articles`, `hc_redirect_rules` | `help_center.category_deleted` | contract, rollback, feature |
| `restoreQuillsHelpCenterCategory` | `POST /help-center/categories/{categoryId}/restore` (≤ 30 days, live parent, depth ≤ 3) | manage_settings | `kb_categories` | `help_center.category_restored` | contract, rollback |
| `reorderQuillsHelpCenterCategories` | `PUT /help-center/categories/order` (`parentId`, every live child once) | manage_settings | `kb_categories` | `help_center.categories_reordered` | contract, rollback, batch |

Merged: 12. Source: `listCategoriesFn`, `getCategoryFn`, `createCategoryFn`, `updateCategoryFn`,
`deleteCategoryFn`, `restoreCategoryFn`; v1 `GET`, `POST` `/help-center/categories`, `GET`, `PATCH`,
`DELETE` `/help-center/categories/{categoryId}`. The source has no reorder function: it writes
`position` per category. `reorderQuillsHelpCenterCategories` is a requested Kaneo addition; `position`
stays writable on create and update.

### Articles

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsHelpCenterArticles` | `GET /help-center/articles` (category, status, search, deleted, sort, cursor, `limit` ≤ 100; drafts included; no `content`) | read | `kb_articles`, `kb_categories`, `principal` | - | contract, page-bounds |
| `getQuillsHelpCenterArticle` | `GET /help-center/articles/{articleId}` | read | `kb_articles`, `kb_categories`, `principal` | - | contract |
| `createQuillsHelpCenterArticle` | `POST /help-center/articles` (draft; no category files it under General) | create | `kb_articles`, `kb_categories`, `segments` | `help_center.article_created` | contract, rollback |
| `updateQuillsHelpCenterArticle` | `PATCH /help-center/articles/{articleId}` (fields and `published`) | update | `kb_articles`, `kb_categories`, `segments`, `settings` | `help_center.article_updated`, or `help_center.article_published` / `help_center.article_unpublished` on the state change | contract, rollback, feature |
| `deleteQuillsHelpCenterArticle` | `DELETE /help-center/articles/{articleId}` (soft; its redirect rules) | delete | `kb_articles`, `hc_redirect_rules` | `help_center.article_deleted` | contract, rollback |
| `restoreQuillsHelpCenterArticle` | `POST /help-center/articles/{articleId}/restore` (≤ 30 days, live category) | delete | `kb_articles` | `help_center.article_restored` | contract, rollback |
| `reorderQuillsHelpCenterArticles` | `PUT /help-center/categories/{categoryId}/articles/order` (every live article once) | update | `kb_articles` | `help_center.articles_reordered` | contract, rollback, batch |

Merged: 16. Source: `listArticlesFn`, `getArticleFn`, `createArticleFn`, `updateArticleFn`,
`publishArticleFn`, `unpublishArticleFn`, `deleteArticleFn`, `restoreArticleFn`; v1 `GET`, `POST`
`/help-center/articles`, `GET`, `PATCH`, `DELETE` `/help-center/articles/{articleId}`. Publish and
unpublish merge into `PATCH` as `published` (the v1 `publishedAt` field). `reorderQuillsHelpCenterArticles`
is a requested Kaneo addition. `published` (and `publishedAt`) is the field that later public routes filter on.
`urlId` is never accepted: the identity column allocates it on insert, and no route writes it.

### Article feedback and analytics

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `recordQuillsHelpCenterArticleFeedback` | `POST /help-center/articles/{articleId}/feedback` (the caller's vote) | create | `kb_article_feedback`, `kb_articles` | `help_center.article_feedback_recorded` | contract, rollback |
| `listQuillsHelpCenterArticleFeedbackReasons` | `GET /help-center/articles/{articleId}/feedback-reasons` (`limit` ≤ 100) | read | `kb_article_feedback` | - | contract, page-bounds |
| `listQuillsHelpCenterArticlePerformance` | `GET /help-center/analytics/articles` (`limit` ≤ 100) | read | `kb_articles`, `kb_categories` | - | contract, page-bounds |
| `listQuillsHelpCenterSearchTerms` | `GET /help-center/analytics/search-terms` (`days` ≤ 365, `limit` ≤ 100) | read | `kb_search_queries` | - | contract, page-bounds |

Merged: 4. Source: v1 `POST /help-center/articles/{articleId}/feedback`, `listArticleFeedbackReasonsFn`,
`listArticlePerformanceFn`, `listSearchTermsFn`.

### Translations

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsHelpCenterArticleTranslations` | `GET /help-center/articles/{articleId}/translations` (rows and a status per enabled locale) | read | `kb_article_translations`, `settings` | - | contract |
| `saveQuillsHelpCenterArticleTranslation` | `PUT /help-center/articles/{articleId}/translations` (`locale` in the body; a new row is a draft) | update | `kb_article_translations` | `help_center.article_translation_saved` | contract, rollback, feature |
| `setQuillsHelpCenterArticleTranslationStatus` | `PUT /help-center/articles/{articleId}/translations/status` | update | `kb_article_translations` | `help_center.article_translation_status_changed` | contract, rollback |
| `deleteQuillsHelpCenterArticleTranslation` | `DELETE /help-center/articles/{articleId}/translations?locale=` | delete | `kb_article_translations` | `help_center.article_translation_deleted` | contract, rollback |
| `listQuillsHelpCenterCategoryTranslations` | `GET /help-center/categories/{categoryId}/translations` | read | `kb_category_translations`, `settings` | - | contract |
| `saveQuillsHelpCenterCategoryTranslation` | `PUT /help-center/categories/{categoryId}/translations` | manage_settings | `kb_category_translations` | `help_center.category_translation_saved` | contract, rollback |
| `deleteQuillsHelpCenterCategoryTranslation` | `DELETE /help-center/categories/{categoryId}/translations?locale=` | manage_settings | `kb_category_translations` | `help_center.category_translation_deleted` | contract, rollback |

Merged: 9. Source: `listArticleTranslationsFn`, `getArticleTranslationStatusesFn`,
`upsertArticleTranslationFn`, `setArticleTranslationStatusFn`, `deleteArticleTranslationFn`,
`listCategoryTranslationsFn`, `getCategoryTranslationStatusesFn`, `upsertCategoryTranslationFn`,
`deleteCategoryTranslationFn`. The locale is in the body or query, not the path: the contract
check `foreign-ids` needs a workspace B value for every path parameter.

### Redirect rules

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsHelpCenterRedirectRules` | `GET /help-center/redirect-rules` (`offset`, `limit` ≤ 100) | read | `hc_redirect_rules`, `kb_articles`, `kb_categories` | - | contract, page-bounds |
| `createQuillsHelpCenterRedirectRule` | `POST /help-center/redirect-rules` (published article or public category) | manage_settings | `hc_redirect_rules`, `kb_articles`, `kb_categories` | `help_center.redirect_rule_created` | contract, rollback |
| `deleteQuillsHelpCenterRedirectRule` | `DELETE /help-center/redirect-rules/{ruleId}` | manage_settings | `hc_redirect_rules` | `help_center.redirect_rule_deleted` | contract, rollback |

Merged: 3. Source: `listRedirectRulesFn`, `createRedirectRuleFn`, `deleteRedirectRuleFn`.

### Help-center settings

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsHelpCenterSettings` | `GET /help-center/settings` (no domain fields) | read | `settings` | - | contract |
| `updateQuillsHelpCenterSettings` | `PATCH /help-center/settings` (homepage text, header links, SEO, auto-translate flag and terms) | manage_settings | `settings` | `settings.help_center_updated` | contract, rollback |
| `enableQuillsHelpCenterLocale` | `PUT /help-center/settings/locales` (`locale`, full chrome) | manage_settings | `settings` | `settings.help_center_updated` | contract, rollback |
| `updateQuillsHelpCenterLocaleChrome` | `PATCH /help-center/settings/locales` (`locale`, partial chrome) | manage_settings | `settings` | `settings.help_center_updated` | contract, rollback |
| `disableQuillsHelpCenterLocale` | `DELETE /help-center/settings/locales?locale=` (translations stay) | manage_settings | `settings` | `settings.help_center_updated` | contract, rollback |

Merged: 7. Source: `getHelpCenterConfigFn`, `updateHelpCenterConfigFn`, `updateHelpCenterSeoFn`,
`updateHelpCenterAutoTranslateFn`, `enableHelpCenterLocaleFn`, `updateHelpCenterLocaleChromeFn`,
`disableHelpCenterLocaleFn`. The auto-translate flag is stored only. A publish with the flag on
records `autoTranslate: requested` in the `help_center.article_published` payload; no AI call runs.

## Status page

### Components and groups

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsStatusComponents` | `GET /status/components` (groups with components, and ungrouped) | read | `status_component_groups`, `status_components` | - | contract |
| `getQuillsStatusComponent` | `GET /status/components/{componentId}` | read | `status_components` | - | contract |
| `createQuillsStatusComponent` | `POST /status/components` | manage_settings | `status_components`, `status_component_groups`, `segments` | `status.component_created` | contract, rollback |
| `updateQuillsStatusComponent` | `PATCH /status/components/{componentId}` (fields and the live `status`) | manage_settings | `status_components`, `status_component_events`, `segments` | `status.component_changed` when the status changes, else `status.component_updated` | contract, rollback, feature |
| `deleteQuillsStatusComponent` | `DELETE /status/components/{componentId}` (soft) | manage_settings | `status_components` | `status.component_deleted` | contract, rollback |
| `reorderQuillsStatusComponents` | `PUT /status/components/order` (every live component once) | manage_settings | `status_components` | `status.components_reordered` | contract, rollback, batch |
| `createQuillsStatusGroup` | `POST /status/groups` | manage_settings | `status_component_groups` | `status.group_created` | contract, rollback |
| `updateQuillsStatusGroup` | `PATCH /status/groups/{groupId}` | manage_settings | `status_component_groups` | `status.group_updated` | contract, rollback |
| `deleteQuillsStatusGroup` | `DELETE /status/groups/{groupId}` (components become ungrouped) | manage_settings | `status_component_groups`, `status_components` | `status.group_deleted` | contract, rollback |
| `reorderQuillsStatusGroups` | `PUT /status/groups/order` (every group once) | manage_settings | `status_component_groups` | `status.groups_reordered` | contract, rollback, batch |

Merged: 22. Source: `listStatusComponentsAdminFn`, `listStatusComponentChoicesFn`,
`createStatusComponentFn`, `updateStatusComponentFn`, `setStatusComponentStatusFn`,
`deleteStatusComponentFn`, `reorderStatusComponentsFn`, `createStatusGroupFn`, `updateStatusGroupFn`,
`deleteStatusGroupFn`, `reorderStatusGroupsFn`; v1 `GET`, `POST` `/status/components`, `GET`, `PATCH`
`/status/components/{componentId}`, and the same four on the `/status/services` alias.

### Incidents and maintenance

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsStatusIncidents` | `GET /status/incidents` (kind, state, search, cursor, `limit` ≤ 100) | read | `status_incidents`, `status_incident_updates`, `status_incident_components`, `status_components` | - | contract, page-bounds |
| `getQuillsStatusIncident` | `GET /status/incidents/{incidentId}` | read | same, `status_subscriptions` | - | contract |
| `createQuillsStatusIncident` | `POST /status/incidents` (incident, scheduled maintenance, or a backfill) | create | `status_incidents`, `status_incident_updates`, `status_incident_components`, `status_components`, `status_component_events`, `status_incident_templates` | `status.incident_published`, or `status.incident_created` for a backfill | contract, rollback, feature |
| `updateQuillsStatusIncident` | `PATCH /status/incidents/{incidentId}` (title, impact, window, automation flags, components) | update | same | `status.incident_updated` | contract, rollback, feature |
| `postQuillsStatusIncidentUpdate` | `POST /status/incidents/{incidentId}/updates` (lifecycle status and body; resolve; reopen) | update | same | `status.incident_resolved` on a move to the terminal status, else `status.incident_update_posted` | contract, rollback, feature |
| `startQuillsStatusMaintenance` | `POST /status/incidents/{incidentId}/start` | update | same | `status.maintenance_started` | contract, rollback |
| `deleteQuillsStatusIncident` | `DELETE /status/incidents/{incidentId}` (soft; releases held components) | delete | same | `status.incident_deleted` | contract, rollback, feature |
| `getQuillsStatusSummary` | `GET /status/summary` (overview: top-level status, components, open items, uptime, counts) | read | all status tables, `settings` | - | contract |
| `getQuillsStatusUptime` | `GET /status/uptime?componentIds=` (≤ 50 IDs, `windowDays` ≤ 365) | read | `status_components`, `status_component_events` | - | contract |
| `clearQuillsStatusHistory` | `POST /status/history/clear` (resolved items and the event log) | manage_settings | `status_incidents` (and cascades), `status_component_events` | `status.history_cleared` | contract, rollback |

Merged: 17. Source: `listStatusIncidentsAdminFn`, `getStatusIncidentAdminFn`, `createStatusIncidentFn`,
`updateStatusIncidentFn`, `postStatusIncidentUpdateFn`, `startStatusMaintenanceNowFn`,
`deleteStatusIncidentFn`, `getStatusOverviewAdminFn`, `getStatusUptimeAdminFn`, `clearStatusHistoryFn`;
v1 `GET`, `POST` `/status/incidents`, `GET /status/incidents/{incidentId}`,
`POST /status/incidents/{incidentId}/updates`, `GET /status/summary`.

### Templates

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsStatusTemplates` | `GET /status/templates` (`offset`, `limit` ≤ 100) | read | `status_incident_templates`, `status_incident_updates`, `status_components` | - | contract, page-bounds |
| `createQuillsStatusTemplate` | `POST /status/templates` | manage_settings | `status_incident_templates`, `status_components` | `status.template_created` | contract, rollback |
| `updateQuillsStatusTemplate` | `PATCH /status/templates/{templateId}` | manage_settings | same | `status.template_updated` | contract, rollback |
| `deleteQuillsStatusTemplate` | `DELETE /status/templates/{templateId}` | manage_settings | `status_incident_templates` | `status.template_deleted` | contract, rollback |

Merged: 4. Source: `listStatusIncidentTemplatesFn`, `createStatusIncidentTemplateFn`,
`updateStatusIncidentTemplateFn`, `deleteStatusIncidentTemplateFn`.

### Subscribers and settings

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsStatusSubscribers` | `GET /status/subscribers` (search, cursor, `limit` ≤ 100; counts) | manage_settings | `status_subscriptions`, `principal`, `user` | - | contract, page-bounds |
| `exportQuillsStatusSubscribers` | `GET /status/subscribers/export` (409 above 5000 rows) | manage_settings | same | - | contract, feature |
| `addQuillsStatusSubscriber` | `POST /status/subscribers` (an existing customer by email) | manage_settings | same | `status.subscriber_added` | contract, rollback |
| `importQuillsStatusSubscribers` | `POST /status/subscribers/import` (≤ 5000 emails; 400 above) | manage_settings | same | `status.subscribers_imported` | contract, rollback, feature |
| `removeQuillsStatusSubscriber` | `DELETE /status/subscribers/{principalId}` (keeps the row as the opt-out) | manage_settings | `status_subscriptions`, `principal` | `status.subscriber_removed` | contract, rollback |
| `getQuillsStatusSettings` | `GET /status/settings` | read | `settings` | - | contract |
| `updateQuillsStatusSettings` | `PATCH /status/settings` | manage_settings | `settings`, `segments` | `settings.status_updated` | contract, rollback |

Merged: 9. Source: `listStatusSubscriptionsAdminFn`, `getStatusSubscriptionCountsFn`,
`exportStatusSubscribersAdminFn`, `addStatusSubscriberFn`, `importStatusSubscribersFn`,
`removeStatusSubscriberFn`, `getStatusSettingsFn`, `updateStatusSettingsFn`. Counts merge into the list.

## Deferred rows

These need the audience framework, another phase, or a worker:

| Source | Reason |
|---|---|
| `listPublicCategoriesFn`, `getPublicCategoryBySlugFn`, `getPublicCategoryPageFn`, `getPublicArticlePageFn`, `getPublicCollectionPageFn`, `listPublicCategoryEditorsFn`, `listPopularPublicArticlesFn`, `getPublicArticleBySlugFn`, `getRelatedPublicArticlesFn`, `listPublicArticlesFn`, `listPublicArticlesForCategoryFn`, `searchPublicArticlesFn`, `resolvePublicArticleRefFn` | Public help-center reads (audience framework). |
| `recordArticleFeedbackFn`, `submitArticleFeedbackReasonFn` | Visitor feedback (audience framework). |
| `widget/help.ts` (5 functions), `routes/api/widget/kb-search.ts` | Widget audience. |
| `resolveHelpCenterRedirectFn`, `routes/hc/sitemap[.]xml.ts` | Public site and sitemap. |
| `getStatusPageFn`, `getStatusIncidentPublicFn`, `getStatusUptimeFn`, `listStatusHistoryFn`, `listStatusFeedFn`, `routes/status/feed.ts` | Public status page and feeds. |
| Visitor status subscribe, unsubscribe, resubscribe | Visitor audience. |
| `enableStatusSyncFn`, `disableStatusSyncFn`, `updateStatusMappingsFn`, `updateTicketStatusMappingsFn`, `updatePushStatusMappingsFn`, `fetchExternalStatusesFn` | Integration provider webhooks and status mappings on `integrations` (P7), not the status page. |
| Custom help-center domain (`help-center-domain.service.ts`) | Another phase. |
| Auto-translate jobs, article embeddings, hybrid (semantic) search | AI calls. The flag is stored; publish records the request. |
| Maintenance auto-start and auto-complete at the window bounds | Needs a scheduled worker. The flags and the window are stored; start-now and manual updates work. |
| Incident and maintenance subscriber mail | The P4 mail handler reads `status.incident_published` and later status events. |

## Required migrations

None for these routes. Two optional changes need a decision first:

1. `status_incidents` has no draft column. An incident is public from its creation, as in the source
   (subject to the page `enabled` setting and the component segment gates). A draft incident needs a
   new nullable `published_at` column and a backfill of `created_at` for existing rows.
2. The status uptime read filters `status_component_events` by component and time. The existing index
   `(component_id, created_at)` has no `workspace_id` prefix. RLS adds the workspace predicate, so the
   index still serves the query; a `(workspace_id, component_id, created_at)` index helps only at scale.
