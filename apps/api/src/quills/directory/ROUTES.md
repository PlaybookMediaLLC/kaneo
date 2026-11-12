# P2a route set: directory and settings (teammate routes)

All paths are under `/quills/{workspaceId}`. Every route is for teammates and uses
`defineQuillsRoute`. The source rows are in `docs/quills-port/ledger/phase-P2.md`.
`Merged` names the source capabilities that each group replaces (merge rule and
action mapping: `docs/quills-port/detailed-plan.md`, sections 2 and 3).

The framework has no PATCH method, so a partial update uses PUT. A PUT body must
contain at least one field.

## Boundary map

```
Tables and owning schema:      quills: principal, customer_identity, companies,
                               conversations and tickets (company activity counts),
                               company_attribute_definitions, user_attribute_definitions,
                               user_tags, user_tag_assignments, segments, user_segments,
                               teams, audit_log, settings, kv_store; the lead merge also
                               writes the 30 activity tables in lead-merge.ts.
                               public: workspace_member (read only, platform-reads.ts).
Actor and workspace source:    authenticated context (helper)
Permissions:                   workspace:read + quills:<action>; native: none
Persisted relationships:       principal.company_id, user_segments, user_tag_assignments,
                               teams.kaneo_team_id (unchanged)
Transaction:                   one scoped transaction per request; the member roster is a
                               platform read in `load`, before the transaction
External effects:              none; each mutation records one outbox event
Completion checks:             authenticated endpoint, tenant/object access, mutation or
                               batch, read/search
```

People are customers only: `customer_identity` rows with a principal, no
`kaneo_user_id` on either row, no test owner, role `user`, type `user` or
`anonymous`. Teammates are read through `/principals` and come from the Kaneo roster.

## People

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsUsers` | `GET /users` (search, lifecycle users or leads, verified, segment, tag, sort, offset; `limit` ≤ 100) | read | `principal`, `customer_identity`, `posts`, `post_comments`, `post_votes`, `user_segments`, `user_tag_assignments` | - | contract, read-leak |
| `findQuillsUsersByEmail` | `GET /users/by-email?email=` | read | `principal`, `customer_identity` | - | contract |
| `createQuillsUser` | `POST /users` | create | `customer_identity`, `principal` | `user.created` | contract, rollback |
| `identifyQuillsUser` | `POST /users/identify` | update | `customer_identity`, `principal`, `user_attribute_definitions` | `user.identified` | contract, rollback |
| `getQuillsUser` | `GET /users/{principalId}` (with segments and tags) | read | `principal`, `customer_identity`, `user_segments`, `user_tags` | - | contract, read-leak |
| `updateQuillsUser` | `PUT /users/{principalId}` | update | `customer_identity`, `principal`, `user_attribute_definitions` | `user.updated` | contract, rollback |
| `deleteQuillsUser` | `DELETE /users/{principalId}` | delete | `principal`, `customer_identity` | `user.deleted` | contract, rollback, feature (409) |
| `listQuillsUserDuplicates` | `GET /users/{principalId}/duplicates` | read | `principal`, `customer_identity` | - | contract |
| `mergeQuillsLeadIntoUser` | `POST /users/{principalId}/merge` | update | 30 activity tables, `principal`, `customer_identity` | `user.lead_merged` | contract, rollback, feature |

Merged: 14. `listQuillsUsers` (v1), `listQuillsPortalUsers`, `searchQuillsPeople`;
`findQuillsPortalUsersByEmail`; `createQuillsPortalUser`; `createQuillsUsersIdentify`;
`getQuillsUsers` (v1), `getQuillsPortalUser`; `updateQuillsUsers` (v1), `updateQuillsPortalUser`;
`deleteQuillsUsers` (v1), `deleteQuillsPortalUser`; `listQuillsDuplicateUsers`; `mergeQuillsLeadIntoUser`.

## User tags and blocking

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsUserTags` | `GET /user-tags` | read | `user_tags` | - |
| `listQuillsUserTagsForPrincipal` | `GET /users/{principalId}/tags` | read | `user_tag_assignments`, `user_tags` | - |
| `assignQuillsUserTag` | `PUT /users/{principalId}/tags` (`tagId` or `name`) | update | `user_tags`, `user_tag_assignments` | `user.tagged` |
| `removeQuillsUserTag` | `DELETE /users/{principalId}/tags/{tagId}` | update | `user_tag_assignments` | `user.untagged` |
| `getQuillsUserBlock` | `GET /users/{principalId}/block` | read | `principal` | - |
| `blockQuillsUser` | `PUT /users/{principalId}/block` | update | `principal` | `user.blocked` |
| `unblockQuillsUser` | `DELETE /users/{principalId}/block` | update | `principal` | `user.unblocked` |

