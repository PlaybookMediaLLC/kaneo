# P3a route set: audiences other than teammates (identity, config and access)

Non-teammate routes are under `/quills-public/{workspace}`. `{workspace}` is a workspace ID
or slug that the caller names; an ID match wins over a slug match. Teammate routes stay under
`/quills/{workspaceId}`. A workspace that never initialized Quills (no teammate has used it)
returns 404 on every non-teammate route, and an anonymous caller never seeds it. Every route
uses `defineQuillsRoute`; the `Audience` column is the declaration's `audience` field. The source rows are in `docs/quills-port/ledger/phase-P3.md`.
Merge rule and action mapping: `docs/quills-port/detailed-plan.md`, sections 2 and 3. For a
non-teammate route the action is recorded for the ledger only; the audience resolver authorizes.

The framework has no PATCH method, so a partial update uses PUT.

## Boundary map

```
Tables and owning schema:      quills: settings, customer_identity, principal, kv_store,
                               rate_bucket, visitor_devices, page_views, user_segments,
                               segments, audit_log, events, job_queue. public: workspace (read, in the entry point),
                               workspace_member (read only, platform-reads.ts, access branch).
Actor and workspace source:    teammate: authenticated context (unchanged).
                               portal: the Kaneo session (cookie or session Bearer, never an
                               API key); workspace from the path, resolved by
                               withQuillsAudience. widget: the widget session Bearer token,
                               looked up by its SHA-256 hash in the path's workspace; it
                               ends when the widget is turned off or its secret rotates.
                               public: no identity.
Permissions:                   teammate: workspace:read + quills:<action>. Others: none of
                               Kaneo's; the audience resolver and the handler's ownership
                               rule authorize. A teammate on a portal route is a customer.
Persisted relationships:       customer_identity.kaneo_user_id (portal link, decision D1),
                               principal.user_id -> customer_identity.id, kv_store widget
                               session row -> principal.
Transaction:                   one scoped transaction per request through withQuillsAudience;
                               a rate limit runs first in its own committed transaction.
External effects:              none; each mutation records one outbox event.
Completion checks:             authenticated endpoint, tenant/object access, mutation,
                               read, schema/ownership constraint (migration 0010).
```

## Public (no identity)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `getQuillsPublicPortalConfig` | `GET /portal/config` | public | read | `settings` | - | contract, audience, read-leak |
| `getQuillsCustomerAvatar` | `GET /user/avatar/{customerId}` (JSON `{ url }`, not a redirect) | public | read | `customer_identity` | - | contract, audience, two-workspace |
| `getQuillsWidgetConfig` | `GET /widget/config.json` | public | read | `settings` | - | contract, audience, read-leak |
| `getQuillsWidgetCapabilities` | `GET /widget/capabilities` | public | read | none | - | contract, audience |
| `getQuillsWidgetLocale` | `GET /widget/locale` (`?locale=`, `Accept-Language`) | public | read | none | - | contract, audience |
| `redeemQuillsWidgetInstallCode` | `POST /widget/install-context` (20 per 15 min per client) | public | update | `kv_store`, `settings`, `rate_bucket` | `settings.widget_install_code_redeemed` | contract, audience, rollback |

Merged: `fetchPublicPortalConfig`; `routes/api/user/avatar.$userId.ts#GET` and
`portal.ts#fetchUserAvatar`; `config[.]json.ts#GET`; `widget-capabilities.ts`;
`widget.tsx#getWidgetLocale`; `install-context.ts#POST`.

## Widget (widget session Bearer)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `identifyQuillsWidgetVisitor` | `POST /widget/identify` (HS256 `ssoToken` signed with the widget secret, with `exp`; 60 per 15 min per client) | widget, no session needed | create | `customer_identity`, `principal`, `kv_store`, `rate_bucket` | `user.identified` | contract, audience, rollback |
| `getQuillsWidgetSession` | `GET /widget/session` | widget | read | `kv_store`, `principal`, `customer_identity` | - | contract, audience |
| `linkQuillsWidgetDevice` | `POST /widget/device` (body field `device`, not `deviceId`: a caller-chosen value) | widget | update | `visitor_devices`, `page_views` | none (analytics link) | contract, audience, rollback |

