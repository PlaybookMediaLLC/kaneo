# P3c route set: portal invites, deferred customer routes, widget hero image

This slice builds on the P3a audience framework (`ROUTES.md` in this folder). Non-teammate
routes are under `/quills-public/{workspace}`; teammate routes stay under `/quills/{workspaceId}`.
Every route uses `defineQuillsRoute` and has a fixture, so `framework/contract.test.ts` checks it.
Feature tests: `portal/customer.test.ts` and the direct-mail case in `jobs/handlers/mail.test.ts`.

## Boundary map

```
Tables and owning schema:  quills: portal_invites (new), settings (widget_hero_key, new
                           column; portal_config read), customer_identity, principal,
                           unsubscribe_tokens, post_subscriptions, notification_preferences,
                           changelog_subscriptions, status_subscriptions, status_components,
                           push_devices, posts, boards, segments, user_segments,
                           user_attribute_definitions, post_votes, events, audit_log, job_queue,
                           hook_deliveries, email_log, rate_bucket.
                           public: none read or written by these routes. storage_cleanup is
                           written by the existing quills_storage_changes trigger only.
Actor and workspace:       teammate: authenticated context (defineQuillsRoute).
                           portal: the Kaneo session; the workspace from the path
                           (withQuillsAudience). public: no identity; the token is the credential.
                           widget: the identify token signed with the widget secret.
Permissions:               invites (send, list, resend, cancel, link) and the hero image:
                           quills:manage_settings. Devices: quills:read (the caller's own rows).
                           Portal and public: none of Kaneo's; the audience resolver, the portal
                           switch, the private-portal gate and row ownership authorize.
Persisted relationships:   customer_identity.kaneo_user_id (the accept link, migration 0011 rule),
                           portal_invites.email (verified address) for the invite grant,
                           unsubscribe_tokens.principal_id, post_subscriptions.principal_id.
Transaction:               one scoped transaction per request. Mail is sent by the quills.mail
                           worker after commit; the request only records the outbox event.
External effects:          invite mail (direct mail job), status-change and comment mail with a
                           one-click unsubscribe link (per-recipient mail jobs). Nothing in a request.
Completion checks:         authenticated endpoint, tenant/object access, mutation, read, schema
                           and ownership constraint (migration 0012), worker and storage lifecycle.
```

## Product rules applied

- Portals are opt-in. The P3c portal routes return 404 while `portal_config.enabled` is not
  `true` (`gate.ts#requirePortalEnabled`). The flag is written by another slice; this one only
  reads it. The P3a routes (`access.ts`, `profile.ts`, `config.ts`) are left to the flag slice;
  `access.ts` changed here only to add the invite grant.
- The unsubscribe routes do not read the flag: teammates get the same mail, and a link must work.
- A portal route that shows or changes content also runs the private-portal gate
  (`gate.ts#requirePortalAccess`): 403 for a caller the policy does not let in.
- Every token is 32 random bytes. Only its SHA-256 hash is stored (`portal_invites.token_hashes`,
  `unsubscribe_tokens.token`, `push_devices.token`). Invite and unsubscribe tokens expire (30 days)
  and stop working after use.

## Portal invites

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `sendQuillsPortalInvite` | `POST /portal/invites` (one address, optional note ≤ 500) | teammate | manage_settings | `portal_invites` | `portal.invite_sent` | contract, rollback, concurrent send, mail |
| `listQuillsPortalInvites` | `GET /portal/invites` (≤ 100, pending first) | teammate | manage_settings | `portal_invites` | - | contract |
| `resendQuillsPortalInvite` | `POST /portal/invites/{inviteId}/resend` | teammate | manage_settings | `portal_invites` | `portal.invite_resent` | contract, rollback |
| `cancelQuillsPortalInvite` | `DELETE /portal/invites/{inviteId}` | teammate | manage_settings | `portal_invites` | `portal.invite_canceled` | contract, rollback, links die |
| `createQuillsPortalInviteLink` | `POST /portal/invites/{inviteId}/link` | teammate | manage_settings | `portal_invites` | `portal.invite_link_created` | contract, rollback, hash only |
| `acceptQuillsPortalInvite` | `POST /portal/invites/{inviteId}/accept` (body `token`; 20 per 10 min per client) | portal (ensureCustomer) | update | `portal_invites`, `customer_identity`, `principal` | `portal.invite_accepted` | contract, rollback, invite grant, no membership |

