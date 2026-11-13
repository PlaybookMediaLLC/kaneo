# RFC 0002: Quills portal pages in `apps/web`

| Field | Value |
|---|---|
| Status | Accepted. The owner decided D16, D17, D20 and D21 on 2026-11-13. D18 and D19 apply as defaults until the owner changes them. Amended at the owner's request: section 6 defines one framework for pages, components, data calls and tests. Amended after an audit: decisions D22 to D24 and the audit items in sections 2 to 12. The owner has not confirmed D18 and D19 yet. |
| Issue | [#130](https://github.com/PlaybookMediaLLC/kaneo/issues/130) |
| Related | #129 (widget handoff decision), #132 (teammate pages, a later RFC) |
| Target | `apps/web`, plus small changes in `apps/api/src/quills`, `packages/email/src/quills` and `apps/docs/quills` |
| Executors | Subagents, model Opus, effort `xhigh`, one git worktree and one local branch each |
| Base branch | `staging` |

## 1. Summary

The API sends mail with links to `KANEO_CLIENT_URL/portal/{workspaceId}/…`. No such page exists in
`apps/web`. Two more links show raw JSON: the unsubscribe link and the OAuth return after a teammate
connects a provider. RFC 0001 added 13 more connectable providers, so the OAuth problem grew.

This RFC builds the portal pages in `apps/web`. It has three equal goals:

1. **Fix the broken links first.** Mail links, unsubscribe and the OAuth return.
2. **Cause no merge conflicts with upstream.** Upstream changes `apps/web` often (section 4.1).
   Quills code lives in fork-owned paths. It touches upstream files only at the registered seams
   of 4.3: two always, and at most two more.
3. **Build on one framework.** Every page, component, data call and test follows a written
   contract. A CLI creates each file from a template. A conformance check rejects code that breaks
   a contract. So the code stays uniform and easy to change as the product grows (section 6).

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

- Teammate pages (#132), except the OAuth result page. Decision D24 sets where they will live.
- The widget-to-portal handoff (#129). The portal works without it, because the handoff only adds a
  signed-in entry from the widget. If the owner decides #129 before W5 starts, W5 builds the portal
  side. If not, a later change adds it.
- Custom portal and help-center domains (decision D22).
- The workspace's custom CSS (`customCss`). It needs its own safety design first (5.5).
- Translations other than `en-US`. Other locales fall back to `en-US` (decision D18).
- Server rendering for search engines (decision D19).
- Any change to `packages/widget`.

## 3. Decisions

| # | Question | Decision |
|---|---|---|
| D16 | The OAuth callbacks answer JSON. Browsers need a page. | **Redirect browsers only.** A browser navigation (`Sec-Fetch-Mode: navigate`, or `Accept` that prefers `text/html`) gets a 303 redirect to the web result page. Any other client keeps the JSON answer, so API and MCP clients do not break. |
| D17 | Status mail links to `/status/incidents/{id}`; the RSS feed links to `/status/{id}`. | **Canonical `/status/incidents/{id}`.** The feed changes to it. The web route `/status/{id}` stays as a redirect, because readers already hold old feed items. |
| D18 | Portal text in 22 more locales? | **Default: `en-US` only now.** The `quills` namespace falls back to `en-US`. Translation is a later task. |
| D19 | The help center and changelog are client-rendered. A crawler that runs no JavaScript sees little. | **Default: accept for now.** The sitemap still lists the URLs. Prerender is a later RFC. |
| D20 | Sign-up and check-email drop the `redirect` search value. | **Patch it in the fork only (seam S2).** The seam is permanent and registered. No upstream pull request. |
| D21 | Browser tests in hosted CI, or local proof only? | **Local proof in lane Z.** A CI browser test needs seeded portal data in the disposable instance. Add it later as its own change. |
| D22 | The API lets a workspace set a portal domain and a help-center domain. No route maps a domain to a workspace, and mail links ignore the domain. | **Default: out of scope.** Every portal link in the web app comes from one `portalHref()` helper, and every API link comes from `paths.ts` (rule C21). A later RFC then adds domain support in these two places only. |
| D23 | TypeScript 7.0.2 has no JavaScript compiler API, so the rules cannot use it to read TSX. `oxc-parser` is installed only as a dependency of another package. | **Default: W0 tests oxlint first.** If the installed oxlint (through Vite+) runs custom JavaScript rules, the AST rules are oxlint rules in a fork-owned config. If not, W0 adds `oxc-parser` as a root dev dependency (seam S3). Text matching is allowed only for rules that read file names, imports or plain lines. |
| D24 | Where do the teammate pages of #132 live? | **Default: one fork-owned folder in the upstream workspace layout:** `routes/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/`. The pages get the upstream app shell with no upstream file edit. Their URLs start with `/dashboard/workspace/{id}/quills/`. RFC 0003 adds the folder to `forkOwned` and decides the navigation seam. |

## 4. Upstream safety

### 4.1 Measured upstream churn

Commits on `upstream/main` since 2026-08-01 that touch each path:

| Path | Commits | Rule for this RFC |
|---|---|---|
| `apps/web/src/components` | 382 | Import shared UI through one adapter (4.4). Only the owner-approved S2 redirect changes to the two auth components are allowed. |
| `apps/web/src/hooks` | 204 | Do not add files. |
| `i18n/en-US.json` | 171 | Do not add keys. Use the `quills` namespace (4.5). |
| `apps/web/src/routes` | 147 | Add files only under `routes/portal/` and `routes/quills/`, which upstream does not have. |
| `apps/web/src/fetchers` | 95 | Do not add files. |
| `apps/web/package.json` | 35 | Do not edit. Add no dependency. |
| `apps/web/src/routeTree.gen.ts` | 18 | Generated. Regenerate on conflict (seam S1). |
| `apps/web/src/routes/auth` | 15 | Seam S2 only. |

The two existing Quills modules in upstream folders (`fetchers/quills/`, `hooks/queries/quills/`)
stay where they are. New code does not join them. RFC 0003 moves them into the framework with a
migration (6.11).

### 4.2 Fork-owned paths

Lane W0 adds these to `forkOwned` in `scripts/quills-port/seams.json`:

```
apps/web/src/quills
apps/web/src/routes/portal
apps/web/src/routes/quills
scripts/quills-web
.github/workflows/quills-web.yml
apps/docs/quills
```

`node scripts/quills-port/check-upstream.mjs` then fails if upstream ever adds history in them.

### 4.3 The complete seam list

| # | File | Change | Conflict resolution |
|---|---|---|---|
| S1 | `apps/web/src/routeTree.gen.ts` | New portal and Quills routes appear in the generated tree. | Generated. Take either side, then regenerate with the router plugin (`pnpm --filter @kaneo/web build`). The same rule as `apps/docs/openapi.json`. |
| S2 | `apps/web/src/routes/auth/sign-up.tsx`, `apps/web/src/routes/auth/check-email.tsx`, `apps/web/src/routes/auth/sign-in.tsx`, `apps/web/src/components/auth/sign-in-footer-line.tsx`, `apps/web/src/components/auth/password-sign-up-form.tsx`, `apps/web/src/components/auth/auth-methods.ts` and its regression test, `apps/api/src/instance-settings/send-sign-up-verification-email.ts` and its regression test | Owner-approved expansion: accept and pass the safe `redirect` through sign-in, account creation, OTP and password email verification, including the create-account link and the verification callback URL. The mail sender preserves only a safe path through the configured web sign-in page. | Small and local: keep upstream's lines, then reapply the redirect propagation. Permanent fork seam (D20). W1's tests fail if a merge drops it. |
| S3 | Root `package.json` and `pnpm-lock.yaml` | Only if D23 needs `oxc-parser`: one line in `devDependencies`. | Keep upstream's lines, add the one line again, then run `pnpm install` to regenerate the lockfile. |
| S4 | `apps/docs/docs.json` | One navigation group for the portal docs in `apps/docs/quills/` (lane Z). | Keep upstream's file, then add the one group again. |

| S5 | `apps/web/index.html` | Install `no-referrer` before scripts and assets so initial mail-token navigation cannot leak through bootstrap requests. | Keep this meta policy before any resource load; the Stagehand browser regression checks the header behavior. |

For the portal implementation, no other upstream file changes. In particular: no edit to `__root.tsx`, `_layout.tsx`, the
navigation, `vite.config.ts`, `tsconfig`, `apps/web/package.json`, or `i18n/*.json`. The root
`package.json` and the lockfile change only through S3.
The later owner-requested migration of all browser tooling to Stagehand has a separate scope: browser tests, screenshot tools, workflows, locks, documentation, and the Vite CommonJS branding prebundle required by screenshot validation.

Portal routes are top-level siblings of `_layout`, as `public-project.$projectId.tsx` is, so they
need no layout change.

Except for the owner-approved S2 verification-mail seam above, all API and mail changes are under
`apps/api/src/quills` and `packages/email/src/quills`, which are fork-owned already.

### 4.4 One adapter for upstream code

Quills web code imports upstream modules only through one file:

```
apps/web/src/quills/ui/upstream.ts
```

It re-exports the upstream pieces that Quills uses: UI primitives from `@/components/ui/*`, the
toast, `HttpError`, `getSafeRedirectPath`, `authClient` (session and sign-out), and the `i18n`
instance. When upstream renames or moves
one of these, one file breaks, and the fix is one line.

Packages are allowed directly: `@kaneo/libs`, `@kaneo/branding`, `@tanstack/react-router`,
`@tanstack/react-query`, `react-i18next`, `zod`, `lucide-react`, `class-variance-authority`,
`react-hook-form` and `@hookform/resolvers`. All of them are in `apps/web/package.json` already.

A boundary test (`apps/web/src/quills/boundaries.test.ts`) fails on any other import of `@/…` from
`apps/web/src/quills/**` or `apps/web/src/routes/{portal,quills}/**`.

### 4.5 Translations without `en-US.json`

- Namespace `quills`. Keys look like `quills:invite.title`.
- One file for each feature: `apps/web/src/quills/i18n/en-US/<feature>.json`. The loader puts the
  content of each file under its feature name, so `invite.json` holds the `quills:invite.*` keys.
  Each lane owns its feature files, so lanes do not conflict with each other.
- The kit text (states, buttons, the page frame) is in `core.json`. W0 owns it.
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
  core/
    types.ts            PortalProblem, Viewer, Audience, PageMeta (6.7)
    portal-href.ts      portalHref: the one builder of portal links (D22)
    token-stash.ts      reads a link token, removes it from the address bar, keeps it (5.4)
    use-portal-sign-out.ts   sign-out that returns to the portal (5.4)
  api/
    client.ts           the typed client (re-export of @kaneo/libs `client`)
    errors.ts           toPortalProblem: a failed response → PortalProblem (5.3)
    keys.ts             quillsKey: the one query key factory
    <area>/<operation>.ts           types, key, fetcher and query options     (generated)
    <area>/<operation>.test.ts                                                (generated)
    <area>/<operation>.fixture.ts   typed test data for the operation         (generated)
    <area>/<name>.type.ts           a view type from a response type          (generated)
  hooks/
    <area>/use-<operation>.ts       one query or mutation hook                (generated)
    <area>/use-<operation>.test.tsx                                            (generated)
  i18n/
    load.ts
    en-US/core.json     the kit text
    en-US/<feature>.json
  ui/
    upstream.ts         the only door to upstream modules (4.4)
    page-frame.tsx      document title, the one h1, main landmark, focus, referrer policy
    portal-shell.tsx    workspace name, brand, sign-in state, footer
    portal-gate.tsx     portal off, private portal, sign-in, no access (5.3)
    state-view.tsx      one view for loading, empty, not found, gone and error
    confirm-action.tsx  a button-gated action for token links (5.4)
    result-card.tsx     the outcome of an action
    portal-form.tsx     the form frame: react-hook-form, zod, field errors (6.6)
    [<group>/]<name>.tsx            more shared components, with tests        (generated)
  portal/
    layout.tsx          the portal layout: shell + gate + i18n
  pages/
    <page>/meta.ts                  the page declaration (6.7)                (generated)
    <page>/<page>-page.tsx          the page component                        (generated)
    <page>/<page>-page.test.tsx                                                (generated)
    <page>/parts/<name>.tsx         page-local components, with tests         (generated)
  dev/
    kit-gallery.tsx     each kit component in each state; development builds only
  test/
    render.tsx          renderPage, renderComponent, renderQuillsHook
    mock-api.ts         mockApi: a strict, typed fetch stub
    contracts.tsx       describeOperationContract, describeHookContract, describePageContract,
                        describeFormContract
    actions.ts          press, fill, expectProblem
  boundaries.test.ts
  conformance.test.ts

apps/web/src/routes/portal/$workspaceId.tsx                  the portal layout route
apps/web/src/routes/portal/$workspaceId/<…>.tsx              thin route files (generated)
apps/web/src/routes/quills/oauth.result.tsx                  thin route file (generated)
apps/web/src/routes/quills/kit.tsx                           the kit gallery (development only)
```

A route file is thin. It declares the path, validates the search values with `zod`, prefetches with
`queryClient.prefetchQuery` and the operation's query options, and renders one page component from
`@/quills/…`. All logic lives in
`apps/web/src/quills`, which upstream never touches.

### 5.2 One source of truth for portal paths

Today the API builds web links in four files and five places: `jobs/fanout.ts`,
`jobs/handlers/status-mail.ts`, `jobs/handlers/support-mail.ts` (two links) and
`portal/feedback/feeds.ts`. Two of them disagree (D17). One link in `support-mail.ts` goes to a
teammate page, `/dashboard/workspace/{id}/support/conversations/{id}`, which does not exist either.

Lane WA adds `apps/api/src/quills/portal/paths.ts`. It is a pure module with no imports. It exports
one function for each web page that the API links to, for example
`portalPaths.post(workspaceId, postId)`, and the list of path patterns. Every API caller uses it. A
teammate entry has `pending: 132`. `check` does not require its page yet, and `list` prints it as an
open link. RFC 0003 moves that link into the D24 folder.

The web conformance check imports the same file and compares its patterns with the route tree. A
mail link without a web page, or a portal page that mail cannot reach by a known path, fails the
check.

### 5.3 Portal problems

`api/errors.ts` maps every failed call to one `PortalProblem`:

| Problem | Cause | What the page shows |
|---|---|---|
| `off` | The workspace has no portal (`getQuillsPublicPortalConfig`) | A clear "this portal is not available" state, with no data |
| `signIn` | Private portal, no session | A sign-in prompt that returns to the same page (`/auth/sign-in?redirect=…`) |
| `noAccess` | Private portal, signed in, no access to the portal (`evaluateQuillsMyPortalAccess`) | A 403 state for the whole portal. It shows no record. |
| `notFound` | 404, or a 403 for one record | A 404 state. A record that the viewer may not see looks the same as a missing record. |
| `gone` | An expired or used token | A "this link expired" state with a next step |
| `invalid` | 400 with `code: "VALIDATION_ERROR"` | The form shows each issue next to its field (6.6). |
| `rateLimited` | 429 (60 public operations document it) | A "try again later" state. The retry button stays disabled until the `Retry-After` time ends. |
| `failed` | Network or 5xx | A retry button |

`PortalGate` resolves `off`, `signIn` and `noAccess` once in the layout route. A page handles only
`notFound`, `gone`, `rateLimited` and `failed` through `StateView`, and `invalid` through
`PortalForm`. Every page therefore shows the same states in
the same way.

### 5.4 Rules every page follows

1. **Results first.** The page leads with the outcome or the content. Complex controls open in a
   sheet.
2. **No action on page load.** Mail scanners open links. A CSAT rating, an unsubscribe and an
   invite accept happen only after a click on `ConfirmAction`.
3. **Tokens stay out of logs.** The invite token comes in the URL fragment, as the API designed it.
   CSAT and unsubscribe tokens come in the query. On load, `token-stash.ts` reads the token,
   removes it from the address bar with a router `replace` navigation, and keeps it in memory. The
   page sets `<meta name="referrer" content="no-referrer">`. A token never goes into a `redirect`
   value, so it never reaches a query string, a server log or an error report.
4. **Sign-in returns to the portal.** A portal customer has a Kaneo account and no workspace
   (decision D1). Sign-in and sign-up always carry `redirect` back to the portal page, so the
   person never lands in workspace onboarding. The `redirect` holds the path only. When a token
   page needs sign-in, the stash keeps the token in `localStorage` for at most 30 minutes, under a
   key with the workspace and the record ID. Sign-up can verify the email in a new tab, so
   `sessionStorage` is not sufficient. The stash removes the token after use, at expiry and at
   sign-out. A missing token shows `gone` with the next step: open the mail link again.
5. **Caches are scoped.** Each query key starts with `quills` and holds the workspace ID and the
   viewer (anonymous, or the session user ID). Upstream sign-out removes all queries except
   `config` and `instance-status` already, but it goes to `/auth/sign-in`. The portal uses
   `usePortalSignOut` instead. It removes the same queries and the token stash, then returns to the
   portal home.
6. **Both deployments work.** Bundled same-origin and separately hosted API and web. All calls go
   through the typed client with `credentials: "include"`. All links come from `KANEO_CLIENT_URL`.
7. **Accessible.** Landmarks, one `h1`, labelled controls, focus moves to the `h1` on navigation.
   Tests query by role and label, so an unlabelled control fails its test.
8. **Branded text.** All text is in the `quills` namespace. `pnpm branding:check` must report no
   findings.
9. **No action inside a frame.** The web app sends no `frame-ancestors` header, so another site can
   show a portal page in a frame and trick a visitor into a click. `ConfirmAction` and
   `PortalForm` refuse to act when the page is in a frame, and say why. The deployment docs (lane
   Z) give the header for each deployment.
10. **Phones first.** Many people open mail links on a phone. Each page works at a width of 375
    pixels with no sideways scroll. Lane Z checks each page at that width.

Section 6.7 makes these rules part of the page contract. `check` tests each rule that a machine can
test.

### 5.5 Portal branding

Today `getQuillsPublicPortalConfig` returns only `name`, `features` and `portalAccess`. The
workspace's branding settings (`brandingConfig`, `headerDisplayMode`, `headerDisplayName`) have no
public route. API change A5 adds the safe fields to the public config. `PortalShell` then applies
them:

- The logo and the colors. The colors become CSS variables on the portal container only, so they
  never change the teammate app.
- The header display mode and name.
- `customCss` is not applied in this RFC. Custom CSS can load outside resources and track visitors.
  It needs a safety design first: a `style-src` policy, and no `url()` or `@import`. The admin docs
  say that the portal does not use it yet.

Without branding, the portal uses the Kaneo theme. Lane Z runs axe on a workspace with branding
colors, so a color pair with low contrast fails the proof.

## 6. The framework

### 6.1 Purpose

All Quills web code follows one framework. The framework has 4 parts:

1. **Contracts.** A written shape for each kind of file (6.3 to 6.8).
2. **A runtime kit.** The shared code that pages and tests use: `quills/core`, `quills/ui` and
   `quills/test`.
3. **A CLI.** It creates each file from a template, so new code starts in the correct shape (6.9).
4. **A conformance check.** It finds code that breaks a contract, also code that someone wrote by
   hand (6.10). CI runs it on each pull request.

With the framework, a new feature is a sequence of CLI commands, then the code that is special to
the feature. A reviewer reads only the part that differs.

### 6.2 Principles

1. **One way to do each thing.** There is one pattern for a data call, a hook, a component, a page
   and a test. A second pattern is a framework change (6.11), not a local choice.
2. **Generate, then fill in.** The CLI writes the full shape with `TODO(quills-web)` markers. The
   author replaces each marker. `check` fails while a marker remains.
3. **Machines check the contracts.** Each contract names the rules that test it. A rule that no
   machine can test is a review note, not a contract.
4. **No shared registry file.** Each operation keeps its types, query key and fixture in its own
   files. Two lanes that add different operations never edit the same file.
5. **No barrel file and no default export.** Code imports each module by its path and its name.
6. **Fork-owned only.** The framework lives in the paths of 4.2. An upstream change can break it
   only through the adapter (4.4).
7. **No new dependency.** The kit uses the installed packages. The CLI uses the Node standard
   library, plus the parser of D23 for the rules.

### 6.3 Kinds

The framework knows 11 kinds of file. One CLI command creates each kind, with its test.

| Kind | Files | Command | Contract |
|---|---|---|---|
| Feature | `quills/i18n/en-US/<feature>.json` | `feature` | 4.5 |
| Operation | `quills/api/<area>/<operation>.ts` and its test | `query`, `mutation` | 6.5 |
| Fixture | `quills/api/<area>/<operation>.fixture.ts` | `query`, `mutation` | 6.8 |
| Type | `quills/api/<area>/<name>.type.ts` | `type` | 6.5 |
| Hook | `quills/hooks/<area>/use-<operation>.ts` and its test | `query`, `mutation` | 6.5 |
| Component | `quills/ui/[<group>/]<name>.tsx` and its test | `component` | 6.6 |
| Part | `quills/pages/<page>/parts/<name>.tsx` and its test | `part` | 6.6 |
| Form | `quills/pages/<page>/parts/<name>-form.tsx` and its test | `form` | 6.6 |
| Page | `quills/pages/<page>/meta.ts`, `<page>-page.tsx` and its test | `page` | 6.7 |
| Route | `routes/portal/$workspaceId/<…>.tsx` or `routes/quills/<…>.tsx` | `page` | 6.7 |
| Redirect | A route that only redirects, and its test | `redirect` | 6.7 |

### 6.4 Names

The CLI makes every name from one input. The author does not choose names. Rule C10 rejects a name
that does not follow this table.

| Input | Names that the CLI makes |
|---|---|
| Operation ID `previewQuillsUnsubscribeToken` | The CLI removes `Quills` from the ID: `previewUnsubscribeToken`. File `preview-unsubscribe-token.ts`. Fetcher `previewUnsubscribeToken`. Types `PreviewUnsubscribeTokenRequest` and `PreviewUnsubscribeTokenResponse`. Key builder `previewUnsubscribeTokenKey`. Query options `previewUnsubscribeTokenQuery`. Fixture `previewUnsubscribeTokenFixture`. Hook `usePreviewUnsubscribeToken` in `use-preview-unsubscribe-token.ts`. |
| Page `unsubscribe` | Folder `quills/pages/unsubscribe/`. Component `UnsubscribePage` in `unsubscribe-page.tsx`. Declaration `meta` in `meta.ts`. |
| Component `ResultCard` | File `result-card.tsx`. Props type `ResultCardProps`. Test `result-card.test.tsx`. |

A name that exists already is an error. The CLI does not make a second name.

### 6.5 Operations, hooks and types

**The operation file.** One file holds one API operation, in this order:

1. The endpoint from the typed client. The CLI reads the method and path from
   `apps/docs/openapi.json`, for example `client["quills-public"][":workspace"].unsubscribe.$get`.
2. The request and response types: `InferRequestType` and `InferResponseType` from `hono/client`,
   as upstream fetchers do already. Nobody writes an API type by hand.
3. The key builder. It calls `quillsKey(workspaceId, viewer, area, operation, input)` from
   `api/keys.ts`. The key always holds the workspace and the viewer (5.4 rule 5).
4. The fetcher. It calls the endpoint and gives a failed response to `toPortalProblem` from
   `api/errors.ts`. The CLI writes the status map from the documented responses. For a token
   operation (an input named `token`), it maps 404 and 410 to `gone`.
5. The query options, for a read operation only: `queryOptions()` from TanStack Query, with the key
   builder and the fetcher. The hook and the route prefetch both use them.

**The hook file.** A query hook calls `useQuery` with the query options. It does not run while a
required input is empty. A mutation hook calls `useMutation`. On success only, it invalidates the
keys of the operations in `--invalidates`. Pages use hooks. A page never calls `useQuery`,
`useMutation` or a fetcher directly.

Three CLI options add the patterns that lists, votes and conversations need:

| Option | Hook pattern | Used by |
|---|---|---|
| `query --paged` | `useInfiniteQuery` with the page cursor that the operation documents. The page shows a "load more" button, not endless scroll, so keyboard users can reach the footer. | Post list, changelog, comments |
| `query --poll <seconds>` | `refetchInterval`, only while the tab is visible. The API has no live updates for customers, so the page polls. The CLI refuses an interval under 10 seconds. | Conversation |
| `mutation --optimistic <operationId>` | Changes the cached data at once, and restores it on failure. | Vote |

**The type file.** A view type that a component needs comes from a response type, for example
`export type PostSummary = ListPortalPostsResponse["items"][number]`. The `type` command writes it.
When the API changes, `typecheck` finds each component that the change breaks.

### 6.6 Components and parts

A **component** is shared. It lives in `quills/ui/`, in a group folder when several components
belong together (`quills/ui/post/`). A **part** belongs to one page. It lives in
`quills/pages/<page>/parts/`.

Both follow these rules:

1. One component in each file. A named export. The file also exports `<Name>Props`.
2. Text comes from `t()` in the `quills` namespace. Kit components use the `core` keys.
3. Style uses the upstream primitives through the adapter, and Tailwind classes with theme tokens.
   No inline `style`, no color literal, no new CSS file. Variants use `class-variance-authority`,
   which is installed.
4. Each interactive element has a role and an accessible name. An icon-only button gets its name
   from `t()`. A decorative icon has `aria-hidden`.
5. At most 200 lines. A larger file splits into parts or pure helpers.

Two more rules:

- A component in `quills/ui/` shows data. It gets the data and the callbacks through props. It
  imports no hook, no fetcher, no client and no router. So each page can use it, and its test needs
  no API mock.
- A part can use hooks. Only files in its own page folder import it. When a second page needs a
  part, the part moves to `quills/ui/` and its hooks move to the pages.

**Forms.** A form is a part that the `form` command makes. It uses `PortalForm` from the kit, with
`react-hook-form` and `@hookform/resolvers`, which upstream uses already:

1. The CLI writes the `zod` schema from the request body schema in `openapi.json`. The author adds
   only the rules that the API does not have.
2. Each field has a label from `t()` and shows its own error.
3. An `invalid` problem from the API puts each issue next to its field, by the issue path.
4. The submit button is disabled while the request runs, so a person cannot send twice.
5. A long form opens in a `Sheet` (5.4 rule 1).

**The kit gallery.** The route `/quills/kit` shows each kit component in each state. It renders only
in development builds. W0 builds it. Each new kit component adds itself to the gallery (C23). A
reviewer uses it to compare components side by side.

### 6.7 Pages, routes and redirects

A page is a folder with a declaration, a component and a test:

```
quills/pages/unsubscribe/
  meta.ts
  unsubscribe-page.tsx
  unsubscribe-page.test.tsx
  parts/
routes/portal/$workspaceId/unsubscribe.tsx
```

**The declaration.** `meta.ts` is plain data. The contract test, `check` and `list` read it.

```ts
import type { PageMeta } from "@/quills/core/types";

export const meta = {
  id: "unsubscribe",
  feature: "unsubscribe",
  route: "/portal/$workspaceId/unsubscribe",
  audience: "public", // public | portal | signed-in | teammate
  mailLinked: true, // the route must match a pattern in apps/api/src/quills/portal/paths.ts
  token: "query", // none | query | fragment
  operations: ["previewQuillsUnsubscribeToken", "processQuillsUnsubscribeToken"],
  states: ["loading", "gone", "failed", "ready", "done"],
} satisfies PageMeta;
```

**The page component.** Every page has the same anatomy:

1. Props: only `workspaceId`, `params` and `search` from the route, with types.
2. The root element is `PageFrame`. It sets the document title, renders the one `h1` and the `main`
   landmark, and moves focus to the `h1`. For a token page, it sets the `no-referrer` policy and
   removes the token from the address bar (5.4 rule 3).
3. Data comes from generated hooks only. Each query result goes through `StateView`. `StateView`
   shows loading, empty, `notFound`, `gone` and `failed` in the same way on every page.
4. A write is a `ConfirmAction` or a `PortalForm` (6.6). `ResultCard` shows the outcome.
5. Logic that needs its own test goes into a pure helper in the page folder, with a test beside it.
6. The page arranges parts. Parts hold the detail. At most 200 lines.

**The route file.** The CLI writes it. The author changes only the search schema. The file declares
the path, validates `search` with `zod`, prefetches with `queryClient.prefetchQuery` and the query
options, and renders the page component. Nothing else (C1).

**The loading order.** The portal layout route resolves the portal config and the viewer's access
in `beforeLoad`, and puts the result in the route context. A child route prefetches only when the
portal is open to the viewer. `prefetchQuery` never throws, so a failed prefetch reaches the page
as a problem in `StateView`, not as a router error.

**The redirect.** `redirect <from> <to>` writes a route that only redirects, with a test. The old
status path `/status/$incidentId` uses it (D17).

### 6.8 Tests

All Quills tests use one kit, `quills/test/`, and one file shape. A reader who knows one test file
knows them all.

**The kit**

| Export | Use |
|---|---|
| `mockApi()` | Stubs `fetch` for one test, and removes the stub when the test ends. It is strict: a request with no prepared reply fails the test and names the method and path. `api.reply(fixture.ok())` prepares a reply. `api.calls(operationId)` returns the sent requests. |
| `renderPage(Page, meta, options)` | Renders a page with a new query client, a memory router at the route of `meta`, the `quills` bundle, and a viewer (anonymous or signed in). `authClient.useSession` asks the API for the session, so `mockApi` answers that request for the viewer. |
| `renderComponent(element)` | Renders a component with i18n and a new query client. |
| `renderQuillsHook(hook, options)` | Renders a hook with the same providers. |
| `describeOperationContract(…)` | Writes the standard cases for an operation. |
| `describeHookContract(…)` | Writes the standard cases for a hook. |
| `describePageContract(meta, setup)` | Writes the standard cases for a page from its declaration. |
| `describeFormContract(…)` | Writes the standard cases for a form. |
| `press(name)`, `fill(label, value)` | Find a control by role and name, then act with `fireEvent`. The web package has no `user-event`, and the kit adds none. |
| `expectProblem(problem)` | Asserts the `StateView` of a problem by role and name. |

The client from `@kaneo/libs` calls the global `fetch` for each request. So `mockApi` needs no
change to the client.

**Fixtures.** Each operation has a fixture file. `fixture.ok(overrides)` returns a response body
that `satisfies` the response type. `fixture.problem(status)` returns a documented error. The CLI
makes the values from the OpenAPI schema. The values are fixed and fake:

- IDs like `post_test_1`. Dates like `2026-01-01T00:00:00.000Z`. An enum takes its first value.
- Email addresses use the `example.test` domain.
- No `Date.now()`, no `Math.random()`, and no token-like or `user:pass@` literal (RFC 0001 lesson).

**The file shape.** Every test file has this shape:

```ts
describe("UnsubscribePage", () => {
  describePageContract(meta, setup); // the generated standard cases

  describe("behavior", () => {
    it("shows the list name before the person confirms", async () => {
      // arrange

      // act

      // assert
    });
  });
});
```

- Test names use the present tense and start with a verb: "shows", "sends", "asks", "keeps".
- Each test makes its own data with fixtures. Tests share no state.
- Queries use role and label. Tests do not use `getByTestId`.

**Standard cases.** The contract functions write these cases. Each case fails when the code that it
tests is missing.

| Kind | Standard cases |
|---|---|
| Operation | Sends the method and path from `openapi.json`. Sends the input. Returns the typed body. Maps each documented error status to its problem. Maps a network failure to `failed`. |
| Query hook | The key holds the workspace and the viewer. The hook does not run while a required input is empty. A failure gives the problem. |
| Paged query hook | Loads the next page with the cursor. Stops when the API reports no more pages. |
| Polling query hook | Polls at the declared interval while the tab is visible. Stops while it is hidden. |
| Mutation hook | Success invalidates each declared key. Failure invalidates nothing and gives the problem. |
| Optimistic mutation hook | Changes the cache at once. Restores it on failure. |
| Form | Shows each schema error at its field. Puts each API issue next to its field. Disables submit while the request runs. Refuses to submit inside a frame. |
| Page | One case for each state in `meta.states`. Focus is on the `h1`, and the document title is set. A `signed-in` page asks a signed-out visitor to sign in, with a `redirect` back to the same page. A token page sends no write request on load, removes the token from the address bar, sets the `no-referrer` policy, and keeps the token out of the `redirect`. An action refuses to run inside a frame. |
| Redirect | The old path goes to the new path and keeps the parameters. |

Components have no contract function. Their template has three cases to fill in: the role and name,
each variant, and each callback.

**Not allowed in Quills tests (C15):** a raw `render` from Testing Library, `vi.mock` of a Quills
module (use `mockApi`), snapshot assertions, a wait with `setTimeout` (use `findBy…` or `waitFor`),
`.only` and `.skip`, and a request to a real host.

### 6.9 The CLI

**Form**

```
node scripts/quills-web/cli.mjs <command> [arguments] [--dry-run] [--json]
```

- `--dry-run` prints the files that the command would write, and writes nothing.
- `--json` prints the result as JSON, for agents and scripts.
- `help <command>` prints the arguments and an example.

**Commands**

| Command | Writes or does |
|---|---|
| `feature <name>` | The i18n feature file. |
| `query <operationId> --area <area> [--paged] [--poll <seconds>]` | The operation file with its query options, its test, its fixture, the query hook and its test. An unknown operation ID is an error. |
| `mutation <operationId> --area <area> --invalidates <operationId,…> [--optimistic <operationId>]` | The same, with a mutation hook. |
| `type <area>/<Name> --from <operationId> [--at <path>]` | A view type from the response type. `--at items[]` selects a part of the response. |
| `page <name> --route <path> --audience <audience> --feature <feature> --operations <operationId,…> [--search <name:type,…>] [--token none\|query\|fragment] [--mail-linked]` | The declaration, the page, its test, the route file, and the title and state keys in the feature file. With `--mail-linked`, the route must match a pattern in `paths.ts`. Each operation must have a hook already. |
| `part <page>/<Name>` | A part and its test. |
| `form <page>/<Name> --operation <operationId>` | A form part, its `zod` schema from the request body, and its test. |
| `component [<group>/]<Name> [--variants <a,b>]` | A shared component and its test. |
| `redirect <from> <to>` | A route that only redirects, and its test. |
| `test <file>` | The missing test for an existing file of a known kind. |
| `check [--rule C<n>]` | Runs the conformance rules (6.10). Each finding names the rule, the file and line, and the fix. |
| `list [--kind <kind>] [--exceptions]` | Prints each page with its route, audience and operations. Also prints each operation, component, feature and rule exception. |
| `migrate [--list]` | Runs the framework migrations (6.11). |
| `doctor` | Checks the Node version, that `openapi.json` has each operation in use, and that the route tree is current. Then runs `check`. |
| `verify [--api]` | Runs the verification list of 9.4 in order. Prints one result line for each step. |
| `seed [--reset]` | Fills the local database with fake data: a workspace with the portal on, boards, posts, an incident, a changelog entry and help-center articles. It runs `pnpm --filter @kaneo/api exec tsx src/quills/dev/seed-portal.ts` (A6). It refuses a database host other than `localhost` or `127.0.0.1`. |

**Behavior**

1. The CLI writes only in the fork-owned paths of 4.2. It refuses any other path.
2. It never overwrites a file. Its only edit adds keys to an i18n feature file, in sorted order.
3. The output is deterministic: the same input gives the same files. The self-test compares the
   output with golden files.
4. Generated files pass `pnpm exec vp check` with no change.
5. After it writes, it prints each file, each `TODO(quills-web)` marker to fill in, and the next
   command to run.
6. Exit code 0 is success. Exit code 1 is a finding or a refused write. Exit code 2 is a usage error.
7. It uses the Node standard library, plus the parser of D23. It is not a `package.json` script, so
   it adds no seam.

**Layout**

```
scripts/quills-web/
  cli.mjs                    argument parsing (node:util parseArgs) and dispatch
  commands/<command>.mjs     one file for each command, with a test beside it
  lib/naming.mjs             the names of 6.4
  lib/openapi.mjs            reads apps/docs/openapi.json
  lib/rules/<rule>.mjs       one file for each conformance rule
  templates/<kind>/…         plain text templates
  migrations/<NNNN>-<name>.mjs
  test/golden/…              the expected output of each command
  README.md                  the golden path, each command and each rule
```

### 6.10 Conformance rules

`check` runs these rules. `conformance.test.ts` imports the same rule modules from
`scripts/quills-web/lib/rules/`. So the CLI and the test cannot disagree. The rules read code with
the parser of D23.

| # | Kind | Rule |
|---|---|---|
| C1 | Route | A route file is thin: route options plus one page component from `@/quills/…`. |
| C2 | All | Each operation, hook, component, part, page, route and helper has a test beside it. |
| C3 | i18n | No visible text literal in JSX. No literal `aria-label`, `title`, `placeholder` or `alt`. |
| C4 | i18n | Each `quills:` key in code exists in a feature file. Each key in a feature file is used. |
| C5 | Boundary | Imports follow 4.4. Only files in its own page folder import a part. |
| C6 | Page | Each pattern in `apps/api/src/quills/portal/paths.ts` has a page with `mailLinked: true`, and each such page matches a pattern. Each `meta.route` matches its route file. |
| C7 | Operation | A fetcher uses the typed client and `toPortalProblem`. No raw `fetch`. |
| C8 | Hook | Each query key comes from a key builder that uses `quillsKey`. |
| C9 | Page | A page with a `token` other than `none` writes only through `ConfirmAction`. |
| C10 | All | Names follow 6.4. |
| C11 | Operation | Each operation ID in code or in a declaration exists in `openapi.json`. The page or its parts use each operation in its declaration. |
| C12 | All | No `TODO(quills-web)` marker remains. |
| C13 | Component | One component in each file, a named export, and an exported `<Name>Props`. A file in `quills/ui/` imports no hook, fetcher, client or router. |
| C14 | Page | The root is `PageFrame`. Query results go through `StateView`. No direct `useQuery`, `useMutation` or fetcher call. |
| C15 | Test | The test uses the kit and the contract function of its kind. It uses nothing from the list in 6.8. |
| C16 | Fixture | The body `satisfies` the response type. Fixed values only. Email at `example.test`. No token-like literal. |
| C17 | All | No barrel file. No default export. |
| C18 | Component, part, page | At most 200 lines. |
| C19 | Style | No inline `style`, no color literal, no new CSS file. |
| C20 | Page | Each page has a declaration. Its `states` include `loading` and `failed` when the page has a query, and `gone` when the page has a token. |
| C21 | Links | No portal path literal outside `portal-href.ts` and `paths.ts`. Each link comes from `portalHref()` or `portalPaths` (D22). |
| C22 | Form | Each form uses `PortalForm`. No `useForm` and no `<form>` element outside it. |
| C23 | Component | Each kit component in `quills/ui/` appears in the kit gallery. |

**Exceptions.** A real edge case can skip one rule on one line with a comment:
`// quills-web-allow C18: <reason>`. `check` rejects an exception without a reason. `list
--exceptions` prints all exceptions, and each lane report repeats them. Rules C5, C7, C9 and C16
protect the boundary, tokens and secrets. They allow no exception.

### 6.11 How the framework changes

The contracts will change as the product grows. Each change goes in one pull request, with these
steps:

1. Change the template.
2. Change the rule, or add a rule.
3. Add a migration in `scripts/quills-web/migrations/`. When the change is mechanical, the
   migration edits the existing files. When it is not, the migration prints the files that need a
   manual edit.
4. Run `migrate`, then `check`. Both must pass.
5. Update the golden files and the README.

A migration is idempotent: a second run changes nothing. Generated files have no version header.
`check` is the gate, so code in an old shape cannot stay in the repository.

During this RFC, W0 owns the framework. A lane that needs a change reports it. Z applies it with
these steps.

### 6.12 Where the framework runs

- `pnpm --filter @kaneo/web test` runs `conformance.test.ts` and `boundaries.test.ts`. The existing
  CI job runs them, with no workflow change.
- A new fork-owned workflow, `.github/workflows/quills-web.yml`, runs on pull requests that touch
  the paths of 4.2, `apps/api/src/quills/portal/paths.ts` or `apps/docs/openapi.json`. It runs
  `node --test "scripts/quills-web/**/*.test.mjs"` and `node scripts/quills-web/cli.mjs check`. It
  pins the same action versions as `quills-database.yml`.
- The CLI self-test generates each kind into a temporary folder. It runs every rule on the result,
  compares the output with the golden files, and runs each migration two times. It also tests a
  broken page in the golden files, to prove that each contract case fails when its code is missing.
- The rules do not prove that generated code compiles. So the `quills-web.yml` workflow also
  generates one file of each kind into a temporary git worktree, then runs the web typecheck and the
  generated tests there.

### 6.13 The golden path

This example adds the CSAT page (lane W1). Each new page uses the same steps.

```sh
node scripts/quills-web/cli.mjs feature csat
node scripts/quills-web/cli.mjs query validateQuillsCsatEmailToken --area support
node scripts/quills-web/cli.mjs mutation recordQuillsCsatViaToken --area support \
  --invalidates validateQuillsCsatEmailToken
node scripts/quills-web/cli.mjs page csat --route '/portal/$workspaceId/csat' \
  --audience public --feature csat --token query --mail-linked \
  --search token:string,rating:number \
  --operations validateQuillsCsatEmailToken,recordQuillsCsatViaToken
node scripts/quills-web/cli.mjs part csat/RatingScale
```

Then:

1. Replace each `TODO(quills-web)` marker that the CLI printed.
2. Add the page's own cases under `describe("behavior")`.
3. Run `node scripts/quills-web/cli.mjs verify`.

## 7. API changes

All are in fork-owned paths. Each follows `apps/api/AGENTS.md`.

| # | Change | Lane |
|---|---|---|
| A1 | `portal/paths.ts`, and every web link built through it, with the teammate link as a `pending: 132` entry (5.2). The RSS feed uses `/status/incidents/{id}` (D17). | WA |
| A2 | The unsubscribe link in the mail body points to the web page `/portal/{ws}/unsubscribe?token=…`. The one-click unsubscribe header (RFC 8058) does not change. | WA |
| A3 | The four OAuth callbacks (`completeQuillsOAuthConnect`, `openQuillsOAuthBridge` after success, `completeQuillsOAuthFragmentConnect`, `completeQuillsConnectorOAuth`) answer a browser navigation with a 303 redirect to `/quills/oauth/result` (D16). The redirect carries only an outcome code and the provider or connector name, never a code, a token or provider text. The framework gets a declared `redirect` answer for signed GET routes, with contract checks and a self-test case. | W2 |
| A4 | A page that needs data that no route returns: the lane stops and reports. It does not add a route on its own. | any |
| A5 | `getQuillsPublicPortalConfig` also returns the public branding: the logo URL, the colors, and the header display mode and name. It never returns `customCss` (5.5). | WA |
| A6 | `apps/api/src/quills/dev/seed-portal.ts`: fake local data for `cli.mjs seed`. It refuses a database host other than `localhost` or `127.0.0.1`, and a production `NODE_ENV`. Its test proves both refusals. | WA |

## 8. Pages

Paths are relative to `/portal/$workspaceId`. The public API prefix is `/quills-public/{workspace}`.

| Page | Path | Audience | Main operations | Lane |
|---|---|---|---|---|
| Unsubscribe | `/unsubscribe?token=` | public | `previewQuillsUnsubscribeToken`, `processQuillsUnsubscribeToken` | W0r (reference page) |
| Invite accept | `/invite/$inviteId#token=` | signed-in | `acceptQuillsPortalInvite` | W1 |
| CSAT rating | `/csat?token=&rating=` | public | `validateQuillsCsatEmailToken`, `recordQuillsCsatViaToken` | W1 |
| OAuth result | `/quills/oauth/result` (outside the portal) | teammate | none; it reads the redirect's outcome | W2 |
| Kit gallery | `/quills/kit` (development builds only) | development | none | W0 |
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
(`content/public/help-center/sitemap.ts`). WA records them in `paths.ts`, so W4 implements exactly
the paths that the sitemap publishes.

## 9. Lanes

### 9.1 Order

```
W0 (framework) ──┐
WA (API, seed) ──┴──► W0r (reference page, S2, branding) ──► W1  W2  W3  W4
                                                                     W3 ──► W5
                                                                all ──► Z
```

1. W0 builds the framework. WA runs at the same time, because it touches only the API.
2. The coordinator merges WA into W0's branch. W0r starts from that branch.
3. W0r builds the reference page with the CLI and the README only. This proves that the framework
   works for an agent that did not build it. W0r also connects the A5 branding to the portal
   layout.
4. W5 starts after W3, because it reuses the post and conversation components.

### 9.2 Lanes

| Lane | Scope | Notes |
|---|---|---|
| **W0 Framework** | First, the parser test of D23. Then `quills/core` (with `portal-href.ts`, `token-stash.ts`, `use-portal-sign-out.ts`), `api/client.ts`, `api/errors.ts`, `api/keys.ts`, the kit components in `quills/ui` (with `PortalForm`), the kit gallery, `i18n/load.ts` and `core.json`, `quills/test`, `portal/layout.tsx`. The CLI with every command, template, option and rule, the migration runner and the golden files. `boundaries.test.ts`, `conformance.test.ts`, `.github/workflows/quills-web.yml`, `scripts/quills-web/README.md`, and the `seams.json` entries. | No feature page. The CLI self-test proves the framework (6.12). |
| **W0r Reference page** | The **unsubscribe page**, built only with the CLI and the README (6.13). Seam S2. The A5 branding in the portal layout. | A different agent from W0. It reads the README, not the framework source. It reports each place where the README or a command was not sufficient. The coordinator sends the report to the W0 agent, which fixes each gap before wave 1. Later lanes copy the shape of this page. |
| **WA API links** | A1, A2, A5 and A6, and the help-center path shapes in `paths.ts`. | Runs at the same time as W0. |
| **W1 Mail actions** | Invite accept (with sign-in and sign-up return, token kept in the fragment), CSAT. | Proves rule 2 and rule 4 of 5.4. |
| **W2 OAuth return** | A3 in the API and framework, and the web result page. | The only lane that edits `apps/api/src/quills/framework/**`. |
| **W3 Mail-linked detail** | Post, conversation with reply, status incident with the legacy redirect. | Builds the post and conversation components in `quills/ui/post/` and `quills/ui/conversation/`, because W5 reuses them. W3 owns those two folders. |
| **W4 Public content** | Changelog, status page, help center. | Anonymous pages. Respects gated help-center content. |
| **W5 Full portal** | Boards and post list, submit, vote, comment, profile, preferences, customer support. | May split into W5a (feedback) and W5b (account and support) if the change is too large to review. |
| **Z Integration** | Merge in order, regenerate `routeTree.gen.ts` and `openapi.json`, run all checks, browser proof (9.5), docs. | No feature code. |

### 9.3 File ownership

| Path | Owner |
|---|---|
| `scripts/quills-web/**`, `quills/core/**`, `quills/test/**`, the kit files in `quills/ui/`, `quills/api/client.ts`, `quills/api/errors.ts`, `quills/api/keys.ts`, `quills/i18n/load.ts`, `quills/i18n/en-US/core.json`, `quills/dev/**`, `routes/quills/kit.tsx`, `quills/portal/layout.tsx` (W0r adds the branding), the two `*.test.ts` rule files, `.github/workflows/quills-web.yml` | W0 only, except where noted. A later lane that needs a framework change describes it in its report. Z applies it with the steps of 6.11. |
| `quills/api/<area>/*`, `quills/hooks/<area>/*` (with fixtures and type files) | The lane that generates the operation. Two lanes never generate the same operation: the page table assigns each one. |
| `quills/ui/post/**`, `quills/ui/conversation/**` | W3 |
| `quills/pages/<page>/**`, `routes/portal/…/<page>.tsx`, `quills/i18n/en-US/<feature>.json` | The page's lane |
| `apps/api/src/quills/framework/**` | W2 only |
| `apps/api/src/quills/portal/paths.ts` | WA. Later lanes report a needed path. |
| `apps/api/src/quills/dev/**` | WA |
| `apps/docs/quills/**`, `apps/docs/docs.json` (S4) | Z |
| `apps/web/src/routeTree.gen.ts`, `apps/docs/openapi.json` | Z regenerates them. Lanes commit their own regenerated copy, so their branch builds. |

### 9.4 How the coordinator dispatches

Each lane is one subagent call:

| Setting | Value |
|---|---|
| Type | `frontend-developer` for W0, W0r, W1, W3, W4 and W5. `backend-developer` for WA and W2. |
| Model and effort | Opus, `xhigh` |
| Isolation | `worktree` |
| Branch | `feat/quills-130-<lane>`. W0 and WA from `origin/staging`. W0r from W0's branch after the WA merge. Wave 1 from W0r's branch. |
| Wave 1 | W1, W2, W3 and W4 in one message, so they run in parallel |

Every brief contains:

1. The goal, the lane's rows of sections 8 and 9.2, and its file ownership from 9.3.
2. The files to read first: this RFC, `AGENTS.md`, `apps/api/AGENTS.md` (API lanes),
   `scripts/quills-web/README.md`, and the W0r reference page.
3. **Use the framework.** Follow the golden path (6.13). Create each file with the CLI. Do not
   write by hand a file that a command can create. Add a `quills-web-allow` exception only with a
   reason, and repeat the reason in the report. When a command is missing or a rule is wrong,
   report it. Do not work around it.
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
   - Use `node scripts/quills-web/cli.mjs seed` for local data. Never use production data.
6. Verification: run `node scripts/quills-web/cli.mjs verify`. It runs these commands in order:

   ```sh
   pnpm --filter @kaneo/web typecheck
   pnpm --filter @kaneo/web test
   pnpm --filter @kaneo/web build
   node --test "scripts/quills-web/**/*.test.mjs"
   node scripts/quills-web/cli.mjs check
   pnpm exec vp check
   pnpm branding:test && pnpm branding:check
   node scripts/quills-port/check-upstream.mjs
   ```

   `verify --api` also runs `pnpm --filter @kaneo/api typecheck`, `pnpm openapi:check` and
   `pnpm --filter @kaneo/api test:quills` on the lane's own disposable database. WA and W2 use it.
   W0 builds `verify`. Until it exists, W0 and WA run the commands directly.
7. The Feature Flow review team on the lane's diff, with an accessibility and a security lens for
   pages that handle tokens.
8. Local commits only. No push, no pull request, no merge.
9. The report format: commits, pages and operations built, verification results, every edit
   outside owned files, each rule exception with its reason, framework gaps (a missing command, a
   wrong rule, unclear README text), anything wrong in this RFC, the review verdict, and remaining
   risks.

### 9.5 Lane Z

1. Merge W0, WA and W0r, then W2, W1, W3, W4 and W5. After each merge, regenerate
   `routeTree.gen.ts` and `openapi.json`, then run `verify`.
2. Apply the shared-file changes that lanes reported. A framework change follows 6.11.
3. Browser proof (D21), against a local stack that `cli.mjs seed` fills:
   - Click each mail link type from a real mail render, signed out and signed in.
   - Accept an invite through sign-up, with the email verification in a new tab (5.4 rule 4).
   - Complete the OAuth return for one provider with a local stub provider.
   - Check the bundled and the split-origin deployment for one page each.
   - Check each page at a width of 375 pixels (5.4 rule 10).
   - Load one action page in a frame, and see it refuse to act (5.4 rule 9).
   - Run axe on each page with the `axe-core` that `scripts/ui-review-bot` already installs. Also
     run it on a workspace with branding colors (5.5).
   - Open the kit gallery and compare each kit component in each state.
4. Write the docs in `apps/docs/quills/`: how an admin turns on the portal and invites customers,
   how a customer uses it, and the `frame-ancestors` header for each deployment. Add the navigation
   group (seam S4).
5. Update #130's checklist text in the pull request description, not in the issue.

## 10. Testing

| Layer | What it proves | Where | Written by |
|---|---|---|---|
| Operation | The method and path from `openapi.json`, the input, the typed body, the problem for each documented status and for a network failure | `quills/api/**/*.test.ts` | `describeOperationContract` (generated) |
| Hook | The key holds the workspace and the viewer. No run on empty input. A mutation invalidates the declared keys on success only. Paged, polling and optimistic cases (6.8). | `quills/hooks/**/*.test.tsx` | `describeHookContract` (generated) |
| Component | Role and name, each variant, each callback | beside the component | The template, then the author |
| Form | Field errors, API issues, no double submit, no submit in a frame | beside the form | `describeFormContract`, then the author |
| Page | Each state in `meta.states`, the audience, token, focus and title cases, then each action | `pages/<page>/*-page.test.tsx` | `describePageContract`, then the author |
| Route and redirect | Search validation, the gate, redirects (old status path, sign-in return) | beside the route | Generated |
| Conformance | Rules C1 to C23 and the boundary rule | `conformance.test.ts`, `boundaries.test.ts`, `cli.mjs check` | W0 |
| Framework | Each template passes each rule. Golden output. Each migration is idempotent. Each contract case fails on a broken page. Generated code compiles, and its tests pass (CI). | `scripts/quills-web/**/*.test.mjs` | W0 |
| API | A1 to A6 through the contract suite on PostgreSQL | `apps/api/src/quills/**` | WA, W2 |
| Browser | Real mail links, invite through sign-up, both deployments, phone width, frames, axe | lane Z | Z |

The typed client from `@kaneo/libs` makes a wrong path, method or body a type error. So
`typecheck` is part of the proof for every fetcher.

## 11. Risks

| Risk | Control |
|---|---|
| Upstream reshapes `components/ui`, auth routes or the router. | One adapter file (4.4), the registered seams (4.3), and `check-upstream.mjs`. |
| Upstream changes the sign-in or sign-up redirect contract. | Seam S2 is permanent and tested. W1's tests cover sign-in and sign-up return, so a merge that drops S2 fails CI. |
| The framework becomes too rigid, or nobody can change it. | Plain templates and the standard library only. A written change process with migrations (6.11). An exception comment with a reason for a real edge case (6.10). |
| Agents write code by hand that only looks generated. | `check` tests the shape, not the origin: names (C10), page anatomy (C14), contract tests (C15), and no open `TODO(quills-web)` marker (C12). |
| The CLI check and the vitest check disagree. | Both import the same rule modules from `scripts/quills-web/lib/rules/`. |
| A contract test passes when the code is missing. | The self-test runs each contract on a broken page in the golden files. Each case must fail there. |
| The framework works only for the agent that built it. | W0r builds the reference page from the README alone and reports each gap. W0 fixes the gaps before wave 1. |
| A token leaks through the address bar, the referrer or logs. | Rule 3 of 5.4, rule C9, and a security lens in the review. |
| A mail scanner triggers an action. | Rule 2 of 5.4 and rule C9. |
| A page leaks a private record through its error. | A 403 for one record shows `notFound` (5.3). The API already enforces visibility. |
| A token stays in `localStorage` on a shared computer. | Only for a sign-in round trip. 30-minute expiry. Removed at use and at sign-out (5.4 rule 4). |
| Another site frames a page and tricks a visitor into a click. | `ConfirmAction` and `PortalForm` refuse to act in a frame (5.4 rule 9). The docs give the header. |
| Polling loads the API. | Only visible tabs poll, and the interval is 10 seconds or more (6.5). |
| The parser choice adds a seam. | S3 exists only if oxlint cannot run the rules (D23). Its resolution is mechanical. |
| Custom domains later need a large change. | Each side builds links in one place (D22, C21). |
| Search engines see empty pages. | Accepted for now (D19). |
| `routeTree.gen.ts` conflicts on every upstream sync. | Regenerate (S1). It is a known, mechanical resolution. |

## 12. Completion

This RFC is complete when:

1. Every portal link type that the API sends opens a working page, and C6 passes. The teammate
   link waits for #132 and is listed as pending.
2. No link in mail or in an OAuth return shows raw JSON to a browser.
3. The full portal (section 8, W5 rows) works for public, private and signed-in visitors.
4. `check-upstream.mjs` prints `PASSED`. The only upstream files changed are the seams S1 to S4
   (S3 only if D23 needs it).
5. All verification commands pass, and lane Z's browser proof is recorded in the pull request.
6. Each file in the fork-owned web paths passes `check`. `list --exceptions` output is in the pull
   request, and each exception has a reason.
7. The framework self-test passes. The README documents each command, each rule and the golden
   path.
8. W0r built the reference page from the README alone, and W0 fixed each gap that W0r reported.
9. The docs in `apps/docs/quills/` describe the admin and customer use and the deployment header,
   and the docs navigation shows them.