Merged: `identify.ts#POST`; `session.ts#GET` and `widget-auth.ts`; `device.ts#POST`.

## Portal (Kaneo account, no membership)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `evaluateQuillsMyPortalAccess` | `GET /portal/access` | portal, sign-in optional | read | `settings`, `user_segments`; reads `public.workspace_member` | - | contract, audience, read-leak |
| `recordQuillsPortalAccessDenied` | `POST /portal/access-denied` (records only a denial that the server evaluates) | portal | update | `audit_log`, `events`, `job_queue`, `rate_bucket` | `portal.access_denied` | contract, audience, rollback |
| `getQuillsCustomerProfile` | `GET /user/profile` | portal | read | `customer_identity`, `principal` | - | contract, audience |
| `updateQuillsCustomerProfile` | `PUT /user/profile` (creates the link when missing; 30 per 10 min per client) | portal | update | `customer_identity`, `principal` | `customer.profile_updated` | contract, audience, rollback |
| `unlinkQuillsCustomerProfile` | `DELETE /user/profile` (removes the link, keeps the profile and the Kaneo account; 30 per 10 min per client) | portal | delete | `customer_identity` | `customer.profile_unlinked` | contract, audience, rollback |

Merged: `portal-access.ts#evaluateMyPortalAccessFn`; `portal-access.ts#recordPortalAccessDeniedFn`;
`routes/api/user/profile.ts#GET`, `user.ts#getProfileFn` and `portal.ts#getPrincipalIdForUser`
(the profile returns the caller's own principal ID; another person's ID is never looked up);
`profile.ts#PATCH` and `user.ts#updateProfileNameFn`; `profile.ts#DELETE`.

## Teammate

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `updateQuillsPortalAccess` | `PUT /settings/portal/access` (path under `/quills/{workspaceId}`) | teammate | manage_settings | `settings`, `segments` | `settings.portal_access_updated` | contract, rollback |

Merged: `portal-access.ts#updatePortalAccessFn`.

## Not built in this slice

| Source | Reason |
|---|---|
| `routes/api/auth/portal-signin.ts#POST` | Portal sign-in is Kaneo's existing `/api/auth/*` (magic link, email OTP, password, social). No Quills route. |
| `routes/auth.widget-handoff.tsx`, `routes/widget.tsx#getPortalSessionToken` | A handoff mints a portal browser session for a widget visitor. Under D1 a portal session is a Kaneo session, and a widget visitor has no Kaneo account. Needs an owner decision. |
| `routes/api/widget/sdk[.]js.ts#GET` | `packages/widget/dist/browser.js` is not built, and the SDK calls Quackback paths. |
| `routes/api/widget-sso.ts#GET` | Quackback Cloud dogfood: a token signed with an environment secret for the vendor's own dashboard. |
| Portal invites (`portal-invites.ts`, `portal-invite.$inviteId.tsx`) | No Quills invite table, no mail handler (P4) and no invite magic link. |
| `portal-permissions.ts#getMyPortalPermissionsFn` | A portal caller is always a customer, so the list is always empty. |
| Identify: `previousToken` merge, custom attribute claims, `segments` claim, changelog auto-subscribe, voted post IDs | Need the feedback and segment write paths (P3b). |
| Identify: `widget_identified_session` provenance | Only the handoff reads it; it lands with the handoff. |
| Anonymous widget sessions (Better Auth anonymous sign-in in the source) | No P3a route needs one; P3b adds the mint with anonymous votes and comments. |
| P3b rows: public boards, posts, roadmaps, changelog, RSS, sitemap, customer posts, comments, votes, reactions, widget feedback, help-center and support widget routes, uploads | Out of scope for P3a. |

## Changes outside this folder

- `directory/customer.ts` and `directory/segment-rules.ts`: a profile linked to a Kaneo account
  is a customer unless that account has a teammate principal in the workspace. Before D1 every
  linked profile belonged to a member, so the old rule hid every portal customer from teammates
  (people, blocking, segments) and made the portal segment grant impossible.
- `jobs/retention.ts`: deletes expired `kv_store` rows (widget sessions, install codes) and
  expired `rate_bucket` windows, 1,000 per statement and workspace.
