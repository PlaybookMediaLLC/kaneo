# RFC 0002 implementation evidence

This is a working ledger, not a completion claim. The accepted RFC remains the scope.
Base: `5414550c`; integration branch: `feat/quills-130-portal-pages`.

## Execution

- W0: in progress in `../kaneo-w0`, branch `feat/quills-130-w0`.
- WA: 21-file feature snapshot integrated into root and W0; full-suite/review gates still running in `../kaneo-wa`.
- W0r: active in `../kaneo-w0r`, branch `feat/quills-130-w0r`; independent agent generated unsubscribe via README/CLI and reported missing documented token/viewer/component APIs. W0 is fixing these.
- W1, W4: waiting for worker capacity; W3 active in ../kaneo-w3 from integrated framework/reference snapshot.
- W2: independent API portion started in `../kaneo-w2`, branch `feat/quills-130-w2`; web page waits for W0r.
- W5: pending W3.
- Z: docs drafted; integration, checks and browser evidence pending.

Opus is unavailable in this executor. Available frontend/backend agents execute the lanes.
No commits, pushes, pull requests or deployments have been made for this task.
Unrelated untracked `docs/featurebase-gap-plan.md` and `docs/userjot-gap-plan.md` are preserved.

## Requirement audit

| Requirement | Required proof | Current evidence |
| --- | --- | --- |
| A1, A2, A5, A6 | Central path inventory, mail body/header tests, safe config isolation, local-only seed tests and real PostgreSQL run | WA in progress |
| A3 | All four OAuth paths, browser 303 vs JSON, sanitized outcomes, signed-route contract self-test | W2 API in progress |
| A4 | Named operations exist; report any missing response data before adding routes | All 40 referenced API operation IDs exist in committed OpenAPI; response sufficiency still pending |
| W0 framework | All commands/options/templates, C1-C23 negative cases, contracts reject broken implementations, generated compilation | In progress |
| W0r reference | Unsubscribe from README alone; gaps fixed, S2 auth return, safe branding | Pending |
| W1 actions | Invite through signup/new tab, CSAT confirmation, token expiry/removal and framing tests | Pending |
| W2 result | Safe success/failure page for providers and connectors | Pending |
| W3 details | Post, conversation/reply, incident, legacy redirect and audience checks | Pending |
| W4 content | Changelog, status/history/uptime, help home/locale/category/article/search/redirect and gates | Pending |
| W5 portal | Boards, paged posts, submit/similar/vote/comment/own edit-delete, profile/preferences, conversations/tickets | Pending |
| Boundaries and seams | Only S1-S4 changes; upstream check PASSED; no widget changes | Pending final diff |
| Verification | Complete section 9.4 command list, API checks, branding, CI-equivalent secret scan, review team | Pending |
| Local browser proof | Real mail renders signed in/out; invite new tab; stub OAuth; bundled/split origin; every page at 375px; frame refusal; axe including branding; gallery | Pending |
| Documentation | Admin/customer/deployment pages and navigation, verified against finished product | Drafted in apps/docs/quills; navigation added; final product comparison pending |
| Completion report | Exceptions with reasons, pending teammate #132 link, review verdict, exact evidence | Pending; retain locally until PR creation is requested |

## Validation environment

The shell defaults to Node 22.22.3. Use installed Node 24.22.1 at
`/Users/dyomba/.local/share/mise/installs/node/24.22.1/bin` for repository checks.
The CI database image `pgvector/pgvector:0.8.7-pg16-bookworm` is installed locally.
Use isolated disposable `quills_*` databases with role `postgres`; never use existing app data.

## Checks recorded

- Root `node scripts/branding/check.mjs` under Node 24.22.1: PASS, zero text/asset findings.
- Documentation JSON parse, registered pages, local links and preservation of existing navigation indices: PASS.
- `git diff --check`: PASS for tracked changes.
- Docs-only review lenses applied locally: API operations/auth semantics checked against source and OpenAPI; deployment header instructions checked for web-host placement and widget exclusion. Product walkthrough remains pending.
- Initial branding run failed on environment-variable text and a shifted navigation exception. Fixed by linking existing environment docs and appending the portal navigation group; rerun passed.

## Auth seam expansion (owner approved)

The current source contradicts S2's assumption that two route edits are sufficient:

