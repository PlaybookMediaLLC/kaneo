# P10 operations: final route set and worker handlers

Source rows: `docs/quills-port/ledger/phase-P10.md` (13 capabilities). This file applies the merge rule
(`detailed-plan.md` §2) and the action mapping (§3). The format follows `detailed-plan.md` §5.

All paths are under `/quills/{workspaceId}`. Every route below is for teammates and uses `defineQuillsRoute`.
Each route module has a sibling `*.fixture.ts`, so `framework/contract.test.ts` checks every route.

## Boundary map

```
Tables and owning schema:  quills: custom_domains (new), settings (new column show_powered_by; slug read),
                           email_sending_domains, channel_accounts, ai_usage_log, posts, boards,
                           board_projects, principal, events, audit_log, job_queue; the wipe job
                           deletes from every Quills feature table (see "Worker handlers").
                           public (through framework/platform-reads.ts): workspace_billing and the
                           owner's trial grant (Kaneo's plan check, which can create the billing row),
                           project and project access (board visibility for usage counts).
                           public.storage_cleanup: written by the existing storage triggers.
Actor and workspace:       authenticated context (helper). Workers: withQuillsSystemWorkspace with
                           the job's own workspace.
Permissions:               workspace:read + quills:manage_settings, except getQuillsPoweredBy
                           (quills:read). No native permissions.
Persisted relationships:   board_projects (usage counts skip boards linked only to hidden projects).
Transaction:               one scoped transaction per request. The plan check and project visibility
                           run in `load`, after the permission checks, before the transaction.
External effects:          none in a request. The domain check worker makes one DNS TXT lookup for
                           the domain the workspace stores, outside any transaction, capped at 5 s.
```

## Custom domains (portal and help center)

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsCustomDomains` | `GET /operations/domains` | manage_settings | `custom_domains` | - | contract; B sees none of A's rows |
| `setQuillsPortalDomain` | `PUT /operations/domains/portal` | manage_settings | `custom_domains` | `custom_domain.set` | contract, rollback; 409 across workspaces; concurrency; 402 |
| `setQuillsHelpCenterDomain` | `PUT /operations/domains/help-center` | manage_settings | `custom_domains` | `custom_domain.set` | same |
| `removeQuillsPortalDomain` | `DELETE /operations/domains/portal` | manage_settings | `custom_domains` | `custom_domain.removed` | contract, rollback; release |
| `removeQuillsHelpCenterDomain` | `DELETE /operations/domains/help-center` | manage_settings | `custom_domains` | `custom_domain.removed` | same |
| `verifyQuillsPortalDomain` | `POST /operations/domains/portal/verify` | manage_settings | `custom_domains` | `custom_domain.verification_requested` | contract, rollback; 404 without a domain; 402 |
| `verifyQuillsHelpCenterDomain` | `POST /operations/domains/help-center/verify` | manage_settings | `custom_domains` | `custom_domain.verification_requested` | same |

Merged: 7 (`getQuillsCloudCustomDomains`, `hasQuillsCustomDomainEntitlement`, `getQuillsHelpCenterDomainSummary`,
`getQuillsHelpCenterDomainStatus` into the list; `mutateQuillsCloudCustomDomain` into set and remove;
`updateQuillsHelpCenterDomain` into set and remove; `verifyQuillsHelpCenterDomain` into verify).

- Action: `SETTINGS_CUSTOM_DOMAIN` and `HELP_CENTER_MANAGE` are configuration keys, so `manage_settings`.
  The ledger proposed `read` for the status read; §3 and rule 5 take the stricter action.
- Kaneo has no control plane, so the source's cloud hostnames (`add`, `refresh`, `makePrimary`) become one
  stored domain per kind, as the source's self-hosted help center domain was. `makePrimary` has no equivalent.
- Storage: `custom_domains`, primary key `(workspace_id, kind)`, forced RLS. The global unique index
  `custom_domains_domain_unique` on the normalized domain keeps a domain in one workspace and away from the
  workspace's other kind; the request maps its violation to 409. A check constraint keeps the stored form
  (lower case, no trailing dot).
- Input: a public host name, at most 200 characters after normalization (room for the TXT record name
  and for the outbox entity ID). Normalized to lower-case ASCII (punycode) without a
  trailing dot. IP addresses, ports, paths, credentials, single labels and `.test`, `.example`, `.invalid`,
  `.localhost` are refused (400).
- A new domain starts inactive with a new random TXT value. Sending the current domain again changes nothing.
  A domain is active only when `verified_at` is set, which only the domain check worker writes.
- Verification proves control with a TXT record `_kaneo-verification.<domain>` that holds the value. The source
  also made an HTTPS request to the domain; this port makes no HTTP request.
- Verify queues the check and returns the stored state. `custom_domain.checked` (a worker change, audited as
  `system`) invalidates client caches when the result is written.
- Plan check: set and verify call Kaneo's `requireWorkspaceEntitlement` in `load` and return its 402. Remove is
  always allowed. The list's `entitled` field is the same check without the error. Billing off: no gating.
- Transfer: `custom_domains` is omitted from workspace archives; the target sets and verifies its own domain.

## Email sending and sign-in domains

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `listQuillsSendingDomains` | `GET /operations/domains/sending` | manage_settings | `email_sending_domains`, `channel_accounts` | - | contract |

Merged: 1 (`getQuillsSendingDomainSummaries`). Not ported: 1 (`getQuillsSignInDomainSummaries`).

- Action: `CHANNEL_ACCOUNT_MANAGE` is a configuration key, so `manage_settings` (the ledger proposed `read`).
- At most 100 domains and 1,000 sending addresses per response. `ownershipProven` from the source is not
  returned: Kaneo has no proven-zone store.
- Sign-in domains map to Kaneo identity. The source lists SSO-verified email domains (`sso_verified_domain`);
  Quills does not store them, because Kaneo owns sign-in. The only sign-in domains Quills stores are the
  portal's allowed customer email domains, which `getQuillsPortalSettings` already returns as
  `access.allowedDomains`. No second route.

## Usage

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsUsage` | `GET /operations/usage` | manage_settings | `ai_usage_log`, `posts`, `boards`, `board_projects`, `principal` | - | contract, read-leak |

