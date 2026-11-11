# X1 route set: sidebar apps (RFC 0001, lane X1)

All paths are under `/quills/{workspaceId}`. `apps/index.ts` mounts this set.
The seven app routes use the `app` audience (`framework/app.ts`); the framework adds the `/apps` prefix.
The three `/app-registrations` routes are teammate routes (decision D13).
Source: `routes/api/v1/apps/{boards,link,linked,posts,search,suggest,unlink}` and `lib/server/integrations/apps/service.ts`.

## Boundary map

```
Tables and owning schema:  quills: apps (binding gate, registration), boards, board_projects, posts, post_statuses,
                           post_votes, post_subscriptions, post_activity, post_external_links, customer_identity,
                           principal, events, job_queue, audit_log.
                           public: apikey (written only by framework/app-keys.ts: mint, scope, undo); apikey and
                           workspace_member read by the existing auth and workspace middleware; projects through
                           framework/platform-reads.ts (board visibility).
Actor and workspace:       c.get("userId") is the API key's owner (authenticateApiRequest). c.get("workspaceId")
                           from workspaceAccess.fromParam. The audit actor is the owner's teammate principal.
                           Never from the body, the query or the app row.
Permissions:               workspace:read + quills:<action>, checked against the owner's role AND the key's scope.
                           The key scope must not be null. App gate: an active apps row of the path workspace
                           with api_key_id = the key, whose granted_scopes hold the route's capability.
                           Registration: quills:manage_settings, also quills:read to create; the caller must
                           hold every Quills action that the requested scopes give the key.
Persisted relationships:   apps.api_key_id (decision D12); board_projects (visibility); post_external_links in
                           the app namespace (integration_id IS NULL, sync_scope = '').
Transactions:              one scoped transaction per request; its first statement is the gate. Suggest and the
                           two registration writes: prepare (gate) -> call (no transaction) -> handler (gate again).
External effects:          suggest sends the ticket text to the configured embedding provider in `call`.
                           Registration writes public.apikey in `call` (see "Two stores"). Workers deliver
                           events after commit.
Completion checks:         authenticated endpoint, tenant/object access, native resource link (board visibility),
                           mutation, read/search, schema (migration of D12)
```

## App routes

| operationId | Route | Action | Capability | Tables | Events (each with `appId`) | Tests |
|---|---|---|---|---|---|---|
| `listQuillsAppBoards` | `GET /apps/boards?offset&limit` | read | read:feedback | boards, board_projects | - | contract |
| `searchQuillsAppPosts` | `GET /apps/search?q&limit` | read | read:feedback | posts, boards, board_projects, post_statuses, principal | - | contract |
| `suggestQuillsAppPosts` | `GET /apps/suggest?text&limit` | read | read:feedback | as search | - | contract, `apps.test.ts` (embedding, provider failure, unbound key) |
| `createQuillsAppPost` | `POST /apps/posts` | create | write:feedback | posts, post_votes, post_subscriptions, post_activity, post_external_links, customer_identity, principal | `post.created`, `app.post_created`, `app.post_linked` with `link`, `user.identified` with `requester` | contract |
| `linkQuillsAppPost` | `PUT /apps/links` | update | write:feedback | post_external_links, post_votes, posts, customer_identity, principal, post_activity | `app.post_linked` when linked, `post.voted` when voted, `user.identified` with `requester` | contract, `apps.test.ts` |
| `unlinkQuillsAppPost` | `DELETE /apps/links?postId&externalType&externalKey` | update | write:feedback | post_external_links | `app.post_unlinked` when changed | contract, `apps.test.ts` |
| `listQuillsAppLinkedPosts` | `GET /apps/links?externalType&externalKey` | read | read:feedback | post_external_links, posts, boards, board_projects, post_statuses | - | contract, `apps.test.ts` |

## Registration routes (teammates)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsAppRegistrations` | `GET /app-registrations?offset&limit` | manage_settings | apps | - | contract |
| `createQuillsAppRegistration` | `POST /app-registrations` | manage_settings (also read) | apps; public.apikey | `app.registered` | contract, `apps.test.ts` (end to end, bind failure, undo failure) |
| `updateQuillsAppRegistration` | `PATCH /app-registrations/{appId}` | manage_settings | apps; public.apikey | `app.updated` | contract, `apps.test.ts` (disable, rescope) |

## Authorization sequence (each app request)