- `routes/auth/sign-in.tsx` passes no redirect to `SignInFooterLine`.
- `components/auth/sign-in-footer-line.tsx` links to signup with only email/invitationId.
- `components/auth/password-sign-up-form.tsx` sends no verification callback URL and navigates
  to signin without redirect when signup has no session.

The required signup/new-tab return flow needs a narrow expansion of S2 to those three files.
A concrete five-file patch (including the two already permitted S2 routes) is prepared at
`/tmp/quills-130-auth-redirect.patch`. `git apply --check` passes. The owner approved the three extra files and the patch is now applied. Web typecheck passed. The existing OTP, OTP-path and auth-method test files passed (32 tests); new signup/new-tab runtime proof remains pending.
Other lanes continue independently. W1/Z must prove OTP and password paths with the expanded seam.

The password verification mail sender also overwrote the callbackURL. The owner approved S2
expansion to `apps/api/src/instance-settings/send-sign-up-verification-email.ts` and its regression
test. Applied a same-origin sign-in allowlist retaining only a safe path-only redirect; tokens,
foreign origins and unrelated callback parameters are discarded. The web callback is absolute
so a split-origin API returns to the web host. This changes email URL presentation only; no
account/session/permission/database behavior changes.

- Verification callback suite: PASS, 15 cases, including split origin, absent callback, foreign URL,
  path confusion, query/fragment tokens and unrelated callback parameters.
- Scoped API formatting/lint: PASS after safe formatting, including final callback/base-path test.
- All five changed web auth files: scoped Vite+ formatting/lint PASS.
- API typecheck initially failed because the test mock returned undefined instead of EmailResult. Corrected to `{ success: true }`; rerun session `48394` later disappeared without a retrieved terminal result. That check was inconclusive. The combined branch rerun now passed (exit 0), with retained output at `/tmp/quills-rfc2-combined-api-typecheck.log`.

## Additional validation and D23

- Web typecheck after S2 changes: PASS (`@kaneo/web` app and node configs).
- Existing auth focused suite: PASS, 3 files / 32 tests (`verify-otp`, `verify-otp-path`, `auth-methods`). This does not prove the new password signup callback or full return flow.
- Scoped Vite+ check initially found formatting in sign-up/check-email; safe fixes applied and those two files passed.
- pnpm launcher under Node 24 failed with ENOEXEC. Direct `node /Users/dyomba/Library/pnpm/.tools/pnpm/12.18.0/node_modules/pnpm/bin/pnpm.mjs` works. W0 also verified `corepack pnpm`.
- W0's actual Vite+ custom JavaScript lint-plugin execution probe succeeded. The proposed oxc-parser/package/lock change was removed: S3 is not required. Initial `pnpm exec oxlint` absence alone was insufficient evidence; actual custom-rule execution resolved D23.

## Disposable validation database

Root started container `3a1046204003fbe8242ac2d9a8488740f13cc0008c0c659f3eeff104c7d7106c`
(`kaneo-rfc2-validation-postgres`) from `pgvector/pgvector:0.8.7-pg16-bookworm`.
It binds only `127.0.0.1:54446`; `pg_isready -U postgres` passed. Local trust authentication
is for this synthetic test container only. Do not stop unrelated existing containers.

- Integration database: `quills_rfc2_z`.
- WA database created and supplied: `postgresql://postgres@127.0.0.1:54446/quills_rfc2_wa`.
- W2 database created and supplied: `postgresql://postgres@127.0.0.1:54446/quills_rfc2_w2`.

W0 progress inspection found form-schema generation and the missing-test command incomplete;
requested full implementations. Also requested complete C1-C23 AST/metadata coverage and negative
self-tests before treating the framework as complete. No reference-page success is claimed yet.

## Conformance implementation ownership

Root now owns `../kaneo-w0/scripts/quills-web/lib/rules/` except `plugin.mjs`, which W0 owns.
The shared checker captures ASTs through Vite+ into a private temporary directory, then applies
C1-C23 modules for CLI and Vitest alike. Actual W0 source capture succeeded (34 documents).
A Node negative self-test has one broken source example per rule plus exception tests; its temporary
project initially failed because Vite+ required workspace package metadata. Fixed the fixture setup;
40 actual-parser tests now pass, including all 23 rule negatives, six valid framework shapes, parsed comment exceptions, template-literal link enforcement and dynamic-import boundaries. Scoped formatting/lint passed.
Do not integrate this work as complete until negative cases, valid-code cases, formatting and
full conformance pass. W0 remains responsible for generator/runtime/workflow and their tests.