Merged: 1 (`listQuillsAdminUsage`, the source's `/api/v1/admin/usage`).

- Audience: the source used an instance admin token. Here it is a teammate read with `manage_settings`.
- `aiTokensThisMonth`: successful chat completions in the current UTC month, as in the source.
- `postCount` and `boardCount` count live rows on boards the caller can see; test customers' posts are
  not counted. `teamSeatCount` and `pendingInviteCount` are Kaneo membership and are not returned.

## "Powered by" badge

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `getQuillsPoweredBy` | `GET /operations/powered-by` | read | `settings` | - | contract |
| `setQuillsPoweredBy` | `PUT /operations/powered-by` | manage_settings | `settings` | `settings.powered_by_updated` | contract, rollback; 402 to hide |

Merged: 1 (`getQuillsShowPoweredBy`, read only in the source). The set route is new.

- Stored in `settings.show_powered_by` (default true). Hiding the badge needs Kaneo's plan check, as the
  source's `hideBranding` entitlement did. Showing it is always allowed.
- The source's read is public. The public portal read waits for the portal audience framework.

## Workspace wipe

| operationId | Route | Action | Tables | Event | Tests |
|---|---|---|---|---|---|
| `wipeQuillsWorkspaceData` | `POST /operations/wipe` | manage_settings | `settings` (slug) | `workspace.wipe_requested` | contract, rollback; 400 on a wrong slug |

Merged: 1 (`wipeQuillsCloudWorkspace`).

- The source asked the control plane to delete the cloud workspace and required the owner. Here it deletes
  Quills data only (configuration included, see below) and needs `manage_settings`, as the P10 brief
  specifies; an admin role or an API key with that action can request it. `confirm` must equal Kaneo's
  workspace slug.
- The route records the event only. The worker runs the wipe (see below).

## Not ported in P10

| operationId | Reason |
|---|---|
| `createQuillsInternalJobWake` | Out of scope: needs an internal credential audience. |
| `getQuillsSignInDomainSummaries` | Kaneo identity; see "Email sending and sign-in domains". |

## Worker handlers

`jobs/fanout.ts` maps an event to a queue (`eventQueues`). Each job is deduplicated by the event ID and
allowed three attempts. Both queues are in `QUILLS_QUEUES` and in `quills.runnable_workspaces`.

| Queue | Event | Handler | Behavior |
|---|---|---|---|
| `quills.domain_check` | `custom_domain.verification_requested` | `handlers/domain-check.ts` | Reads the domain the event names, only if this workspace stores it. One TXT lookup outside a transaction (`node:dns/promises`, 2 s per try, 2 tries, cancelled at 5 s). Writes the outcome only for the same domain and value, with the job's lease. A missing record clears `verified_at`; no answer keeps it. Records `custom_domain.checked`. |
| `quills.wipe` | `workspace.wipe_requested` | `handlers/wipe.ts` | One transaction: deletes every Quills feature table in foreign-key order (referencing tables first), records `workspace.wiped`, finishes the job. A failure, or a lease that another worker took, rolls everything back and the retry starts again; a rerun deletes nothing more. It runs inline in the drain loop with no time cap (see "Known limits"). A job whose event is not a wipe request for this workspace deletes nothing. |

The wipe keeps `settings`, the seeded catalogues (`roles`, `permissions`, `role_permissions`,
`principal_role_assignments`, `post_statuses`, `ticket_statuses`), teammate actors (`principal` rows with a
Kaneo user), `custom_domains`, `events`, `job_queue`, `hook_deliveries` and `audit_log` (append-only).
Everything else is deleted, configuration included: webhooks, integrations and their credentials, Quills
API keys and OAuth clients, teams (with their Kaneo team bindings), sending domains and channel accounts,
workflows, macros, SLA policies, ticket types and status page data. Customer, visitor and service actors are
deleted. `team_members` rows go with their teams, because the roster guard refuses a direct delete for a
Kaneo-bound team. The storage triggers queue every removed object key in `public.storage_cleanup`. It never
touches `public` tables or the workspace.

## Known limits

- A domain claim does not expire. The global unique index also covers inactive claims, so a workspace that
  sets a domain it does not control blocks the real owner (409) until it removes the claim. The TXT check
  stops a hijack, not this block. Upgrade path: unique only on verified rows, with the conflict settled by
  the domain check, or an expiry for inactive claims.
- The wipe is one unbounded transaction in the shared drain loop. Many referencing foreign keys to
  `principal` have no index, so a workspace with many customers can take minutes: this instance's Quills
  jobs wait, and with several instances another worker claims the job after the five-minute lease and the
  first run rolls back. Upgrade path: a batched, resumable wipe outside the drain loop, or indexes on those
  foreign keys.
