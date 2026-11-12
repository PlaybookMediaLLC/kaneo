# Quills port plan: Quackback capability in Kaneo's API

Status: all phases P0 to P10 are implemented in `apps/api/src/quills/`, with the widget client in
`packages/widget`. Each slice's route table (`ROUTES.md` next to its code) lists what it ported,
what it deferred and why.

[RFC 0001](rfc-0001-remaining-capabilities.md) (issue #131, 76 remaining entry points) is integrated
on `feat/quills-131-integration`. The route registry has 745 declarations (679 before RFC 0001),
with the Trello connect of follow-up FU1.

| Entry points of #131 | Count |
|---|---|
| Built (lanes X1, C1, G1, G2, S1, B1, M1, P1, P2, P3, P4, and FU1 for Trello): 73 of the 73 assigned to lanes | 73 |
| Blocked: widget handoff (#129) | 1 |
| Web-only: portal header setters (#130) | 2 |

`ledger/overrides.json` closes the 73 built entry points: 62 server functions
(`overrides.capabilities`) and 11 route files (`overrides.routes`). `capabilities.csv` has a `closed`
column, and `ledger/summary.md` counts the closed rows.

Goal: bring all of Quackback's feedback and support capability into Kaneo's API at
`apps/api`, behind one shared route framework, with no added cost for upstream merges.

## Documents

| Document | Content |
|---|---|
| [roadmap.md](roadmap.md) | Level 1. Eleven phases (P0 to P10) in dependency and risk order. For each: ledger rows closed, endpoints, migrations, acceptance checks. |
| [detailed-plan.md](detailed-plan.md) | Level 2. How to read each endpoint row, the merge rule, the action mapping, and the final route tables for P0 and P1. |
| [framework.md](framework.md) | The route helper, the contract test, the map from each `apps/api/AGENTS.md` rule to a mechanism or a test, and the `links.ts` rewrite. |
| [ledger/summary.md](ledger/summary.md) | Generated. Completeness checks and counts. |
| [ledger/routes.csv](ledger/routes.csv) | Generated. One row per Quackback route file (514). |
| [ledger/capabilities.csv](ledger/capabilities.csv) | Generated. One row per server function and HTTP handler (1,091). |
| `ledger/phase-P1.md` to `ledger/phase-P10.md` | Generated. The per-endpoint plan for each phase. |
| [ledger/overrides.json](ledger/overrides.json) | Manual decisions per row: `domain`, `disposition`, `reason`, `closed`, `mergedInto`. |

## How to rebuild and check

```sh
# 1. The ledger. Exit code 1 if a row has no disposition or the row count is wrong.
node scripts/quills-port/build-ledger.mjs ../quackback

# 2. Upstream safety. Exit code 1 if upstream has history in a fork-owned path,
#    or if an upstream file references Quills and is not in the seam registry.
git fetch https://github.com/usekaneo/kaneo.git main:refs/remotes/upstream/main
node scripts/quills-port/check-upstream.mjs
```

| Script | Purpose |
|---|---|
| `scripts/quills-port/trace.mjs` | Follows each route file through imports, at symbol level, to server functions, tables, permission keys and side effects. |
| `scripts/quills-port/rules.mjs` | The disposition rules: path or function → domain → phase. Edit this file to change a decision. |
| `scripts/quills-port/build-ledger.mjs` | Writes the ledger and the per-phase endpoint files. |
| `scripts/quills-port/seams.json` | The registry of fork-owned paths and of seams in upstream files. |
| `scripts/quills-port/check-upstream.mjs` | Checks the registry against `upstream/main`. |

## Result against the "done" criteria

| Criterion | Result | Evidence |
|---|---|---|
| The ledger row count equals the number of route files, and no row lacks a disposition | 514 rows, 514 files, 0 without a disposition, 0 out-of-scope rows without a reason | `ledger/summary.md`; the builder exits 1 otherwise |
| Every AGENTS.md rule maps to a mechanism or a test | 10 hard rules, the request path, the schema-crossing rules, the mutation rules, the schema rules and the 9 evidence rows are mapped | `framework.md`, section 4 |
| `git log upstream/main --oneline -- <planned path>` is empty, except for the seam registry | Empty for all 12 fork-owned paths. 9 seams are registered; 8 exist today. | `check-upstream.mjs` prints `PASSED` |
| The contract-test spec would fail a route with a missing permission check | The self-test builds that route and requires the findings `registered`, `denied-action` and `api-key-scope` | `framework.md`, section 5 |

Three review items in the rule map are not automatic: privileged database functions,
destructive migrations, and the reuse of the existing link tables. The plan adds none of the
first two. They stay as review items at each phase kickoff.

## Dispositions

| Disposition | Route files | Meaning |
|---|---|---|
| Port | 378 | The capability becomes Quills routes in `apps/api/src/quills`. Tests of ported capabilities are in this group; their assertions become endpoint tests. |
| Reuse Kaneo | 90 | Kaneo already owns it: accounts, sessions, SSO, invitations, roles, members, API keys, workspace setup and the onboarding wizard, billing, telemetry, health, OAuth and MCP metadata. |
| UI-only | 45 | Layout, redirect or static page with no server capability. |
| Out of scope | 1 | The source test harness (`e2e.widget.ts`). |

The plan adds no auth, tenant or membership model. Customers and visitors stay Quills
`customer_identity` and principal records, as the API contract says.

## Upstream safety

- Every new file is under `apps/api/src/quills`, `apps/api/src/database/quills` or `apps/api/drizzle/quills`.
- Migrations go only through `pnpm --filter @kaneo/api db:generate:quills`.
- Existing seams in upstream files: the mount and startup migration in `apps/api/src/index.ts`,
  the scheduler registrations, two storage hooks, the `quills` resource in `packages/permissions`,
  the integration-test helper, and the `package.json` scripts.
- Planned seam changes: **one**. P3 adds a second mount line in `apps/api/src/index.ts` for public
  routes, because Kaneo registers public routes before its session middleware. The target of
  "only the existing mount" holds for P0 to P2 and for every teammate route.
- `apps/docs/openapi.json` is generated. On an upstream conflict, take upstream and regenerate.

## Decisions

Decided on 2026-11-10: **D1, D2, D3 and D6 are accepted as recommended.**
**D5 is changed:** billing, telemetry and the onboarding wizard use Kaneo's own implementations. Custom domains, fleet wake and usage are ported in the new phase P10.
**D4 is accepted:** P3 adds one mount line in `apps/api/src/index.ts` for public Quills routes, before the session middleware.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | How do portal customers sign in? | Use Kaneo's existing accounts, with no workspace membership, linked through `customer_identity.kaneo_user_id`. Anonymous widget visitors use the widget session tables and the HMAC identify call. This adds no second login system. | P3 |
| D2 | Keep five Quills actions, or add finer ones? | Keep five through P2, and record the source key in each declaration. Finer actions change `packages/permissions`, which is an upstream file. Decide again after P2 with real role feedback. | P5 at the latest |
| D3 | Is the `/api/v1` shape the canonical route shape? | Yes. Server functions merge into it (merge rule in `detailed-plan.md`). | P1 kickoff |
| D4 | Accept the one new mount line in `index.ts` for public routes? | Yes. The alternative is a change to the session middleware's skip list, which is a larger seam. | P3 |
| D5 | Confirm the out-of-scope list: billing, cloud domains, fleet, telemetry, onboarding wizard | Confirm. Each row has its reason in `routes.csv`. | none |
| D6 | Which of the 25 integration providers to port? | The provider-neutral core first, then providers by demand. Kaneo already has task integrations for GitHub, GitLab, Gitea, Slack, Discord, Mattermost and Telegram. | P7 |

## Limits

- The trace is static. It follows identifiers, not types. A page row lists every server
  function that its component tree can reach, so shared layouts list many.
- The side-effect column shows the modules that a call chain enters. It does not prove that
  a given request sends mail.
- 85 ported capabilities have the audience "public or custom": the trace found no known auth
  helper. Review these rows first at the kickoff of their phase.
- 131 server functions are not reached from any route file. Each one still has a disposition
  in `capabilities.csv`.
- The 940 ported capabilities are an upper limit on endpoints. The P1 merge takes 149 source
  capabilities to about 85 routes.
- The proposed paths, actions and events in the generated phase files are derived from names.
  The phase kickoff fixes them. P0 and P1 are fixed by hand in `detailed-plan.md`.
- `scripts/quills-port` uses `@babel/parser`, which is a transitive dependency of this
  repository. TypeScript 7 has no JavaScript parser API.