## WA source integration

Copied the 21 changed/new files from WA into root and W0 after checking each destination against
HEAD or the exact WA content, preserving unrelated changes. Snapshot hashes are stored locally in
`/tmp/quills-rfc2-wa-integrated.json`. This includes regenerated OpenAPI, safe public branding,
canonical link helpers and callers, unsubscribe body/header separation, and guarded seed code/tests.
WA reported API typecheck/build, focused unit/email tests, isolated PostgreSQL tests, seed collision
and reset checks, branding tests/check passing; its full Quills suite is still running and load-timeout
files need isolated reruns. This is an implementation integration, not a full verification verdict.

The user explicitly instructed that code-review graph tools must no longer be used. All lanes were
notified; continue with source inspection, implementation and tests.

## W2 source integration and reference-page progress

Integrated 17 stable W2 backend source files into root and W0 after destination conflict checks.
Snapshot hashes: `/tmp/quills-rfc2-w2-integrated.json`. W2 reported typecheck/build, 11 unit tests,
38 focused database tests, and 777 contract/self-tests passing; its full suite and isolated timeout
reruns are still pending. Regenerated combined OpenAPI successfully and verified it retains public
branding plus 303 responses for provider/connector GET callbacks. Copied that schema to W0/W0r.
The fragment callback retains JSON and uses the result-location response header for the bridge.

WA's final test-only deltas (boundary inventory and embed URL assertion) are integrated. Its prior
full-suite PID 95356 is now absent; the failed run must be repeated on the combined branch with
retained output. No green full-suite claim is made.

W0r generated unsubscribe feature, operations/hooks/fixtures/tests, page/meta/test and route with
the CLI. Independent README check found missing token retrieval, Viewer access, component prop
contracts, mutation usage and done-state documentation; W0 owns the corrections. Unsubscribe stays
public. Root retains S2 testing ownership: its full signup/new-tab proof belongs to W1/Z, not the
unsubscribe page.

W2's full suite found a route-import boundary failure: the OAuth result helper was under integrations. The helper and test now live under framework, with an explicit allowed framework path; root and W0 snapshots retain WA's existing boundary additions. W2 reported 15 focused tests passing after this correction. Full-suite timeouts remain unresolved. Root combined focused run initially found the WA seed allowlist in the wrong sorted position; corrected the expected ordering without widening the boundary. All four focused files then passed (30 tests), retained at `/tmp/quills-rfc2-combined-api-focused.log`.

## Local browser stack preparation

Applied both public and Quills migration histories to disposable `quills_rfc2_z`; both commands passed. Seed command passed and created `quills_portal_demo` / `quills_portal_demo_user` with synthetic data. No existing application database was used.

Started owned mail sink `kaneo-rfc2-validation-mailpit` (container `4956da8ff730c3ad176ab3f36c9ef45ab7ac1de4f9505e5dc47865b7a46a1b1e`), loopback SMTP 51025 and web inbox 58025. Root API startup is tracked as PID 50691, session 9141, log `/tmp/quills-rfc2-z-api.log`; `GET /api/health` returned 200. Web dev server is session 69629 at loopback 5173, log `/tmp/quills-rfc2-z-web.log`. Process environment is an explicit local-only allowlist with a generated ephemeral auth secret, local SMTP and password signup enabled. Root `.env` and web `.env.local` are absent.

## Framework/reference integration and browser tool

Integrated 124 W0 framework files and 16 W0r unsubscribe files, with exact hashes in `/tmp/quills-rfc2-web-integrated.json`. The W0r handoff incorrectly reported branding files matching W0. A live source comparison found W0 still unbranded; root then overlaid all four W0r branding files and used the pure PortalBranding type from core. W0r reported typecheck, build, 23 focused tests and branding checks passing. W0 CLI completeness and final review remain in progress; C6 remains pending for later pages. W3 now implements mail-linked details; W2 adds its OAuth result page while its API suite continues.