Merged: 7. `listQuillsUserTags`, `listQuillsUserTagsForPrincipal`, `assignQuillsUserTag`,
`removeQuillsUserTag`, `getQuillsPersonBlockStatus`, `blockQuillsPerson`, `unblockQuillsPerson`.

## Companies and attribute definitions

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsCompanies` | `GET /companies` (search, plan, offset; `limit` ≤ 100; `total`) | read | `companies`, `principal` | - |
| `getQuillsCompany` | `GET /companies/{companyId}` | read | `companies` | - |
| `createQuillsCompany` | `POST /companies` | create | `companies`, `company_attribute_definitions` | `company.created` |
| `updateQuillsCompany` | `PUT /companies/{companyId}` | update | same | `company.updated` |
| `deleteQuillsCompany` | `DELETE /companies/{companyId}` | delete | `companies` (people keep a null company) | `company.deleted` |
| `listQuillsCompanyMembers` | `GET /companies/{companyId}/members` | read | `principal`, `customer_identity` | - |
| `getQuillsCompanyActivity` | `GET /companies/{companyId}/activity` (conversation and ticket counts) | read | `companies`, `conversations`, `principal`, `tickets`, `ticket_conversations` | - |
| `getQuillsUserCompany` | `GET /users/{principalId}/company` | read | `principal`, `companies` | - |
| `setQuillsUserCompany` | `PUT /users/{principalId}/company` (`companyId`, or `name` to find or create) | update | `principal`, `companies` | `user.company_set` |
| `removeQuillsUserCompany` | `DELETE /users/{principalId}/company` | update | `principal` | `user.company_removed` |
| `listQuillsUserAttributes`, `listQuillsCompanyAttributes` | `GET /user-attributes`, `GET /company-attributes` | read | `*_attribute_definitions` | - |
| `createQuills{User,Company}Attribute` | `POST /{user,company}-attributes` | manage_settings | same | `*_attribute.created` |
| `updateQuills{User,Company}Attribute` | `PUT /{user,company}-attributes/{attributeId}` | manage_settings | same | `*_attribute.updated` |
| `deleteQuills{User,Company}Attribute` | `DELETE /{user,company}-attributes/{attributeId}` | manage_settings | same | `*_attribute.deleted` |

Merged: 22. `listQuillsCompaniesIndex` (v1), `listQuillsCompanies`, `listQuillsCompaniesPage`,
`countQuillsCompanies`; `getQuillsCompanies` (v1), `getQuillsCompany`; `createQuillsCompany`;
`updateQuillsCompany`; `deleteQuillsCompany`; `listQuillsCompanyMembers`;
`getQuillsCompanyForPrincipal`; `attachQuillsPrincipalToCompany`, `qualifyQuillsCompany`;
`detachQuillsPrincipalFromCompany`; the four user and four company attribute rows;
`getQuillsCompanyActivity` (RFC 0001, lane M1: `companies.ts#getCompanyActivityFn`).
Company activity counts the conversations whose visitor is a person of the company and the live
tickets of the company. Test customers' conversations and tickets are left out, as in the source.
Every teammate with `quills:read` sees every conversation (decision D2), so no other filter applies.
Attribute definitions take `manage_settings` (section 3); the source used `COMPANY_MANAGE` for companies.