| # | Check | Where | Failure |
|---|---|---|---|
| 1 | The key is valid, enabled, not expired, its owner is not banned, within rate and quota | `authenticateApiRequest` | 401, 429 |
| 2 | The key belongs to its owner; the owner is a member (or an instance admin); the workspace is live | `workspaceAccess.fromParam` | 403, 404, 403 `WORKSPACE_ARCHIVED` |
| 3 | Zod validation | validators | 400 |
| 4 | An API key is present, with a scope | `appKey` | 403 `APP_NOT_BOUND`, 403 `API_KEY_SCOPE` |
| 5 | Key scope, then the owner's role, hold workspace:read and the action | `withQuillsRequest` | 403 `API_KEY_SCOPE`, 403 `MISSING_PERMISSION` |
| 6 | `load`: the projects that the owner can open | `loadProjects` | - |
| 7 | Gate: an active app holds the key in this workspace (RLS) and holds the capability | `boundApp`, first statement | 403 `APP_NOT_BOUND`, 403 `APP_SCOPE` |
| 8 | The board or post is live and on a board that the owner can see | `findBoard`, `findPost`, `visiblePost` | 404 |
| 9 | The requester's email is not a teammate's | `identifyCustomer` | 409 |

`APP_NOT_BOUND` does not tell apart a session, an unbound key, a disabled app and a key bound only in another
workspace. A failure at steps 7 to 9 rolls back the whole transaction.

## Key confinement (decision D15)

A teammate route called with an API key refuses a key that an app of the path workspace holds (403
`APP_KEY_CONFINED`). The check is the first statement of each scoped transaction, so it runs before a
`prepare` and its `call`. It is one lookup on `apps_api_key_id_idx` and runs only for requests made with a key;
`apps.test.ts` counts the statements and reads the plan. The contract check `app-key-confined` sends a bound key
to every teammate route.

Difference from the design: confinement holds for an app in any status, not only an active one. A disabled
app's key must not get its teammate access back.

## Two stores: the app's API key (decision D14)

The key is in `public.apikey`; the app row is in `quills.apps`. They never share a transaction.
An app route needs both: the key's scope and the gate. So the authority in force is the smaller of the two.

- Create: `prepare` checks the caller's actions and computes the key scope (workspace:read and the Quills actions
  of the scopes). `call` mints the key through the better-auth API-key plugin (`auth.api.createApiKey`, server side,
  with `permissions`). The handler inserts the bound app row and returns the secret. When the handler transaction
  fails, the framework's `revert` deletes the key, and the secret is in no response.
- If the delete fails too (the database is down), the key stays with no app. Its secret was never sent or logged,
  so nobody can use it; the owner sees it as "App <name>" in the API key list and can delete it. A crash between
  the mint and the commit leaves the same state.
- Update: `call` sets the key's scope before the handler changes the app row. A failure between the two steps
  leaves the narrower of the old and new scopes in force, never a wider one. A retry repairs it.
- Disable: the gate refuses the key at once; confinement keeps it off the teammate routes. The key row stays
  enabled, so an enabled app works again with the same key.
- The registration response returns the secret once. When the response is lost, disable the app and register again.

## Differences from the source

| Source | Kaneo | Reason |
|---|---|---|
| A `qb_` API key with its own service principal | A Kaneo API key with quills scopes, bound to one app; the actor is the key's owner | Decision D9; Kaneo owns identity |
| `/api/v1/apps/...`, workspace from the key | `/quills/{workspaceId}/apps/...` | Workspace in the path, as every Quills route |
| `{data}` envelope, 201 on create and link | No envelope, 200 | Framework convention |
| `POST /link`, `POST /unlink` | `PUT /apps/links`, `DELETE /apps/links` | Idempotent methods |
| `integrationType`, `externalId`, `principalId`, `board.name` | `externalType`, `externalKey`, `voterPrincipalId`, `boardName` | `externalId` would read as a Kaneo ID to the `foreign-ids` check |
| Boards route has no permission gate | quills:read | Every route checks an action |
| Visibility by role and tier | The key owner's project access (board links) | Kaneo's one board-visibility rule |
| `linked` does not filter visibility | Leaves out deleted posts, posts on hidden boards and test-customer posts | Read rule of the API contract |
| Boards and linked are not limited | Boards is paged; linked returns at most 100 | Bounded responses |
| Search returns `[]` for an empty `q` | 400 | Bounded inputs |
| Search returns null status values | Real status name and color | - |
| Suggest falls back only when AI is not configured | Also when the provider fails; leaves out merged posts; ties rank by votes | Availability; duplicate suggestions |
| Suggest logs AI usage | No usage row | A read writes no rows |
| Create response has `content` | No `content`; adds `authorPrincipalId` and `linkId` | Intentional fields |
| A requester-authored post | The key's owner is recorded as `trackedByPrincipalId` | As conversation posts |
| Create does not emit `post.created` for apps | Emits `post.created` and `app.post_created` | Existing consumers (duplicate check, trackers) |
| Unlink deletes any `sync_scope = ''` link of that type | Only the app's links (no integration) | An integration's link is not the app's |
| Any link type | `live_chat` and `import` are reserved (400) | Conversation links and import markers use them with no integration |
| A link to an item that an integration owns returns the existing link | 409 | That link is not the app's |
| Post activity names the API key's principal | The key's owner | The actor is the owner |
| CORS `*` on the app routes | None (deferred, owner decision Q5) | The sidebar page is served by Kaneo web |
| No registration routes | `/app-registrations` list, create, update | Decision D13 |