User requested Stagehand (confirmed after initially saying Stagemate). Installed official `browse@0.11.4` outside repo under `/tmp/quills-rfc2-browser-tools`; read official/version-matched browse skill. `browse doctor` passed; named local headed session `quills-rfc2` opened sign-in and clicked create-account. Redirect was preserved in the signup URL. Original Vite dev page failed on the existing branding CJS export; production build passed and preview serves correctly. First production preview included the checked-in Turnstile site key; rebuilding with empty local-only `VITE_TURNSTILE_SITE_KEY` to match the disposable API configuration, plus the newly integrated portal routes. Full browser proof is pending.

## Current integration and remaining framework work

W1's 29 files, W2's six result-page files and W3's 72 files are integrated using exact owned-file manifests. W1 reported 50 focused tests and a full web run with 2,083 tests passing except expected missing-page conformance. W3 reported 98 focused tests, typecheck/build/lint/branding passing. W4 remains active (113 focused tests passed), W5a builds feedback/home/boards/interactions and W5b builds profile/preferences/customer support. No lane review team has run; the required combined Feature Flow review remains pending.

W0 final handoff explicitly remains incomplete against strict RFC requirements: full plain-text template inventory; complete per-command goldens and temporary-worktree compile/generated-test CI; full page/form/redirect/component contract matrices; page pre-write/mail-pattern validation/state translation insertion; doctor route-tree/operation-manifest freshness; route query prefetch; and complete gallery states. Root owns these and must not mark the goal complete without closing them.

Integration found and fixed a real unsubscribe bug: a successful action was replaced by gone after preview invalidation. Regression failed before the fix and now passes; nine page tests and scoped lint passed. Stagehand verified a real rendered email from local Mailpit, token removed from address bar, database unused count 1/0 on load then 1/1 after click, and persistent success text. At 375px: no horizontal overflow, one h1, one main. Axe: zero violations, 29 passes, zero incomplete. Screenshot `/tmp/quills-rfc2-unsubscribe-success-375.png`. This run preceded final branding overlay; branded-theme axe remains pending.

Root fixed nullable-number and allOf fixture/schema generation; cursor/offset paging types and string query offsets; a Corepack-compatible verify/seed runner; C21 ObjectProperty redirect detection (41 parser tests pass); rejected ConfirmAction promises and duplicate pending clicks (3 tests pass); a router-independent MarkdownContent (3 tests pass); hook-contract migration 0002 (tested idempotent); pagination migration 0003 (test still pending). Shared Retry-After/error-kind/countdown support is in progress with focused tests running. Page call sites still need explicit retry callbacks. C9 local selection false positive and docs/template consistency remain pending.

The W2 full-suite child session 88059 was not accessible from root (`Unknown process id`), and its OS processes are gone; final outcome is unavailable. Root now owns a fresh retained full API run, session 34679, log `/tmp/quills-rfc2-combined-api-full.log`, on dedicated `quills_rfc2_tests`. A briefly started run used the synthetic browser database and was stopped by exact tracked process tree before restarting on the separate test database. No production data was involved. First observed failure is an exact 5-second customer-support mail timeout; isolated reruns are required after the run completes. W2's final result-location OpenAPI header was integrated and OpenAPI regeneration passed (log `/tmp/quills-rfc2-openapi-final-header.log`).

## Completion decision

Not complete. No browser, integration or release claim is supported yet.

### Root combined integration and Stagehand proof (2026-11-13, 02:12 local)

