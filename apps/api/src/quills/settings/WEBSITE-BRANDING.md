# Website branding (RFC 0001, lane B1)

The server reads a company website, finds its logo and brand color, and offers them as the
workspace branding. A teammate accepts or declines the offer. Undo restores the previous values.
All paths are under `/quills/{workspaceId}`. Every route is for teammates.
Source: `lib/server/functions/website-branding.ts` and
`lib/server/domains/assistant/automatic-website-branding.{service,state,actions,availability}.ts`.

## Boundary map

```
Tables and owning schema:      quills.settings (logo_key, branding_config, metadata.brandingLookup),
                               quills.files (one row holds the offered logo key until accept or decline);
                               public.job_lease (verification lease, through framework/files.ts only);
                               public.storage_cleanup (written by the existing quills_storage_changes trigger only);
                               public.user (read only: the caller's own email, through framework/platform-reads.ts)
Actor and workspace source:    authenticated context (defineQuillsRoute). The site comes from the body or
                               from the caller's own Kaneo email. It never names a workspace or an actor.
Permissions:                   workspace:read + quills:manage_settings on all six routes; native: none
Persisted relationships:       none. The offer names an object key that a files row of this workspace holds.
Transaction:                   lookup and start: `prepare` reads (no write), `call` fetches the site and writes
                               the logo object with no transaction open, then one scoped transaction stores
                               the result. accept, decline and undo: one scoped transaction each.
                               Every write locks the settings row first, then the object.
External effects:              guarded GETs of the site and of at most 5 images (createGuardedFetch:
                               public addresses only, checked on every hop and at connect time; standard
                               ports; no credentials; 3 redirects; 10 s for each URL; 25 s for all images).
                               One presigned PUT of the chosen logo to the configured object store, then
                               the shared upload verification (HEAD) under a 60 s lease. No object deletion:
                               the shared cleanup worker owns it.
AI provider:                   none. The source chooses the logo and color with fixed rules, not a model.
Completion checks:             authenticated endpoint, mutation (rollback), read, worker or storage lifecycle,
                               SSRF (private, loopback and link-local addresses and a redirect to one)
```

## Routes

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `getQuillsAutomaticWebsiteBrandingStatus` | `GET /settings/website-branding` | manage_settings | `settings` | - |
| `lookupQuillsWebsiteBranding` | `POST /settings/website-branding/lookup` (`site`) | manage_settings | `settings`, `files` | `branding.auto_started` (`source` site) |
| `startQuillsAutomaticWebsiteBranding` | `POST /settings/website-branding/start` | manage_settings | `settings`, `files` | `branding.auto_started` (`source` email), only when it records a lookup |
| `acceptQuillsWebsiteBrandingOffer` | `POST /settings/website-branding/accept` | manage_settings | `settings`, `files` | `branding.offer_accepted` |
| `declineQuillsWebsiteBrandingOffer` | `POST /settings/website-branding/decline` | manage_settings | `settings`, `files` | `branding.offer_declined` |
| `undoQuillsAutomaticWebsiteBranding` | `POST /settings/website-branding/undo` | manage_settings | `settings` | `branding.auto_undone` |

Each response is `{ branding }`: the status that the source returns, or null when there is nothing
to show. `start` also returns `started`, which is true when the request recorded a lookup.
A 409 means that the offer or the undo is no longer available, that the branding changed since, or
that a lookup is running. Each API instance runs one lookup for each workspace and at most 4 in all.

## State and undo

The lookup state lives in `quills.settings.metadata` under the key `brandingLookup`, as in the source.
It holds the status, the domain, the offer (the logo key and a color) and, after accept, a receipt:
the previous and the applied values of `logo_key` and `branding_config`. Undo writes the previous
values back exactly, but only while both columns still hold the applied values. Undo is possible
once. Accept runs only when the workspace has no logo, so the previous logo is always null and undo
never writes a stored key back. A key under `brandingLookup`, also a failed one, stops `start` from
running again. A lookup that finishes after an accept keeps the applied state and its receipt.

Decision D11 puts the receipt of a settings write in its audit row. This state is not a settings
receipt of lane M1: the source keeps it with the lookup, and an audit value holds at most 500
characters, which a stored theme can exceed.

## Storage lifecycle

1. `call` writes the logo under a new key in the workspace's `logo` namespace (`createUpload`, then a
   PUT), then calls `verifyUpload`, which takes the shared 60 s verification lease.
2. The handler locks the settings row, then the object (`holdVerifiedUpload`), and inserts a `files`
   row with the key. The probe, the workspace deletion listing and the transfer now see the key.
3. Accept writes the key to `settings.logo_key` and deletes the files row. Decline, and a new lookup
   that replaces an offer, delete the files row. Undo clears `logo_key`. In each case the existing
   trigger queues the released key in the same transaction, and the cleanup worker deletes the
   object only when no column references it and no lease is live.
4. When the handler does not keep a written logo (the workspace got a logo, another request recorded
   the lookup first, or the write or its verification failed), it inserts and deletes a files row in
   its transaction. The trigger queues the key, so the object does not stay behind.
5. A verification deadline that passed before the handler locks the object gives 503 and commits
   no reference.

Known gap: a request that fails after the PUT and before its handler commits (a lost database
connection, a permission removed during the fetch, or the 503 above) leaves an object that nothing
references or queues. A presigned upload that is never registered has the same gap (`files/ROUTES.md`).

## Differences from the source

| Source | Kaneo | Reason |
|---|---|---|
| Server functions with no path | Six routes under `/settings/website-branding` | Kaneo routes. |
| A teammate without the permission gets `null` | 403 | `manage_settings` is the route action, as for the other settings areas. |
| A `pending` claim before the fetch, 409 `WEBSITE_BRANDING_BUSY` for a second lookup | No pending state. 409 for a second lookup of the workspace on the same API instance; at most 4 lookups on an instance. Lookups on two instances can run together: the last one to commit keeps its offer, and the other logo is queued for cleanup. | `prepare` must not write, and no fetch runs in a transaction. |
| `DISABLE_AUTOMATIC_BRANDING` operator switch | None. Storage must be configured. | No new configuration. A teammate with `manage_settings` starts each fetch. |
| Launch window: 14 days after setup completion | 14 days after Kaneo initialized Quills for the workspace (`settings.created_at`) | Kaneo has no Quills setup flow. |
| Offered logo stored under `logos/` with no reference | A `files` row holds the key until accept or decline | The storage probe, deletion and transfer see only columns. |
| `.ico` icons and `/favicon.ico` are candidates | Not fetched | Kaneo's image upload types do not include `image/x-icon`. |
| Logo and status URLs are public URLs | Short-lived signed URLs | Kaneo storage is private. |
| Plan check for custom colors | None | Kaneo has no plan tiers for branding. |
| Default theme: generated CSS equals the empty theme's | No custom CSS, no preset, no colors and only known theme keys | No theme generator in Kaneo. The rule is stricter, so a manual theme is never replaced. |
| Audit events `branding.website.applied` and `.undone` | Events `branding.offer_accepted` and `branding.auto_undone`; lookups record `branding.auto_started` and declines record `branding.offer_declined` | The RFC 0001 event names. Every write records its event. |
