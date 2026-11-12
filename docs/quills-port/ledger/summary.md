# Capability ledger summary (generated)

Source: Quackback `42ef2e01b2b48db87f1a9dadabbe6d57af0dd10c`. Rerun: `node scripts/quills-port/build-ledger.mjs <quackback dir>`.

## Completeness checks

| Check | Result |
|---|---|
| Route files under `apps/web/src/routes` | 514 |
| Rows in `routes.csv` | 514 |
| Rows without a disposition | 0 |
| Out-of-scope rows without a reason | 0 |
| Server functions found (`createServerFn`) | 874 |
| HTTP handlers found (route file × method) | 217 |
| Capabilities without a domain | 0 |
| Capabilities closed (`overrides.json`) | 70 |
| Ported capabilities not marked closed | 870 |
| Route files closed (`overrides.json`) | 11 |
| Server functions that no route file reaches | 131 (each still has a disposition) |
| Ported capabilities that use a table Kaneo does not have | 0 |
| Ported capabilities that cross the identity boundary (source reads its own auth tables) | 283 |

**All checks pass.**

## Route files by disposition

| Disposition | Route files |
|---|---|
| UI-only | 45 |
| out of scope | 1 |
| port | 378 |
| reuse Kaneo | 90 |

## Route files by kind

| Kind | Route files |
|---|---|
| api | 164 |
| helper | 18 |
| page | 157 |
| test | 175 |

## Phases

| Phase | Domains | Route files closed | Endpoints to build | Read | Mutation | Not teammate audience | With external effects |
|---|---|---|---|---|---|---|---|
| P0 | - | 3 | 0 | 0 | 0 | 0 | 0 |
| P1 | feedback | 57 | 149 | 60 | 89 | 9 | 25 |
| P10 | operations | 5 | 13 | 8 | 5 | 4 | 1 |
| P2 | directory, files, settings | 73 | 129 | 60 | 69 | 26 | 27 |
| P3 | portal, widget | 61 | 86 | 59 | 27 | 77 | 37 |
| P4 | delivery | 9 | 38 | 11 | 27 | 23 | 11 |
| P5 | support | 54 | 220 | 90 | 130 | 51 | 86 |
| P6 | help-center, status | 50 | 128 | 62 | 66 | 28 | 11 |
| P7 | integrations | 18 | 84 | 57 | 27 | 58 | 78 |
| P8 | assistant, automation | 24 | 76 | 29 | 47 | 31 | 16 |
| P9 | reporting, transfer | 24 | 17 | 14 | 3 | 9 | 6 |

## Capabilities not ported

| Domain | Disposition | Capabilities | Reason |
|---|---|---|---|
| reuse-identity | reuse Kaneo | 87 | Kaneo owns accounts, sessions, SSO, 2FA, invitations, roles, membership and API keys. |
| reuse-workspace | reuse Kaneo | 25 | Kaneo owns workspace setup. Quills defaults initialize on first scoped access. |
| reuse-platform | reuse Kaneo | 15 | Kaneo already serves health, OpenAPI docs, OAuth/MCP metadata and the MCP transport. |
| reuse-billing | reuse Kaneo | 18 | Kaneo has billing in apps/api/src/billing (checkout, provider webhooks, subscription state, seat sync, entitlement middleware). Quills features gate through that middleware. |
| reuse-telemetry | reuse Kaneo | 4 | Kaneo has product analytics (apps/web/src/lib/analytics) and its own version and onboarding prompts. |
| oos-dev | out of scope | 2 | Development or end-to-end test harness of the source app. |
| ui-shell | UI-only | 0 | App shell, layout or redirect. It has no server capability. |

## Tables

Quackback tables referenced by ported capabilities: 133. Kaneo `quills` tables: 149.

Referenced but absent in Kaneo: account, identity_provider, invitation, session, sso_recovery_code, sso_verified_domain, user. These are the source's auth tables. Kaneo owns identity, so they are not copied.

## Limits of the trace

- The trace follows identifiers through imports. A page row lists every server function its component tree can reach, so layout pages list many.
- The walk stops at the events, jobs, email, integrations, realtime and storage modules and records them as side effects.
- Permission keys come from `PERMISSIONS.X` in reached server code. A dynamic check does not appear.
- `audience` comes from the auth helper names. `public or custom` means that no known helper was found; review these rows first.