- Integrated W4 99 files and W5b 115 files from exact SHA-256 manifests. Root retries now preserve form drafts, honor Retry-After, refuse duplicate pending submits, and require explicit re-confirmation. Eight focused files / 52 tests pass; C9/C15 parser refinements and pagination migration idempotence pass.
- Fixed stale Vite glob expansion during lane integration by invalidating the translation-loader source; regression test verifies integrated invite/CSAT labels. Build requires explicit local VITE_API_URL=http://localhost:1337, VITE_CLIENT_URL=http://localhost:5173, empty VITE_TURNSTILE_SITE_KEY/VITE_SENTRY_DSN, because checked-in production env contains deployment placeholders. Build passed with these overrides.
- Stagehand browse real local mail link -> invite -> sign-in -> create account -> password signup -> real verification email -> new tab -> sign-in -> original invite -> explicit accept PASSED. The disposable instance has require_email_verification enabled for this case. Token scrub/no-referrer/focus verified before signin; token remained in localStorage across newtab verification and was removed on return. Final URL has no query/hash; one h1, one main, no horizontal overflow at375. DB confirms accepted, email_verified=true, workspace memberships=0. Screenshot /tmp/quills-rfc2-invite-verified-success-375.png; axe /tmp/quills-rfc2-invite-axe.json:0violations,15passes,0incomplete. First run with verification disabled correctly denied unverified invite acceptance; second run tested required verification.
- Full API run completed:104files,1730tests,1724passed/6failed. Five failures timed out at5seconds; isolated reruns launched via /tmp/quills-rfc2-api-reruns.py. One real contract failure found open branding color maps; fixed to closed allowlisted schema. Focused getQuillsPublicPortalConfig contract passes (other745 filtered out, not fullsuite proof). Full retained log /tmp/quills-rfc2-combined-api-full.log.
- Strict framework tasks delegated to existing agents: W4 full plaintext templates/exact goldens/CLIvalidation+CI; W5b real contract matrices+memoryrouter; W5a route prefetch/runtime after page integration. Root owns API verification, gallery, browser, final combined review.

- Integrated W5a88files after checking root W3 hashes before replacements; all requested productpages now present. W5b234focusedtests passed; W5a142focusedtests then18post-extraction tests passed in lane. Combined finalchecks still pending.

### Combined browser findings and fixes

- API timeout reruns passed at unchanged timeouts: contract.self32, widget6, embeds8, customer22. API focused branding/path/verification19pass. API typecheck passes. Full prior run remains recorded as1724pass/6fail; isolated repaired/failure proof is separate.
- Mobile Stagehand/axe: feedback home, board, post, changelog list, status overview, help home, conversation detail all render oneh1/onemain/nooverflow and0axeviolations. Help firstfailedcontrast3.01 because demo blueprimary inherited darkprimaryForeground; seed now sets pairedwhiteforeground, rerun0violations. Seed incident originally lacked affectedcomponentlink and was correctlyinvisible; seed now addslink idempotently and reconcilescomponentstatus with existingdomainhelper.
- Nested route blocker found: helparticle/category/locale and changelogdetail URLs render parentpages. They are NOT counted as verified despite0axe findings. W5a fixing indexroute hierarchy + integrationregressions and generator coordination.
- Browser created conversation with actualcustomer API, then sent reply; both appeared. CSAT: actual emailtemplate link rating3 -> querytoken removed/noreferrer -> DBratingnull onload; renderedsamepageiframe and clickedconfirm -> frameblockedmessage and DBratedcount0; changedrating5 in toplevel select -> explicitconfirm -> success5 and DBrating5. No mail-scanner write. Audit artifacts use /tmp/quills-rfc2-<page>-{audit,axe,snapshot}.json and375.png.
- Stagehand daemon became unresponsive after machine timegap; doctor diagnosed ownedPID62521 stale. Used browse stop --session quills-rfc2 --force then restarted localheaded. Signed back in using saved disposabletestcredential. No realaccounts/data used.

### Resumed integration and Stagehand coverage

- User resumed remaining RFC work and then requested migration of all Playwright tests to Stagehand. User approved replacing the BrowserStack WebKit matrix with Stagehand Chromium. Migration follows RFC completion.
- Integrated final W5a runtime/vote/capability paths, W5b guarded preferences and strict testkit/page-state matrices, W4 templates/goldens/migrations/prefetch/checker. All files copied from exact SHA manifests with local pre-copy backups. Fixed five moved index-test imports caught by combined typecheck.
- Comment response now exposes canEdit/canDelete using the same scoped public-team-reply rule as mutation authorization. Focused API feedback13tests pass; OpenAPI regenerated. Browser exposed missing post/detail/list invalidation after comment edits/deletes; all comment mutation hooks now invalidate those dependent caches with contract assertions.
- Browser passed profile update/revert; both subscription toggles on/off; incident detail + legacy redirect; ticket conversation; feedback create/edit/vote/unvote/comment create/edit/delete/post delete. Signed-in and signed-out real rendered post/incident/conversation mail links were exercised; signed-out conversation shows safe-return sign-in.
- Same-origin status page runs on local5183 through API proxy; performance entries confirm all API requests use5183. Split-origin uses5173/1337. Gallery development build renders all states, has375px/nooverflow/oneh1/main/zeroaxe findings. Interactive form proved invalid errors, preserved draft on network/rate-limit, explicit retry, success; empty/pending content controls exercised.
- OAuth callback with local GitHub transport stub produced actual303 and rendered connected; replay303 rendered already_used. Separate owned browser/API processes stopped. Test fixture mistakenly reused existingcustomer asworkspaceowner; restoration completed with the original customer binding and zero workspace memberships. Repeated OTP return renders the original conversation and messages; API200, 375px, oneh1/main, nooverflow, axe0.
- Combined web typecheck passes. Conformance passes. Upstream checker PASSED. Repo-wide lint exposed template placeholders parsed as TS/JSON; W4 correcting template suffixes. Fullframework migration0005 test was coupled to workingtreefixture; replaced with self-contained legacyfixture. Full API and web runs still in progress; no full-suite pass claimed.