Merged: `sendPortalInviteFn`, `fetchPortalInvitesFn`, `resendPortalInviteFn`, `cancelPortalInviteFn`,
`getPortalInviteLinkFn`, `acceptPortalInviteFn` and `routes/portal-invite.$inviteId.tsx`.

- The invite never grants workspace membership. Accepting creates the account's customer profile
  through `ensureCustomer` (the `customer_membership` trigger accepts a new link to the account
  that `withQuillsAudience` vouched for). A failed accept rolls the profile back.
- Accept needs a token of the invite, the invited address on the signed-in Kaneo account, and
  that address verified. Unknown token, or a canceled invite (cancel clears the tokens): 404.
  Other address or unverified: 403. Expired: 409. A repeat by the account that accepted: 200
  with `alreadyAccepted`.
- Accepting and canceling clear every token hash. A send, a resend and a copied link each add one
  token; the newest 20 stay valid, so an earlier link keeps working (as in the source).
- The private-portal gate grants `reason: "invite"` to a verified address with an accepted invite
  (`gate.ts#portalAccess`, used by `evaluateQuillsMyPortalAccess` and every P3c portal route).
- One pending invite per address: a partial unique index, so concurrent sends get one 200.
- Mail: the event fans out to one direct `quills.mail` job (payload `{ eventId }` only). The worker
  mints the link's token at send time, reads the address from the invite row and mails it with
  the `portal-invite` template. The address is a `SealedEmail`: the token was minted for it.
- The invite link is `KANEO_CLIENT_URL/portal/{workspaceId}/invite/{inviteId}#token=…`. The
  token is in the fragment, so it never reaches a server log. The web page is not built.
- Deviations: one address per request (the framework records one event per mutation; the source's
  batch of 50 is a client loop). The "already a team member" refusal is dropped: a member gets
  the team grant anyway. An accepted invite cannot be canceled, and the access policy does not
  override it (as in the source): block the person to remove access.
- Transfer: an imported archive keeps invites but no token, and a pending invite arrives expired,
  so a link of the source workspace never opens the target (`transfer/import-archive.ts`).

## Unsubscribe links (public, the token is the credential)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `previewQuillsUnsubscribeToken` | `GET /unsubscribe?token=` | public | read | `unsubscribe_tokens`, `posts` | - | contract, never spends |
| `createQuillsUnsubscribe` | `POST /unsubscribe?token=` (RFC 8058 one-click) | public | update | `unsubscribe_tokens` and the action's table | none (personal) | contract, rollback, single use, two-workspace |
| `processQuillsUnsubscribeToken` | `POST /unsubscribe/confirm` (body `token`) | public | update | same | none (personal) | contract, rollback |

Merged: `previewUnsubscribeTokenFn`, `processUnsubscribeTokenFn`, `one-click-unsubscribe.ts`.

- Actions: `unsubscribe_post`, `unsubscribe_all` (mute mail), `unsubscribe_changelog`,
  `unsubscribe_status`, and (RFC 0003) `unsubscribe_shipped` and `unsubscribe_digest`. The last
  two set the mail cell of the `post_shipped` or `weekly_digest` matrix type to false. Each is
  idempotent; the token is spent in the same transaction.
- Link generation: `unsubscribe-token.ts#mintUnsubscribeToken` and `#unsubscribeUrl`
  (`KANEO_API_URL/api/quills-public/{workspaceId}/unsubscribe?token=…`). The P4 content table
  (`jobs/fanout.ts#subscribers`) now has mail entries for `post.status_changed` and
  `comment.created`; each recipient gets its own `unsubscribe_post` token and the RFC 2369/8058
  headers through the template sender.
