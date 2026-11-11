# P2b route set: files and object keys (teammates)

All paths are under `/quills/{workspaceId}`. Every route is for teammates.
The source rows are in `docs/quills-port/ledger/phase-P2.md`, sections `files` and `settings`.
The merge rule and the action mapping are in `docs/quills-port/detailed-plan.md`, sections 2 and 3.

## Boundary map

```
Tables and owning schema:      quills.files, quills.settings (logo_key, favicon_key, header_logo_key);
                               public.job_lease (verification lease, framework/files.ts only);
                               public.storage_cleanup (written by the existing quills_storage_changes trigger)
Actor and workspace source:    authenticated context (defineQuillsRoute)
Permissions:                   workspace:read + quills:<action>; native: none
Persisted relationships:       none
Transaction:                   one scoped transaction per request. Upload verification (HEAD and digest)
                               runs in `load`, outside the transaction, under a 60 s verification lease.
                               The handler takes the object lock and checks the lease before it writes the reference.
External effects:              presigned PUT and GET URLs (local signing), HEAD and GET of the uploaded object
                               in `load`; no object deletion (the shared cleanup worker owns it)
Completion checks:             authenticated endpoint, tenant/object access, mutation, read, worker or storage lifecycle
```

## Object key rules

- The server derives every key: `<S3_KEY_PREFIX>/workspace/<workspaceId>/quills/<purpose>/<cuid>.<ext>`.
- A key outside the caller's workspace namespace, a key of a different purpose, or a key with a path suffix returns 404.
- Images only for every purpose except `file`. All sizes use Kaneo's `S3_MAX_IMAGE_UPLOAD_BYTES` limit.
- A reference commits only while its verification lease is live and still owned by the request, with 10 s left
  for clock skew. An expired or lost lease returns 503 and writes nothing.
- A registration retry for a key that is already registered returns that file with `created: false` and no event.
  A key whose file was removed returns 409.
- Known gap: an upload URL that is never registered leaves an object that nothing cleans up. Kaneo's direct
  task-image upload has the same gap. Closing it needs a pending-upload record or an upload-window lease.
- Replacing or clearing a settings key queues the old key through the existing trigger, in the same transaction.

## Files

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `checkQuillsS3Configured` | `GET /storage` | read | - | - | contract |
| `createQuillsUpload` | `POST /files/uploads` (purpose `file`, `post_image`, `changelog_image`) | create | - (signs a URL) | none | contract, storage-lifecycle |
| `createQuillsSettingsUpload` | `POST /files/settings-uploads` (purpose `logo`, `favicon`, `header_logo`, `assistant_avatar`) | manage_settings | - (signs a URL) | none | contract, storage-lifecycle |
| `createQuillsFiles` | `POST /files` (registers an upload of purpose `file`, `post_image`, `changelog_image`, `assistant_avatar`; idempotent per key) | create | `files` | `file.created` (new file only) | contract, rollback, storage-lifecycle |
| `getQuillsFile` | `GET /files/{fileId}` (metadata and a short-lived download URL) | read | `files` | - | contract, two-workspace |
| `createQuillsFilesOpened` | `POST /files/{fileId}/opened` | read | `files` (`open_count`) | none (usage counter) | contract, two-workspace |

Merged: `createQuillsUpload` replaces `getQuillsPresignedUploadUrl` (POST_CREATE), `getQuillsPostImageUploadUrl`
(POST_CREATE) and `getQuillsChangelogImageUploadUrl` (CHANGELOG_MANAGE, a content create).
`createQuillsSettingsUpload` replaces `getQuillsLogoUploadUrl`, `getQuillsFaviconUploadUrl`,
`getQuillsHeaderLogoUploadUrl` (SETTINGS_MANAGE) and `getQuillsAssistantAvatarUploadUrl` (AI_CUSTOMER_MANAGE).
`getQuillsFile` is the teammate read of `listQuillsStorage` (`routes/api/storage/$.ts#GET`).
`createQuillsFiles` keeps the v1 shape. It registers a verified presigned upload; the source stored a raw request body.
`createQuillsUploadFile` and `createQuillsUploadImage` (raw-body uploads by a team member; the ledger lists them as
custom audience) merge into `createQuillsUpload` plus `createQuillsFiles`, because Kaneo uploads go to storage directly.