- Final repair evidence: template suffixes integrated; generator temp-copy frozen offline install, generation, build and typecheck passed, plus4generated files/11tests. Focused root7files/31tests pass after shared viewer and invalidation fixes. Branding36tests passed. TruffleHog3.99.7 filesystem scan of686task files with CI verified/unknown filters and exclude paths passed with zero findings; filesystem mode includes the uncommitted and untracked implementation.
- Repaired full web run:578files,571passed/7failed;2693tests,2682passed/11failed. Translation/teardown issues are gone. Remaining feedback title/form cases fixed to honor optional-title API contract; two upstream tests timed out under load and require unchanged-timeout reruns. Full API still running; no full-suite pass claimed.

- Final web verification with supported `VITEST_MAX_WORKERS=2`:578files/2695tests PASS, web typecheck PASS, production build PASS. No test timeouts or repo test settings were changed. The default-worker run still had6existing upstream timing failures; retained separately. Verification CLI then exposed a real framework invocation bug (`node --test scripts/quills-web` treated the directory as a module); fixed to the RFC glob and added a two-case discovery regression. Both verification-command tests pass. Remaining verifier steps resumed separately to avoid rerunning the already-passing web checks.
- Full API:105files,1684pass/47fail (many cascading after timeouts). Isolated unchanged-timeout reruns cleared18of19failing files, including workflow/webhook/workspace isolation; only existing5001-subscriber pagination remains above5seconds. A separate15second diagnostic passed16/16status tests and measured that case at6.44seconds. Default-timeout API suite is therefore NOT green; no timeout was changed in repository code.
- Additional Stagehand mobile375/axe0 proof: support creation/list page, OAuth failure page, help legacy missing page. Real changelog mail clicked signed in and signed out. Replayed CSAT and unsubscribe mail links signed out render gone and retain no token.


### Final review fixes and Stagehand migration

- Completed the Feature Flow review team: structure, performance, failure handling, QA/accessibility, lean, and TypeScript/JavaScript contracts. Code-review graph was not used, as requested. Review blockers are repaired: board vote invalidation; comment and conversation history pagination; foreground-only conversation refresh; infinite-query route-prefetch cache shape; expired memory tokens; early no-referrer policy; and redirect normalization/backslash/control rejection.
- Added review regressions for more than 100 comments, older conversation messages, incoming replies and hidden-tab polling, token expiry, route-prefetch data, and malformed redirects. Clean full web run passed **578 files / 2,710 tests** with `VITEST_MAX_WORKERS=2`; repository test timeouts are unchanged. Web typecheck and production build passed. Framework 79 tests, conformance, upstream checks, branding 36 tests, OpenAPI generation and generated-project build/typecheck/tests passed.
- Migrated all owned Playwright browser suites, CI browser scripts, product/docs screenshots, UI review captures, dependencies, lockfiles and workflows to Stagehand 4.4 Chromium and Node test runner. BrowserStack/WebKit and the obsolete provider security patch/tests were removed with user approval. HTTP and HTTPS suites each passed 3/3 against a disposable real API/PostgreSQL stack; CI browser sign-in, persistence, real socket events and outsider denial passed. These are local built-web/real-API/proxy checks, not hosted workflow or Docker-image execution.
- The shared browser package remains isolated from production dependencies. Profiles isolate actors; accessible queries retain Testing Library semantics; CDP supplies fixtures, network/socket evidence and diagnostics. Screenshots keep axe, framing, fixed time and synthetic APIs. No LLM key or cloud browser credential is required.
- Final migration review exposed and repaired screenshot fixture target escapes, startup-retry error-array aliasing, and click-before-keypress behavior. Browser regressions prove popups/workers/shared workers/service workers cannot reach an external test server, runtime failures survive a recoverable Vite 504 reload, Escape preserves selection and Enter activates once. Fixture documents apply CSP using response fulfillment; synthetic WebSockets also close the dev-server HMR connection. Chrome-cancelled interception IDs are ignored narrowly; actual handler failures fail closed and remain visible. Browser initialization now falls within cleanup-protected blocks.
- Review follow-ups left outside this change: debounce similar-title search; use SQL DISTINCT for the team-reply capability lookup; avoid polling all loaded conversation-history pages; consolidate duplicated home/board submit forms; remove unused per-page CDP disposal bookkeeping. Lean review estimated 70 lines from the existing form duplication and 6 lines from unused CDP disposal. These are nonblocking findings, not implemented features.
- Final unchanged-timeout status API rerun passed **16/16**, including the 5,001-subscriber pagination case. Every initially failing API file now has an isolated pass at repository timeouts. The earlier aggregate run remains recorded as 1,684 passes / 47 failures under load; isolated reruns are not a clean single aggregate run. No timeout was changed. No release, commit, push or pull request was requested or performed.