- Deviation: the framework does not give the handler the raw body, so the one-click POST does not
  check the `List-Unsubscribe=One-Click` form field. The token in the URL is the only credential,
  as in the source, and a GET never writes.

## Customer subscriptions (portal)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `getQuillsMyPostSubscription` | `GET /posts/{postId}/subscription` | portal, sign-in optional | read | `post_subscriptions`, `posts`, `boards`, `user_segments` | - | contract |
| `setQuillsMyPostSubscription` | `PUT /posts/{postId}/subscription` (`level`: `all`, `status_only`) | portal (ensureCustomer) | update | `post_subscriptions` | none (personal) | contract, rollback |
| `deleteQuillsMyPostSubscription` | `DELETE /posts/{postId}/subscription` | portal | update | `post_subscriptions` | none (personal) | contract, rollback |
| `getQuillsMyChangelogSubscription` | `GET /changelog/subscription` | portal, sign-in optional | read | `changelog_subscriptions` | - | contract |
| `subscribeQuillsMyChangelog` | `PUT /changelog/subscription` | portal (ensureCustomer) | update | `changelog_subscriptions` | none (personal) | contract, rollback |
| `unsubscribeQuillsMyChangelog` | `DELETE /changelog/subscription` (soft) | portal | update | `changelog_subscriptions` | none (personal) | contract, rollback |
| `getQuillsMyStatusSubscription` | `GET /status/subscription` | portal, sign-in optional | read | `status_subscriptions` | - | contract |
| `subscribeQuillsMyStatus` | `PUT /status/subscription` (`scope`, `componentIds` ≤ 50) | portal (ensureCustomer) | update | `status_subscriptions`, `status_components` | none (personal) | contract, rollback, foreign component |
| `unsubscribeQuillsMyStatus` | `DELETE /status/subscription` (soft) | portal | update | `status_subscriptions` | none (personal) | contract, rollback |

Merged: the portal audience of `fetchSubscriptionStatusSubscriptions`, `subscribeToPost`,
`unsubscribeFromPost`, `updateSubscriptionLevel`; `getMyChangelogSubscription`,
`subscribeToChangelog`, `unsubscribeFromChangelog`; `getMyStatusSubscription`, `subscribeStatus`,
`unsubscribeStatus`.

- A post must be live, published and not merged, on a live board whose view tier is `anonymous`,
  `authenticated`, or `segments` with the caller in a view segment. Otherwise 404.

## Directory (portal)

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `getQuillsMyLanguagePreference` | `GET /user/language` | portal | read | `customer_identity` | - | contract |
| `setQuillsMyLanguagePreference` | `PUT /user/language` (BCP-47 tag or null) | portal (ensureCustomer) | update | `customer_identity` | none (personal) | contract, rollback |
| `listQuillsPortalMentionSuggestions` | `GET /mentions/suggest?q=&scope=` (10, prefix only, no email; 60 per min per client) | portal | read | `principal` | - | contract |
| `getQuillsMyWeeklyDigestPreference` | `GET /user/weekly-digest` (RFC 0003; true until turned off) | portal | read | `notification_preferences` | - | contract |
| `setQuillsMyWeeklyDigestPreference` | `PUT /user/weekly-digest` `{weeklyDigest}` (30 per 10 min) | portal (ensureCustomer) | update | `notification_preferences` (the `weekly_digest` matrix cell) | none (personal) | contract, rollback |

Merged: `teammate-preferences.ts` (the customer side; a teammate's language is the Kaneo account
locale) and the portal caller of `routes/api/v1/mentions/suggest.ts`. Mentions need a customer
profile and never list the caller. Former workspace members keep their teammate principal and can
appear (no platform read is allowed on portal routes).

## Teammate additions