## Settings object keys

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `saveQuillsLogoKey` | `PUT /settings/logo` (key, contentType, size) | manage_settings | `settings.logo_key` | `settings.logo_updated` | contract, rollback, storage-lifecycle |
| `deleteQuillsLogo` | `DELETE /settings/logo` | manage_settings | `settings.logo_key` | `settings.logo_removed` | contract, rollback, storage-lifecycle |
| `saveQuillsFaviconKey` | `PUT /settings/favicon` | manage_settings | `settings.favicon_key` | `settings.favicon_updated` | contract, rollback, storage-lifecycle |
| `deleteQuillsFavicon` | `DELETE /settings/favicon` | manage_settings | `settings.favicon_key` | `settings.favicon_removed` | contract, rollback, storage-lifecycle |
| `saveQuillsHeaderLogoKey` | `PUT /settings/header-logo` | manage_settings | `settings.header_logo_key` | `settings.header_logo_updated` | contract, rollback, storage-lifecycle |
| `deleteQuillsHeaderLogo` | `DELETE /settings/header-logo` | manage_settings | `settings.header_logo_key` | `settings.header_logo_removed` | contract, rollback, storage-lifecycle |

`saveQuillsHeaderLogoKey` and `deleteQuillsHeaderLogo` name SETTINGS_BRANDING; it maps to manage_settings like SETTINGS_MANAGE.
A PUT with the key that is already set and a DELETE with no key change nothing and record no event.

## Portal and widget uploads, customer avatar (`customer.ts`)

These routes are under `/quills-public/{workspace}`. `prepare` runs the gate and finds the caller's
customer in a read transaction. `call` signs or verifies outside any transaction. The handler's
transaction resolves the caller again (409 when it changed) and writes the reference.

- Key: `<S3_KEY_PREFIX>/workspace/<workspaceId>/quills/<purpose>/<customerId>/<cuid>.<ext>`. A customer
  verifies only keys under its own customer ID: another customer's key, or a teammate key, is 404.
- Purposes: `customer_file` (images, PDF, plain text, CSV), `customer_image` and `customer_avatar`
  (images). The `S3_MAX_IMAGE_UPLOAD_BYTES` limit applies. A portal account needs a customer profile
  here first (403, as the source); so does a removed customer, which keeps the profile row only.
- Widget uploads need the messenger or tickets tab and a visitor that the host app identified. An
  anonymous widget session gets 403. This is stricter than the source: customer files have no consumer
  and no sweep yet, so an anonymous caller must not fill storage.
- Rate limits per client and workspace: 20 a minute for uploads and registrations, 10 in 10 minutes
  for the avatar.
- Known gap: no route reads a registered customer file yet, and no sweep removes unattached `files` rows
  (teammate registrations have the same gap). An upload URL that is never registered leaves an object
  that nothing cleans up, as for teammates.

| operationId | Route | Audience | Tables | Event | Tests |
|---|---|---|---|---|---|
| `createQuillsPortalUpload` | `POST /portal/uploads` | portal (portal access gate) | - (signs a URL) | none | contract, `customer.test.ts` |
| `createQuillsPortalFiles` | `POST /portal/files` (idempotent per key) | portal (portal access gate) | `files` (`source` portal) | `file.created` (new file only) | contract (customer ownership, rollback), `customer.test.ts` |
| `createQuillsWidgetUpload` | `POST /widget/uploads` (`customer_file`, `customer_image`) | widget | - (signs a URL) | none | contract |
| `createQuillsWidgetFiles` | `POST /widget/files` (idempotent per key) | widget | `files` (`source` visitor) | `file.created` (new file only) | contract (another visitor's key), `customer.test.ts` |
| `saveQuillsCustomerAvatar` | `PUT /user/avatar` | portal (portal on) | `customer_identity.image_key` | `customer.profile_updated` | contract, `customer.test.ts` (replace queues the old object) |
| `deleteQuillsCustomerAvatar` | `DELETE /user/avatar` | portal (portal on) | `customer_identity.image_key` | `customer.profile_updated` (when it changed) | contract, `customer.test.ts` |

The profile reads (`portal/profile.ts`) return a short-lived URL of an uploaded avatar before the
provider image URL. The existing storage trigger, reference probes, workspace deletion and transfer
already cover `customer_identity.image_key` and `files.storage_key`.

## Not in this slice

| Source capability | Reason |
|---|---|
| `getQuillsWidgetHeroUploadUrl`, `saveQuillsWidgetHeroImageKey`, `deleteQuillsWidgetHeroImage` | Built in P3c with a `settings.widget_hero_key` column; see `portal/CUSTOMER-ROUTES.md`. |
| `getQuillsIdentityProviderLogoUploadUrl` | AUTH_MANAGE. The Kaneo Quills schema has no identity provider logo field to hold the key. Do it with the sign-in configuration routes. |
| `getQuillsAvatarUploadUrl` (teammate part) | A teammate avatar is the canonical Kaneo profile image. A Quills copy would be a parallel profile. |
| `listQuillsStorage` and `putQuillsStorage` (public proxy), the beacon form of `createQuillsFilesOpened`, the public use of `checkQuillsS3Configured` | Portal, widget or public audience: phase P3. The customer uploads and the avatar are built above. |