## Segments

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsSegments` | `GET /segments` | read | `segments`, `user_segments` | - | contract |
| `listQuillsSegmentAttributeValues` | `GET /segments/attribute-values` (`limit` ≤ 50) | read | `principal`, `customer_identity` | - | contract |
| `createQuillsSegment` | `POST /segments` | manage_settings | `segments` | `segment.created` | contract, rollback |
| `updateQuillsSegment` | `PUT /segments/{segmentId}` | manage_settings | `segments` | `segment.updated` | contract, rollback |
| `deleteQuillsSegment` | `DELETE /segments/{segmentId}` (soft delete) | manage_settings | `segments`, `user_segments` | `segment.deleted` | contract, rollback |
| `addQuillsSegmentMembers` | `POST /segments/{segmentId}/members` (≤ 100 IDs, all or nothing) | manage_settings | `user_segments`, `principal` | `segment.members_added` | contract, batch |
| `removeQuillsSegmentMembers` | `DELETE /segments/{segmentId}/members` (≤ 100 IDs, all or nothing) | manage_settings | `user_segments`, `principal` | `segment.members_removed` | contract, batch |
| `evaluateQuillsSegment` | `POST /segments/{segmentId}/evaluate` | manage_settings | `user_segments`, `principal`, `customer_identity`, `companies` | `segment.evaluated` | contract, bounds |
| `evaluateQuillsAllSegments` | `POST /segments/evaluate` (first 25 dynamic segments) | manage_settings | same | `segment.evaluated_all` | contract, bounds |

Merged: 11. `listQuillsSegments`, `fetchQuillsSegmentAttributeValues`, `createQuillsSegment`,
`updateQuillsSegment`, `deleteQuillsSegment`; `assignQuillsUsersToSegment`,
`createQuillsSegmentsMembers` (v1); `removeQuillsUsersFromSegment`,
`deleteQuillsSegmentsMembers` (v1); `evaluateQuillsSegment`; `evaluateQuillsAllSegments`.
The v1 member routes used the segment slug; this route set uses the segment ID.
Evaluation bounds: ≤ 20 conditions, ≤ 100 `in` values, ≤ 10000 matches (more: 409 and no change).

## Teammates, mentions, audit log and teams

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsPrincipals` | `GET /principals` (search, offset; `limit` ≤ 100) | read | `principal`; reads `public.workspace_member` | - |
| `getQuillsPrincipal` | `GET /principals/{principalId}` | read | same | - |
| `listQuillsMentionSuggestions` | `GET /mentions/suggest?q=&scope=all|team` (10 results, no email) | read | `principal`, `customer_identity`; reads `public.workspace_member` | - |
| `listQuillsAuditEvents` | `GET /audit-events` (event type, exclude, actor, from, to, cursor; `limit` ≤ 100) | manage_settings | `audit_log` | - |
| `listQuillsTeams` | `GET /teams` (unchanged path; adds icon, color, description, assignment method) | read | `teams`, `team_members` | - |
| `bindQuillsTeam` | `POST /teams` (unchanged) | manage_settings | `teams` | `team.bound` |
| `updateQuillsTeam` | `PUT /teams/{teamId}` (icon, color, description, assignment method) | manage_settings | `teams` | `team.updated` |
| `deleteQuillsTeam` | `DELETE /teams/{teamId}` (soft delete) | manage_settings | `teams` | `team.deleted` |

Merged: 11. `listQuillsPrincipals` (v1), `listQuillsAssignableTeammates`; `getQuillsPrincipals`
(the GET handler); `listQuillsMentionsSuggest` (the teammate caller); `listQuillsAuditEvents`;
`listQuillsTeams`, `listQuillsTeamsAdmin`, `listQuillsTeamMembers` into the existing list;
`createQuillsTeam` into the existing bind; `updateQuillsTeam`; `deleteQuillsTeam`.

## Settings (`src/quills/settings`)

| operationId | Route | Action | Columns | Event |
|---|---|---|---|---|
| `listQuillsSettings` | `GET /settings` (name, slug, modules; no secrets) | read | `settings` | - |
| `getQuillsPortalSettings`, `updateQuillsPortalSettings` | `GET`, `PUT /settings/portal` | manage_settings | `portal_config` | `settings.portal_updated` |
| `getQuillsBrandingSettings`, `updateQuillsBrandingSettings` | `GET`, `PUT /settings/branding` (theme, custom CSS ≤ 50 KB, header mode and name) | manage_settings | `branding_config`, `custom_css`, `header_display_*` | `settings.branding_updated` |
| `getQuillsWidgetSettings`, `updateQuillsWidgetSettings` | `GET`, `PUT /settings/widget` | manage_settings | `widget_config` | `settings.widget_updated` |
| `getQuillsWidgetSecret` | `GET /settings/widget/secret` | manage_settings | `widget_secret` | - |
| `rotateQuillsWidgetSecret` | `POST /settings/widget/secret` | manage_settings | `widget_secret` | `settings.widget_secret_rotated` |
| `mintQuillsWidgetInstallCode` | `POST /settings/widget/install-code` | manage_settings | `widget_secret`, `kv_store` (hashed code) | `settings.widget_install_code_minted` |
| `getQuillsDeveloperSettings`, `updateQuillsDeveloperSettings` | `GET`, `PUT /settings/developer` | manage_settings | `developer_config` | `settings.developer_updated` |
| `getQuillsFeatureFlagSettings`, `updateQuillsFeatureFlagSettings` | `GET`, `PUT /settings/labs` | manage_settings | `feature_flags` | `settings.labs_updated` |
| `createQuillsSettingsReceiptsUndo` | `POST /settings/receipts/{receiptId}/undo` | manage_settings | the receipt's keys; `audit_log`, `import_runs` (read) | `settings.undone` |

Merged: 17. `listQuillsSettings` (v1); `fetchQuillsPortalConfig`, `updateQuillsPortalConfig`;
`updateQuillsTheme`, `updateQuillsCustomCss`, `updateQuillsHeaderDisplayMode`,
`updateQuillsHeaderDisplayName`; `fetchQuillsWidgetConfig`, `updateQuillsWidgetConfig`;
`fetchQuillsWidgetSecret`; `regenerateQuillsWidgetSecret`; `mintQuillsWidgetInstallCode`;
`fetchQuillsDeveloperConfig`, `updateQuillsDeveloperConfig`; `updateQuillsFeatureFlags`;
`getQuillsSettings` and `updateQuillsSettings` (v1 areas `portal` and `branding` only).
The workspace name and slug are Kaneo's and are never written.

