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

## Public profiles (RFC 0001, lane M1)

`public-profile.ts`. A profile is a leak path, so it shows only public fields and only activity
that the caller can see.

```
Tables and owning schema:      quills: principal, settings, boards, board_projects, posts,
                               post_comments, post_statuses (public profile); principal,
                               customer_identity, companies, segments, user_segments,
                               visitor_devices (team context). public: none.
Actor and workspace source:    public profile: the portal resolver (Kaneo session, sign-in
                               optional); workspace from the path. Team context: the teammate
                               helper (authenticated context).
Permissions:                   public profile: none of Kaneo's; the portal flag and the
                               private-portal gate (viewer.ts). Team context: workspace:read +
                               quills:read.
Persisted relationships:       posts.principal_id, post_comments.principal_id, posts.board_id
                               and the board view tiers and project links (viewer.ts).
Transaction:                   one scoped read transaction per request.
External effects:              none.
Completion checks:             authenticated endpoint, tenant/object access, read/search.
```

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `getQuillsPublicUserProfile` | `GET /portal/profiles/{principalId}` | portal, sign-in optional | read | `principal`, `boards`, `board_projects`, `posts`, `post_comments`, `post_statuses` | - | contract, `public-profile.test.ts` |
| `getQuillsProfileTeamContext` | `GET /profiles/{principalId}/team-context` (path under `/quills/{workspaceId}`) | teammate | read | `principal`, `customer_identity`, `companies`, `segments`, `user_segments`, `visitor_devices` | - | contract, `public-profile.test.ts` |

Merged: `public-profile.ts#getPublicUserProfileFn`; `public-profile.ts#getProfileTeamContextFn`.

Rules of the public profile:

- A profile resolves only for a principal of type `user` with a portal role and a live account (a
  customer identity or a Kaneo account), that is not blocked and not a test customer. Anything
  else is 404 `Profile not found`, the same answer as an unknown ID or an ID of another workspace.
  A deleted Kaneo account keeps its principal as "Deleted user" without an account, so it has no
  profile.
- Activity uses the customer view of `feedback/viewer.ts`: visible boards, live posts, public
  comments, no held content of other people and no test data. A profile with no activity that
  the caller can see is 404, so the route does not confirm that an account exists.
- The response holds the display name, an http(s) avatar URL, `isTeamMember`, the join date, two
  counts and two lists of at most 100 items. It never holds an email, a company, segments or a
  last-seen time; the team context has those.

| Item | Source | Here | Reason |
|---|---|---|---|
| Portal off, private portal denied | `null` (404) | 404 while the portal is off; 403 `Portal access required` on a private portal, as every portal route | one gate for every portal route (`viewer.ts`) |
| Upvotes | list and `voteCount` | not returned | P3b keeps voter names private; a list of upvoted posts names the voter |
| Blocked person | resolves | 404 | a blocked person is out of the portal |
| Deleted account | no profile (the inner join to the account) | 404 | the same rule: the principal has no live account |
| Avatar | uploaded image, account image or principal avatar | the principal's http(s) avatar, as the portal post list | one avatar rule for the portal |
| Team context `lastSeenAt` | latest session or device | latest visitor device | sessions are Kaneo's |
| Team context email of a teammate | account email | the Quills contact email, or null | a teammate's account email is Kaneo's; `getQuillsPrincipal` has the roster |
| Links to profiles | author names link to `/u/{principalId}` | portal lists name no author principal IDs (P3b) | a client reaches a profile by an ID it already has, for example its own from `GET /user/profile`; exposing author IDs needs an owner decision |

## Not built in this slice

| Source | Reason |
|---|---|
| `routes/api/auth/portal-signin.ts#POST` | Portal sign-in is Kaneo's existing `/api/auth/*` (magic link, email OTP, password, social). No Quills route. |
| `routes/auth.widget-handoff.tsx`, `routes/widget.tsx#getPortalSessionToken` | A handoff mints a portal browser session for a widget visitor. Under D1 a portal session is a Kaneo session, and a widget visitor has no Kaneo account. Needs an owner decision. |
| `routes/api/widget/sdk[.]js.ts#GET` | `packages/widget/dist/browser.js` is not built, and the SDK calls Quackback paths. |
| `routes/api/widget-sso.ts#GET` | Quackback Cloud dogfood: a token signed with an environment secret for the vendor's own dashboard. |
| Portal invites (`portal-invites.ts`, `portal-invite.$inviteId.tsx`) | Built in P3c; see `CUSTOMER-ROUTES.md`. |
| `portal-permissions.ts#getMyPortalPermissionsFn` | A portal caller is always a customer, so the list is always empty. |
| Identify: `previousToken` merge | Built (`CUSTOMER-ROUTES.md`). The attribute and `segments` claims, changelog auto-subscribe and voted post IDs are built in P3c. |
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

## AI help and translations (RFC 0003, lane L4)

Boundary map:

- Tables: `boards`, `board_projects`, `posts`, `post_comments` (read), `content_translations`
  (the cache, RFC 0003 D10), `ai_usage_log` (one row for each provider call), `rate_bucket`.
- Actor: the portal caller from `framework/audience.ts`. A teammate on these routes is a customer.
- Authorization: `viewer.ts` (portal on, private-portal gate, board view tier). A hidden, held,
  deleted, private or foreign post or comment is 404 with the same message as a missing one.
- Transactions: `prepare` reads in one transaction. The provider call runs with no transaction.
  The handler checks the caller and the visibility again, then writes the cache row and the usage
  row in a second transaction. A failure after the provider call writes nothing.
- Events: none. A suggestion and a cached translation change no domain data.
- External effect: the AI provider (`assistant/provider.ts`). It is off without `QUILLS_AI_*` (409).
  There is no workspace AI budget yet; the per-account rate limit bounds the calls.

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `improveQuillsPortalPostDraft` | `POST /portal/post-draft/improve` (title ≤ 200, details ≤ 4000, optional `boardId`; 10 per 10 min per account and per client) | portal | create | `boards`, `ai_usage_log`, `rate_bucket` | none | contract, `feedback/ai.test.ts` |
| `translateQuillsPortalContent` | `POST /portal/translations` (`postId` or `commentId`, `locale` as a BCP 47 tag; 60 per 10 min per client, and per account with a session) | portal, sign-in optional | read | `posts`, `post_comments`, `content_translations`, `ai_usage_log`, `rate_bucket` | none | contract, `translations.test.ts` |

Rules:

1. The composer route returns a suggestion only. The model gets the customer's text as data and
   must not add facts. The answer is cut to 200 and 1,000 characters. The suggested board is a
   board that takes the caller's posts; another value becomes the given board or null.
2. The translation key is the post or comment, the language and the SHA-256 of the source title
   and text. The language is the primary subtag of the locale (`de-AT` is `de`); Chinese keeps its
   script as `zh-cn` or `zh-tw`. An edit changes the hash, so an old translation is never served.
   A cached translation needs no AI, so it is served when AI is off. An empty answer for a text is
   a 502 and is not cached. Two requests that miss at the same time store one row: the insert does
   nothing on a conflict with the unique key.
3. `rateLimit.per: "caller"` (`framework/define-route.ts`) counts these routes per client IP, like
   every rate-limited route, and also per signed-in Kaneo account after the session read. One
   account cannot spend the limit from many addresses, and many accounts cannot spend it from one.
