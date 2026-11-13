# RFC 0002: Quills portal pages in `apps/web`

| Field | Value |
|---|---|
| Status | Draft. It needs the owner decisions in section 3. |
| Issue | [#130](https://github.com/PlaybookMediaLLC/kaneo/issues/130) |
| Related | #129 (widget handoff decision), #132 (teammate pages, a later RFC) |
| Target | `apps/web`, plus small changes in `apps/api/src/quills` and `packages/email/src/quills` |
| Executors | Subagents, model Opus, effort `xhigh`, one git worktree and one local branch each |
| Base branch | `staging` |

## 1. Summary

The API sends mail with links to `KANEO_CLIENT_URL/portal/{workspaceId}/…`. No such page exists in
`apps/web`. Two more links show raw JSON: the unsubscribe link and the OAuth return after a teammate
connects a provider. RFC 0001 added 13 more connectable providers, so the OAuth problem grew.

This RFC builds the portal pages in `apps/web`. It has three equal goals:

1. **Fix the broken links first.** Mail links, unsubscribe and the OAuth return.
2. **Cause no merge conflicts with upstream.** Upstream changes `apps/web` often (section 4.1).
   Quills code lives in fork-owned paths and touches upstream files at 2 registered seams only.
3. **Make every page uniform.** A small CLI generates each page, fetcher, hook and component from
   one template, and a conformance check rejects code that does not follow the standard.

## 2. Scope

### In scope

| Group | Pages |
|---|---|
| Mail actions | Invite accept, CSAT rating, unsubscribe |
| OAuth return | One result page for every provider and connector callback |
| Mail-linked detail | Post, conversation (with reply), status incident |
| Public content | Changelog list and entry, status page, help center home, category and article |
| Full portal | Boards and post list, submit, vote, comment, profile and preferences, customer conversations and tickets |

### Not in scope

- Teammate pages (#132), except the OAuth result page.
- The widget-to-portal handoff (#129). Section 2 of the portal works without it.
- Translations other than `en-US`. Other locales fall back to `en-US` (decision D18).
- Server rendering for search engines (decision D19).
- Any change to `packages/widget`.

## 3. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| D16 | The OAuth callbacks answer JSON. Browsers need a page. | **Content negotiation.** A browser navigation (`Sec-Fetch-Mode: navigate`, or `Accept` that prefers `text/html`) gets a 303 redirect to the web result page. Any other client keeps the JSON answer, so API and MCP clients do not break. |
| D17 | Status mail links to `/status/incidents/{id}`; the RSS feed links to `/status/{id}`. | **Canonical `/status/incidents/{id}`.** The feed changes to it. The web route `/status/{id}` stays as a redirect, because readers already hold old feed items. |
| D18 | Portal text in 22 more locales? | **`en-US` only now.** The `quills` namespace falls back to `en-US`. Translation is a later task. |
| D19 | The help center and changelog are client-rendered. A crawler that runs no JavaScript sees little. | **Accept for now.** The sitemap still lists the URLs. Prerender is a later RFC. |
| D20 | Sign-up and check-email drop the `redirect` search value. | **Add it (seam S2), and offer the same change upstream.** Upstream sign-in and OTP verification already carry it, so the change is small and generic. If upstream accepts it, the seam disappears. |
| D21 | Browser tests in hosted CI, or local proof only? | **Local proof in lane Z for this RFC.** A CI browser test needs seeded portal data in the disposable instance. Add it later as its own change. |

## 4. Upstream safety

### 4.1 Measured upstream churn

Commits on `upstream/main` since 2026-08-01 that touch each path:

| Path | Commits | Rule for this RFC |
|---|---|---|
| `apps/web/src/components` | 382 | Do not add or edit files. Import shared UI through one adapter (4.4). |
| `apps/web/src/hooks` | 204 | Do not add files. |
| `i18n/en-US.json` | 171 | Do not add keys. Use the `quills` namespace (4.5). |
| `apps/web/src/routes` | 147 | Add files only under `routes/portal/` and `routes/quills/`, which upstream does not have. |
| `apps/web/src/fetchers` | 95 | Do not add files. |
| `apps/web/package.json` | 35 | Do not edit. Add no dependency. |
| `apps/web/src/routeTree.gen.ts` | 18 | Generated. Regenerate on conflict (seam S1). |
| `apps/web/src/routes/auth` | 15 | Seam S2 only. |

The two existing Quills modules in upstream folders (`fetchers/quills/`, `hooks/queries/quills/`)
stay where they are. New code does not join them.

### 4.2 Fork-owned paths

Lane W0 adds these to `forkOwned` in `scripts/quills-port/seams.json`:

```
apps/web/src/quills
apps/web/src/routes/portal
apps/web/src/routes/quills
scripts/quills-web
```

`node scripts/quills-port/check-upstream.mjs` then fails if upstream ever adds history in them.

### 4.3 The complete seam list

| # | File | Change | Conflict resolution |
|---|---|---|---|
| S1 | `apps/web/src/routeTree.gen.ts` | New portal and Quills routes appear in the generated tree. | Generated. Take either side, then regenerate with the router plugin (`pnpm --filter @kaneo/web build`). The same rule as `apps/docs/openapi.json`. |
| S2 | `apps/web/src/routes/auth/sign-up.tsx`, `apps/web/src/routes/auth/check-email.tsx` | Accept `redirect` in the search schema, pass it on, and use `getSafeRedirectPath`, as `sign-in.tsx` and `verify-otp.tsx` already do. About 6 lines. | Small and local. Removed if upstream accepts the change (D20). |

No other upstream file changes. In particular: no edit to `__root.tsx`, `_layout.tsx`, the
navigation, `vite.config.ts`, `tsconfig`, any `package.json`, the lockfile, or `i18n/*.json`.
Portal routes are top-level siblings of `_layout`, as `public-project.$projectId.tsx` is, so they
need no layout change.

All API and mail changes are under `apps/api/src/quills` and `packages/email/src/quills`, which
are fork-owned already.

### 4.4 One adapter for upstream code

Quills web code imports upstream modules only through one file:

```
apps/web/src/quills/ui/upstream.ts
```

It re-exports the upstream pieces that Quills uses: UI primitives from `@/components/ui/*`, the
toast, `HttpError`, `getSafeRedirectPath`, and the `i18n` instance. When upstream renames or moves
one of these, one file breaks, and the fix is one line.

Packages are allowed directly: `@kaneo/libs`, `@kaneo/branding`, `@tanstack/react-router`,
`@tanstack/react-query`, `react-i18next`, `zod`, `lucide-react`.

A boundary test (`apps/web/src/quills/boundaries.test.ts`) fails on any other import of `@/…` from
`apps/web/src/quills/**` or `apps/web/src/routes/{portal,quills}/**`.

### 4.5 Translations without `en-US.json`

- Namespace `quills`. Keys look like `quills:portal.invite.title`.
- One file for each feature: `apps/web/src/quills/i18n/en-US/<feature>.json`. Each lane owns its
  feature files, so lanes do not conflict with each other.
- `apps/web/src/quills/i18n/load.ts` merges the feature files with `import.meta.glob`, passes the
  result through `brandResources` from `@kaneo/branding` (as the upstream loader does), and calls
  `i18n.addResourceBundle(locale, "quills", bundle, true, true)`.
- The portal layout route and the OAuth result route call `ensureQuillsI18n()` in `beforeLoad`.
  A `languageChanged` listener loads the bundle for a new locale.
- A locale with no `quills` bundle falls back to `en-US` through the existing `fallbackLng`.

No upstream file changes for this.

## 5. Architecture

### 5.1 Layout

```
apps/web/src/quills/
  api/
    client.ts           the typed client (re-export of @kaneo/libs `client`)
    errors.ts           HttpError → PortalProblem (see 5.3)
    keys.ts             query key factory, one entry per operation
    <area>/<operation>.ts         one fetcher per API operation        (generated)
    <area>/<operation>.test.ts                                          (generated)
  hooks/
    <area>/use-<operation>.ts     one query or mutation hook          (generated)
    <area>/use-<operation>.test.tsx                                      (generated)
  i18n/
    load.ts
    en-US/<feature>.json
  ui/
    upstream.ts         the only door to upstream modules (4.4)
    portal-shell.tsx    page frame: workspace name, brand, sign-in state, footer
    portal-gate.tsx     portal off, private portal, sign-in, no access (5.3)
    state-view.tsx      one view for loading, empty, not found, gone and error
    confirm-action.tsx  a button-gated action for token links (5.4)
    result-card.tsx     the outcome of an action
  portal/
    layout.tsx          the portal layout: shell + gate + i18n
    pages/<page>/<page>-page.tsx        (generated, then filled in)
    pages/<page>/<page>-page.test.tsx   (generated, then filled in)
    pages/<page>/parts/*.tsx            page-local components
  oauth/
    result-page.tsx, result-page.test.tsx
  test/
    render.tsx          render with router, query client and i18n
    fetch-mock.ts       typed responses for a mocked client
  boundaries.test.ts
  conformance.test.ts

apps/web/src/routes/portal/$workspaceId.tsx                  the portal layout route
apps/web/src/routes/portal/$workspaceId/<…>.tsx              thin route files (generated)
apps/web/src/routes/quills/oauth.result.tsx                  thin route file (generated)
```

A route file is thin. It declares the path, validates the search values with `zod`, prefetches with
`queryClient.ensureQueryData`, and renders one page component from `@/quills/…`. All logic lives in
`apps/web/src/quills`, which upstream never touches.

### 5.2 One source of truth for portal paths

Today the API builds portal links in four places (`jobs/fanout.ts`, `jobs/handlers/status-mail.ts`,
`jobs/handlers/support-mail.ts`, `portal/feedback/feeds.ts`), and two of them disagree (D17).

Lane W0 adds `apps/api/src/quills/portal/paths.ts`. It is a pure module with no imports. It exports
one function for each portal page, for example `portalPaths.post(workspaceId, postId)`, and the
list of path patterns. Every API caller uses it.

The web conformance check imports the same file and compares its patterns with the route tree. A
mail link without a web page, or a portal page that mail cannot reach by a known path, fails the
check.

### 5.3 Portal problems

`api/errors.ts` maps every failed call to one `PortalProblem`:

| Problem | Cause | What the page shows |
|---|---|---|
| `off` | The workspace has no portal (`getQuillsPublicPortalConfig`) | A clear "this portal is not available" state, with no data |
| `signIn` | Private portal, no session | A sign-in prompt that returns to the same page (`/auth/sign-in?redirect=…`) |
| `noAccess` | Private portal, signed in, no access (`evaluateQuillsMyPortalAccess`) | A 403 state. It never shows whether a record exists. |
| `notFound` | 404, or a record the viewer may not see | A 404 state |
| `gone` | An expired or used token | A "this link expired" state with a next step |
| `failed` | Network or 5xx | A retry button |

`PortalGate` resolves `off`, `signIn` and `noAccess` once in the layout route. A page handles only
`notFound`, `gone` and `failed`, through `StateView`. Every page therefore shows the same states in
the same way.

### 5.4 Rules every page follows

1. **Results first.** The page leads with the outcome or the content. Complex controls open in a
   sheet.
2. **No action on page load.** Mail scanners open links. A CSAT rating, an unsubscribe and an
   invite accept happen only after a click on `ConfirmAction`.
3. **Tokens stay out of logs.** The invite token stays in the URL fragment, as the API designed it.
   A page that reads a token from the query (CSAT, unsubscribe) removes it from the address bar
   with `history.replaceState` after it reads it, and sets `<meta name="referrer"
   content="no-referrer">`.
4. **Sign-in returns to the portal.** A portal customer has a Kaneo account and no workspace
   (decision D1). Sign-in and sign-up always carry `redirect` back to the portal page, so the
   person never lands in workspace onboarding.
5. **Caches are scoped.** Each query key holds the workspace ID and the viewer (anonymous, or the
   session user ID). Sign-out removes every `quills` query.
6. **Both deployments work.** Bundled same-origin and separately hosted API and web. All calls go
   through the typed client with `credentials: "include"`. All links come from `KANEO_CLIENT_URL`.
7. **Accessible.** Landmarks, one `h1`, labelled controls, focus moves to the `h1` on navigation.
   Tests query by role and label, so an unlabelled control fails its test.
8. **Branded text.** All text is in the `quills` namespace. `pnpm branding:check` must report no
   findings.

## 6. The CLI

### 6.1 Why a CLI

Every page, fetcher and hook has the same shape. A generator gives each one the same files, tests,
keys and imports, so a reviewer reads only the part that differs. The conformance check then keeps
that shape over time, including for code that someone writes by hand.

### 6.2 Form

```
node scripts/quills-web/cli.mjs <command> [arguments]
```

- Node standard library only (`node:util` `parseArgs`, `node:fs`, `node:path`). No new dependency,
  so no `package.json` or lockfile change.
- Not a `package.json` script, so no seam. The README of the folder documents the commands.
- It never overwrites a file. It prints each file it writes.
- Generated files pass `pnpm exec vp check --fix` unchanged.
- Templates live in `scripts/quills-web/templates/`. A template change is a reviewed code change.

### 6.3 Commands

| Command | Writes |
|---|---|
| `page <route> --audience public\|portal\|signed-in [--search name:type,…] [--feature <name>]` | The thin route file, the page component, its test, and the feature's i18n file (or new keys in it). The route path comes from `paths.ts` when the page is mail-linked. |
| `query <operationId> [--area <name>]` | The fetcher, its test, the key in `keys.ts`, the query hook and its test. It reads `apps/docs/openapi.json` to find the method, path and parameters, and writes the typed client call. An unknown operation ID is an error. |
| `mutation <operationId> --invalidates <key,…> [--area <name>]` | The same as `query`, with a mutation hook that invalidates the named keys. |
| `component <area>/<Name>` | A component and its test, in `quills/ui` or in a page's `parts/`. |
| `check` | Runs the conformance rules (6.4). Exit code 1 on any finding. |
| `list` | Prints every page, route, operation and i18n feature, for docs and review. |

Example: `node scripts/quills-web/cli.mjs mutation recordQuillsCsatViaToken --area support` writes
`quills/api/support/record-csat-via-token.ts`, its test, a `keys.ts` entry, and
`quills/hooks/support/use-record-csat-via-token.ts` with its test.

### 6.4 Conformance rules (`check`)

| # | Rule |
|---|---|
| C1 | A route file under `routes/portal` or `routes/quills` is thin: route options plus one page component from `@/quills/…`. |
| C2 | Each page, fetcher and hook has a co-located test. |
| C3 | No visible text literal in JSX, and no literal `aria-label`, `title`, `placeholder` or `alt` in Quills code. Text comes from `t()`. |
| C4 | Each `quills:` key in code exists in an `en-US` feature file, and each key in a feature file is used. |
| C5 | Imports follow 4.4. |
| C6 | Each pattern in `apps/api/src/quills/portal/paths.ts` has a web route, and each portal route is in the registry or marked internal. |
| C7 | Each fetcher uses the typed client and `errors.ts`. No raw `fetch`. |
| C8 | Each query key comes from `keys.ts` and holds the workspace and the viewer. |
| C9 | A page that acts on a token link uses `ConfirmAction` (5.4 rule 2). |

`apps/web/src/quills/conformance.test.ts` runs the same rules in process. So the existing
`pnpm --filter @kaneo/web test` job enforces them in CI, with no workflow change.

`scripts/quills-web/cli.test.mjs` (run with `node --test`) generates every kind into a temporary
folder and runs `check` on the result. It proves that the templates pass their own rules.

## 7. API changes

All are in fork-owned paths. Each follows `apps/api/AGENTS.md`.

| # | Change | Lane |
|---|---|---|
| A1 | `portal/paths.ts`, and every portal link built through it. The RSS feed uses `/status/incidents/{id}` (D17). | W0 |
| A2 | The unsubscribe link in the mail body points to the web page `/portal/{ws}/unsubscribe?token=…`. The one-click unsubscribe header (RFC 8058) does not change. | W0 |
| A3 | The four OAuth callbacks (`completeQuillsOAuthConnect`, `openQuillsOAuthBridge` after success, `completeQuillsOAuthFragmentConnect`, `completeQuillsConnectorOAuth`) answer a browser navigation with a 303 redirect to `/quills/oauth/result` (D16). The redirect carries only an outcome code and the provider or connector name, never a code, a token or provider text. The framework gets a declared `redirect` answer for signed GET routes, with contract checks and a self-test case. | W2 |
| A4 | A page that needs data that no route returns: the lane stops and reports. It does not add a route on its own. | any |

## 8. Pages

Paths are relative to `/portal/$workspaceId`. The public API prefix is `/quills-public/{workspace}`.

| Page | Path | Audience | Main operations | Lane |
|---|---|---|---|---|
| Unsubscribe | `/unsubscribe?token=` | public | `previewQuillsUnsubscribeToken`, `processQuillsUnsubscribeToken` | W0 (reference page) |
| Invite accept | `/invite/$inviteId#token=` | signed-in | `acceptQuillsPortalInvite` | W1 |
| CSAT rating | `/csat?token=&rating=` | public | `validateQuillsCsatEmailToken`, `recordQuillsCsatViaToken` | W1 |
| OAuth result | `/quills/oauth/result` (outside the portal) | teammate | none; it reads the redirect's outcome | W2 |
| Post | `/posts/$postId` | portal | `getQuillsPortalPost`, `listQuillsPortalPostComments`, `setQuillsPortalVote` | W3 |
| Conversation | `/conversations/$conversationId` | signed-in | `getQuillsMyConversation`, `listQuillsMyConversationMessages`, `sendQuillsMyConversationMessage`, `markQuillsMyConversationRead` | W3 |
| Status incident | `/status/incidents/$incidentId`, and `/status/$incidentId` as a redirect | public | `getQuillsPublicStatusIncident` | W3 |
| Changelog | `/changelog`, `/changelog/$entryId` | portal | `listQuillsPortalChangelog`, `getQuillsPortalChangelogEntry` | W4 |
| Status page | `/status` | public | `getQuillsPublicStatusPage`, `listQuillsPublicStatusHistory`, `getQuillsPublicStatusUptime` | W4 |
| Help center | `/hc`, `/hc/$locale`, category and article paths | public | `getQuillsPublicHelpCenter`, `getQuillsPublicHelpCenterCategory`, `getQuillsPublicHelpCenterArticle`, `searchQuillsPublicHelpCenter`, `resolveQuillsPublicHelpCenterRedirect` | W4 |
| Boards and posts | `/`, `/boards/$boardId` | portal | `listQuillsPortalBoards`, `listQuillsPortalPosts`, `listQuillsPortalStatuses` | W5 |
| Submit, vote, comment | sheets on the post list and post pages | signed-in | `createQuillsPortalPost`, `findQuillsPortalSimilarPosts`, `setQuillsPortalVote`, `createQuillsPortalComment`, own edit and delete | W5 |
| Profile and preferences | `/profile`, `/preferences` | signed-in | `getQuillsPublicUserProfile`, the subscription routes | W5 |
| Customer support | `/support`, `/support/tickets` | signed-in | `listQuillsMyConversations`, `startQuillsMyConversation`, `getQuillsMyTickets`, `createQuillsMyTicket` | W5 |

The help center category and article path shapes come from the help-center sitemap module
(`content/public/help-center/sitemap.ts`). W0 records them in `paths.ts`, so W4 implements exactly
the paths that the sitemap publishes.

## 9. Lanes

### 9.1 Order

```
W0 ──► W1  W2  W3  W4
              W3 ──► W5
         all ──► Z
```

W0 must merge first: every other lane uses its CLI, adapter, gate and test kit. W5 starts after W3,
because it reuses the post and conversation parts.

### 9.2 Lanes

| Lane | Scope | Notes |
|---|---|---|
| **W0 Foundation** | `quills/` skeleton (`api/errors.ts`, `keys.ts`, `ui/*`, `i18n/load.ts`, `test/*`, `portal/layout.tsx`), the CLI with all commands and templates, `boundaries.test.ts`, `conformance.test.ts`, `cli.test.mjs`, seam S2, A1, A2, the `seams.json` entries, and the **unsubscribe page as the reference page** built with the CLI. | The reference page proves the whole chain: generator, gate, states, token rule, i18n, tests. Later lanes copy its shape. |
| **W1 Mail actions** | Invite accept (with sign-in and sign-up return, token kept in the fragment), CSAT. | Proves rule 2 and rule 4 of 5.4. |
| **W2 OAuth return** | A3 in the API and framework, and the web result page. | The only lane that edits `apps/api/src/quills/framework/**`. |
| **W3 Mail-linked detail** | Post, conversation with reply, status incident with the legacy redirect. | Builds post and conversation parts that W5 reuses. |
| **W4 Public content** | Changelog, status page, help center. | Anonymous pages. Respects gated help-center content. |
| **W5 Full portal** | Boards and post list, submit, vote, comment, profile, preferences, customer support. | May split into W5a (feedback) and W5b (account and support) if the change is too large to review. |
| **Z Integration** | Merge in order, regenerate `routeTree.gen.ts` and `openapi.json`, run all checks, browser proof (9.5), docs. | No feature code. |

### 9.3 File ownership

| Path | Owner |
|---|---|
| `scripts/quills-web/**`, `quills/ui/**`, `quills/api/errors.ts`, `quills/api/keys.ts`, `quills/i18n/load.ts`, `quills/test/**`, `quills/portal/layout.tsx`, the two `*.test.ts` rule files | W0 only. A later lane that needs a change describes it in its report; Z applies it. |
| `quills/api/<area>/*`, `quills/hooks/<area>/*` | The lane that generates the operation. Two lanes never generate the same operation: the page table assigns each one. |
| `quills/portal/pages/<page>/**`, `routes/portal/…/<page>.tsx`, `quills/i18n/en-US/<feature>.json` | The page's lane |
| `apps/api/src/quills/framework/**` | W2 only |
| `apps/api/src/quills/portal/paths.ts` | W0. Later lanes report a needed path. |
| `apps/web/src/routeTree.gen.ts`, `apps/docs/openapi.json` | Z regenerates them. Lanes commit their own regenerated copy, so their branch builds. |

### 9.4 How the coordinator dispatches

Each lane is one subagent call:

| Setting | Value |
|---|---|
| Type | `frontend-developer` for web lanes, `backend-developer` for W2 |
| Model and effort | Opus, `xhigh` |
| Isolation | `worktree` |
| Branch | `feat/quills-130-<lane>`, from W0's branch (W0 from `origin/staging`) |
| Wave 1 | W1, W2, W3 and W4 in one message, so they run in parallel |

Every brief contains:

1. The goal, the lane's rows of sections 8 and 9.2, and its file ownership from 9.3.
2. The files to read first: this RFC, `AGENTS.md`, `apps/api/AGENTS.md` (API lanes),
   `scripts/quills-web/README.md`, the W0 reference page.
3. **Generate first:** every page, fetcher, hook and component starts from the CLI. Hand-written
   shapes fail the conformance check.
4. The upstream rules of section 4, word for word.
5. These lessons from RFC 0001:
   - Run `pnpm branding:check` before you finish; `vp check` does not cover it.
   - Run the secret scan the way CI does. Avoid `user:pass@` URLs and token-like literals in tests.
   - Use the CI database image (`pgvector/pgvector:0.8.7-pg16-bookworm`) with the role `postgres`.
     A role named `quills` changes `search_path` and breaks a schema test.
   - Keep helper scripts and logs in the lane's own git-ignored folder. Another lane once ran a
     script that it did not write.
   - A 5-second test timeout under machine load is a known flake. Rerun the file alone and report
     both results. Hide no other failure.
6. Verification commands:

   ```sh
   pnpm --filter @kaneo/web typecheck
   pnpm --filter @kaneo/web test
   pnpm --filter @kaneo/web build
   node scripts/quills-web/cli.mjs check
   pnpm exec vp check
   pnpm branding:test && pnpm branding:check
   node scripts/quills-port/check-upstream.mjs
   ```

   API lanes also run `pnpm --filter @kaneo/api typecheck`, `pnpm openapi:check:fix` and
   `pnpm --filter @kaneo/api test:quills` on their own disposable database.
7. The Feature Flow review team on the lane's diff, with an accessibility and a security lens for
   pages that handle tokens.
8. Local commits only. No push, no pull request, no merge.
9. The report format: commits, pages and operations built, verification results, every edit
   outside owned files, anything wrong in this RFC, the review verdict, and remaining risks.

### 9.5 Lane Z

1. Merge W0, then W2, W1, W3, W4 and W5. After each merge, regenerate `routeTree.gen.ts` and
   `openapi.json`, then run the verification commands.
2. Apply the shared-file changes that lanes reported.
3. Browser proof (D21), against a local stack with a seeded workspace:
   - Click each mail link type from a real mail render, signed out and signed in.
   - Complete the OAuth return for one provider with a local stub provider.
   - Check the bundled and the split-origin deployment for one page each.
   - Run axe on each page with the `axe-core` that `scripts/ui-review-bot` already installs.
4. Update #130's checklist text in the pull request description, not in the issue.

## 10. Testing

| Layer | What it proves | Where |
|---|---|---|
| Fetcher | The URL, method and body; the problem mapping for 401, 403, 404, 410 and 5xx | `quills/api/**.test.ts` |
| Hook | The query key holds workspace and viewer; a mutation invalidates the declared keys | `quills/hooks/**.test.tsx` |
| Page | Each problem state, the success state, and each action. Queries by role and label. | `pages/<page>/*.test.tsx` |
| Route | Search validation, the gate, and redirects (legacy status path, sign-in return) | route tests, generated |
| Conformance | Rules C1 to C9, and the boundary rule | `conformance.test.ts`, `boundaries.test.ts` |
| Generator | Every template passes its own rules | `scripts/quills-web/cli.test.mjs` |
| API | A1 to A3 through the contract suite on PostgreSQL | `apps/api/src/quills/**` |
| Browser | Real mail links, both deployments, axe | lane Z |

The typed client from `@kaneo/libs` makes a wrong path, method or body a type error. So
`typecheck` is part of the proof for every fetcher.

## 11. Risks

| Risk | Control |
|---|---|
| Upstream reshapes `components/ui`, auth routes or the router. | One adapter file (4.4), 2 seams (4.3), and `check-upstream.mjs`. |
| Upstream changes the sign-in redirect contract. | Seam S2 is tested. W1's tests cover sign-in and sign-up return. |
| The generator becomes a framework that nobody can change. | Plain templates, standard library only, one test that runs every template. A generated file is ordinary code after generation. |
| A token leaks through the address bar, the referrer or logs. | Rule 3 of 5.4, rule C9, and a security lens in the review. |
| A mail scanner triggers an action. | Rule 2 of 5.4 and rule C9. |
| A page leaks a private record through its error. | `noAccess` and `notFound` look the same to the viewer (5.3). The API already enforces visibility. |
| Search engines see empty pages. | Accepted for now (D19). |
| `routeTree.gen.ts` conflicts on every upstream sync. | Regenerate (S1). It is a known, mechanical resolution. |

## 12. Completion

This RFC is complete when:

1. Every mail link type that the API sends opens a working page, and C6 passes.
2. No link in mail or in an OAuth return shows raw JSON to a browser.
3. The full portal (section 8, W5 rows) works for public, private and signed-in visitors.
4. `check-upstream.mjs` prints `PASSED`, and the only upstream files changed are S1 and S2.
5. All verification commands pass, and lane Z's browser proof is recorded in the pull request.