| operationId | Route | Audience | Action | Tables | Event | Tests |
|---|---|---|---|---|---|---|
| `registerQuillsPushDevice` | `POST /devices` | teammate | read | `push_devices` | none (personal) | contract, rollback, hash only |
| `unregisterQuillsPushDevice` | `DELETE /devices` | teammate | read | `push_devices` | none (personal) | contract, rollback |
| `saveQuillsWidgetHeroImageKey` | `PUT /settings/widget/hero-image` | teammate | manage_settings | `settings.widget_hero_key` | `settings.widget_hero_image_updated` | contract, rollback, storage lifecycle |
| `deleteQuillsWidgetHeroImage` | `DELETE /settings/widget/hero-image` | teammate | manage_settings | `settings.widget_hero_key` | `settings.widget_hero_image_removed` | contract, rollback, storage lifecycle |

- `api/devices` is a teammate route in the source (a dashboard session only), so it is built for
  teammates, not customers. The token is stored hashed as the owner asked; no push sender can read
  it back, so delivery needs reversible encryption first.
- Hero upload: `createQuillsSettingsUpload` gains purpose `widget_hero` (merges
  `getWidgetHeroUploadUrl`). Save and delete reuse the settings-key routes.
- Hero lifecycle: migration 0012 adds the column and replaces `storage_keys` (the cleanup trigger
  reads it), `storage_references`, `storage_keys_for_workspace` and `storage_object_is_referenced`.
  `schema-ops.ts` adds its lookup index; the transfer archive lists the column in `STORAGE_FIELDS`.
  The old JSON value `widget_config.home.heroImageKey` is not read; nothing in Kaneo wrote it.

## Identify extras (widget)

`identifyQuillsWidgetVisitor` now also applies these claims of the signed token:

- Custom attributes: claims that match a user attribute definition, coerced to its type, at most
  50; unknown or invalid ones are dropped. Merged into `customer_identity.metadata`.
- `segments`: at most 50 manual segment slugs. Widget-sourced memberships follow the claim; a
  missing claim removes them. Manual and other memberships stay.
- Changelog auto-subscribe when `changelogSettings.autoSubscribe` is not false. A person who
  unsubscribed is never subscribed again.
- `votedPostIds` in the response: the newest 500 votes on live posts.

## Not built, or built in part

| Item | Status | Reason |
|---|---|---|
| Portal uploads (`api/portal/upload`, `api/portal/files`), widget upload (`api/widget/upload`, `getWidgetImageUploadUrl`), customer avatar upload | built | `files/customer.ts` and `files/ROUTES.md`: portal and widget routes now run `prepare` and `call`, so verification happens outside the transaction. |
| Public storage proxy (`listStorage`, `putStorage`) | not built | Signed GET URLs from `framework/files.ts` serve reads. |
| Website-branding reads (`lookupWebsiteBranding`, `getAutomaticWebsiteBrandingStatus`) | not built | In the source these are teammate assistant features (`requireAuth`, AI module) that fetch an arbitrary website. They are not customer reads; they belong with the assistant phase and its SSRF guard. |
| Identify `previousToken` merge | built | `widget/anonymous-merge.ts`: in the identify transaction, the anonymous session's activity (`directory/lead-merge.ts#repoint`: conversations, votes and the rest) moves to the identified person, and the session ends. The token must also be the Bearer token, live in this workspace, of a non-test, unblocked anonymous visitor. The response names `mergedPrincipalId`; `user.lead_merged` is recorded. The empty anonymous principal is left to the anonymous visitor sweep. As in the source, a colliding anonymous vote is dropped and the post's vote count is not lowered. |
| Widget handoff and portal session token | not built | Open owner decision (D1: a widget visitor has no Kaneo account). |
| Customer mail delivery | not built | Fan-out still tells teammates only. Telling a customer needs the private-portal decision at send time (verified address, membership) and the public post visibility rule of the public-feedback slice. The mail entries and per-recipient unsubscribe links are ready for it. |
| Unsubscribe web page, invite web page, post page | not built | `apps/web` has no Quills or portal UI. A browser GET of the unsubscribe URL returns the JSON preview. |