### Receipts and undo (decision D11, RFC 0001 lane M1)

Merged: `routes/api/v1/settings/receipts.$receiptId.undo.ts#POST`.

- Each `PUT /settings/{area}` keeps a receipt in the metadata of its own audit row (`metadata.receipt`:
  `area`, `before`, `after`). The outbox event, its jobs and webhooks never hold it.
- A receipt holds only the area's allowlisted keys that the write changed (`receipt-fields.ts`). A
  key is a text column, or a top-level key of a JSON column, so undo can remove a key that the write
  added.

  | Area | Keys |
  |---|---|
  | portal | `portalConfig.enabled`, `.features`, `.openSignup`, `.support`, `.nav` |
  | branding | `brandingConfig`, `customCss`, `headerDisplayMode`, `headerDisplayName` |
  | widget | `widgetConfig.enabled`, `.defaultBoard`, `.position`, `.launcherGreeting`, `.launcherLabel`, `.visitorAnalytics`, `.visitorDeviceTracking`, `.tabs`, `.home` |
  | developer | `developerConfig.mcpEnabled`, `.mcpPortalAccessEnabled`, `.oauthDynamicClientRegistrationEnabled`, `.personalApiKeysEnabled` |
  | labs | `featureFlags.changelog`, `.helpCenter`, `.supportInbox`, `.supportTickets`, `.statusPage` |

  Never in a receipt: the widget secret, install codes, file and object keys (logo, favicon, hero
  image), portal access data, moderation defaults, the Kaneo name and slug, or any token.
- The update response returns `receiptId`, the audit row ID of its receipt (minted by the handler and
  passed to `recordQuillsChange`), or null when no allowlisted key changed.
- Undo locks the settings row, as every settings write does. It answers 404 for an unknown or
  foreign ID, or a row that is no settings receipt. It answers 409 when:
  - a `settings.undone` row already names the receipt;
  - a later receipt or undo of the same area touched one of its keys (even after that one was undone);
  - a key no longer holds the receipt's `after` value (for example website branding changed the
    theme, which writes no receipt);
  - the receipt came with a workspace import: its row names another workspace (`target_id`), or a
    local archive import (`import_runs`, source `api`, never in an archive) is not older than it.
- Undo restores the `before` values and records a new `settings.undone` row with the reversed
  receipt. It never edits the receipt row; the runtime role cannot update `audit_log`.
- Website branding (lane B1) keeps its own undo state in `settings.metadata.brandingLookup` and
  writes no receipt, so a branding accept is never undone twice. A settings receipt that a later
  branding accept overwrote is stale (409).

| Item | Source | Here | Reason |
|---|---|---|---|
| Receipt content | every changed leaf of the area, with storage effects | the allowlisted keys of the area's own write | an allowlist keeps secrets out (AGENTS.md rule 5) |
| Receipt ID | the apply response | the update response (`receiptId`) | the same |
| Stale check | current value equals `after` | that, and no later receipt or undo of the area on the same key | a later write and its undo cannot hide a change |
| Imported receipt | not handled | 409 | an archive copies audit rows unchanged |
| ETag, If-Match, dry run | yes | no | as for the settings routes |

## Not ported, or ported in part

| Source capability | Status | Reason |
|---|---|---|
| `setQuillsTeamMembers` | not ported | Reuse Kaneo: the roster of a bound team is Kaneo's. |
| `deleteQuillsTestConversations` | moved | Built in RFC 0001 lane M1 as `DELETE /test-conversations` in `support/test-conversations.ts`; see `support/CONVERSATIONS.md`. |
| `getQuillsSettings`, `updateQuillsSettings` | part | Areas `office_hours`, `messenger`, `modules`, `changelog` belong to later phases. No ETag, If-Match or dry run. |
| `getQuillsUser` | part | No `engagedPosts` list. |
| `listQuillsUsers` | part | No count, email-domain or custom-attribute filters; no last-seen sort (sessions are Kaneo's). |
| `createQuillsSegment`, `updateQuillsSegment` | part | No evaluation schedule (needs the scheduler) and no weight config. Rules on `last_active_days_ago` and `signup_source` are refused (Kaneo owns sessions and accounts). |
| `updateQuillsPortalConfig` | part | No welcome card (needs the TipTap sanitizer). |
| `updateQuillsWidgetConfig` | part | Messenger settings and translations are kept as stored; the messenger area owns them. |
| `fetchQuillsWidgetSecret` | changed | The read does not create a secret; `POST /settings/widget/secret` does. |