### Final combined review verdict

All blocking findings from structure, chaos, QA and the TypeScript specialist are fixed and covered by focused or browser regressions. The performance cleanup finding was also fixed by protecting page initialization with browser cleanup. No reviewer finding was waived as unproven. The TypeScript/JavaScript specialist was included because the change spans React query contracts and Stagehand/CDP APIs.

#### Should-fix

- `apps/web/src/quills/hooks/support/use-list-my-conversation-messages.ts:13`: loading many history pages makes foreground polling refetch every loaded page (performance). Preserve older-history access while limiting newest-message refresh work in a later change. The pre-existing debounce, capability-query and duplicate-form recommendations remain listed above.

#### Nits

- `scripts/browser-test/cdp.mjs:92`: unused page-level disposal bookkeeping can be removed; all current callers close the whole browser (lean). `net: -6 lines` in the migration, plus the earlier separate `-70 lines` duplicated-form estimate.

**Ship** for the implementation and browser migration: blocking review findings are resolved. This is not a deployment or aggregate API-suite pass claim; the single-run API timing limitation and local-only infrastructure evidence remain explicit above.


### Final validation results

- Web: 578 files / 2,710 tests pass; API and web typechecks, production builds, OpenAPI generation, framework 79 tests, generated-project checks, branding 36 tests and conformance pass.
- Stagehand: HTTP 3/3 and final HTTPS 3/3 end-to-end tests pass; real CI browser flow passes; browser infrastructure 4/4 passes; UI review unit tests 91/91, CI/classifier/dependency checks 27/27 and E2E dependency policy pass. Docs screenshots: all seven views in light and dark (14 captures), no runtime errors, unhandled fixtures or blocked requests.
- Repo-wide lint/format and actionlint for all four changed workflows pass. TruffleHog 3.99.9 scanned 709 current task files after the existing repository placeholder-path exclusions: zero verified or unknown findings. Uncommitted and untracked implementation files were included.
- API: final status suite passes 16/16 at unchanged repository timeouts; every file that failed the earlier aggregate run has now passed separately. Aggregate API load sensitivity remains recorded; no clean final single aggregate run is claimed.

- Final product screenshots: board, list, timeline and task in both themes (8 captures) pass with zero runtime errors, unhandled fixtures or blocked requests. Capture files stayed under `/tmp`; published screenshots were not changed. Dedicated Stagehand E2E API and HTTP/HTTPS proxy processes were stopped after validation.

- Final capture-runner check passed on the real local app with synthetic APIs: framed preview produced, axe complete with zero violations and zero incomplete checks, no runtime errors or missing fixtures. The expected Vite HMR disconnect message remains in console diagnostics because fixture sockets are deliberately closed. Final repository lint and `git diff --check` pass. Implementation and migration are complete in the working tree; hosted workflows and the Docker-built E2E image were not exercised.
