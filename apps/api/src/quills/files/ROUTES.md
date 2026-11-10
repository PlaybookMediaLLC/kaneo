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

## Not in this slice

| Source capability | Reason |
|---|---|
| `getQuillsWidgetHeroUploadUrl`, `saveQuillsWidgetHeroImageKey`, `deleteQuillsWidgetHeroImage` | The key lives in `settings.widget_config` (JSON text) at `home.heroImageKey`. The reference probe, cleanup trigger, deletion listing and transfer do not cover it. Covering it needs a Quills migration that replaces four storage functions and parses JSON text in a trigger. Do it with the widget configuration routes. |
| `getQuillsIdentityProviderLogoUploadUrl` | AUTH_MANAGE. The Kaneo Quills schema has no identity provider logo field to hold the key. Do it with the sign-in configuration routes. |
| `getQuillsAvatarUploadUrl` (teammate part) | A teammate avatar is the canonical Kaneo profile image. A Quills copy would be a parallel profile. |
| `getQuillsAvatarUploadUrl` (customer part), `getQuillsWidgetImageUploadUrl`, `createQuillsPortalFiles`, `createQuillsPortalUpload`, `listQuillsStorage` and `putQuillsStorage` (public proxy), the beacon form of `createQuillsFilesOpened`, the public use of `checkQuillsS3Configured` | Portal, widget or public audience: phase P3. |
