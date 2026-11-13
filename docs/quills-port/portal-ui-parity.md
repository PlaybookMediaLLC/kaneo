# Portal UI and interaction parity

Comparison date: 2026-11-13. Scope: the 21 existing Quills portal page modules,
their shared shell, forms, and states. Baseline: `ff82d669`.

## Reference evidence

Inspected the public feedback home, post detail, help home, help article, and
updates pages in Stagehand Chromium:

- [UserJot feedback](https://feedback.userjot.com/), [help](https://feedback.userjot.com/help), [updates](https://feedback.userjot.com/updates).
- [Featurebase feedback](https://feedback.featurebase.app/), [help](https://help.featurebase.app/), [updates](https://feedback.featurebase.app/changelog).

Both products keep navigation compact, make feedback submission easy to find,
pair voting with each post, and separate metadata from the main reading area.
UserJot uses a quiet left sidebar and compact rows. Featurebase adds prominent
filtering and search. Their help collections expose descriptions and article
counts; updates separate dates from article content on larger screens.

The chosen layout combines those established patterns with Quills branding and
its existing information architecture. This is UI and interaction parity for
existing features, not a claim of complete feature parity with either product.
Private competitor account/support screens were not inspected.

## Findings and implementation

| Surface | Before | Applied pattern |
| --- | --- | --- |
| Shared shell | Inconsistent spacing and weak section navigation | Compact centered navigation, current-section state, consistent widths, mobile wrapping, scoped branding |
| Feedback home | Read-only vote-looking decoration; no feed filters | Shared actionable vote/unvote, search, stage and sort selects, pagination, board sidebar and submission prompt |
| Feedback board | Native controls and a repeated generic heading | Shared shadcn selects, actual board title, sidebar, compact post rows and submission sheet |
| Submit feedback | Board selection unreliable; sheet content lacked its panel | Controlled Select through React Hook Form, first available board default, SheetPanel for scrolling and padding |
| Post detail | Generic heading repeated above the post title | Actual post title as the page heading, board return link, readable content, compact vote action and existing comment/edit/delete controls |
| Help home and locale | Plain category links and duplicated headings | Actual homepage title, search with Enter submission, Card collections showing descriptions and article counts |
| Help category and article | Generic page title repeated above content | Actual content title, clear article lists, readable text and related/back navigation |
| Updates and entry | Date mixed into the reading column; repeated entry title | Desktop date column, mobile stacked layout, actual entry heading, existing linked-feedback navigation |
| Preferences and profile | Styled imitation switches and inconsistent fields | Real Switch controls, Field labels, grouped forms, consistent profile Card |
| Support, tickets and conversation | Loose lists/forms and weak message hierarchy | Shared fields/buttons, compact list cards, distinct message bubbles, readable reply form |
| Status and incident | Flat content hierarchy | Grouped overview/history sections, clear incident heading and update timeline |
| Invite, unsubscribe, CSAT, OAuth result | Inconsistent action/result presentation | Shared Button, Select, Alert, Empty, Spinner and result Card treatment; explicit confirmation and token handling retained |
| Legacy help redirect | No standalone visual surface | Existing redirect behavior retained; destination uses the new help presentation |

## Shadcn pass

Applied the [official shadcn skill](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/SKILL.md)
and component documentation after comparing the references. The checkout's actual
shared components use Base UI/coss; its older `components.json` metadata is not
grounds to replace working global primitives with Radix components.

- Reused existing Select, Switch, Checkbox, Field, Fieldset, Input, Textarea,
  Button, Sheet, Card, Alert, Empty and Spinner components.
- Select content uses Group and Item, with controlled values and accessible labels.
- Kept keyboard support, pending/disabled states, error recovery and reverse actions.
- Used semantic theme tokens; added no dependency or CSS file.
- Shared feedback components are demonstrated in the development kit gallery.
- Narrow conformance exceptions document type-only DTO sharing and read-only GET
  search forms. Mutating forms still use PortalForm and its frame/double-submit guards.

## Original presentation-pass boundary

All data remains in the existing Kaneo/Quills ownership model. This change adds no
API route, schema, tenancy, authentication, membership or permission model.
Feedback home uses existing workspace/viewer-scoped query and vote hooks. Voting
availability comes from each board's API capability; the API still authorizes the
mutation. Post data is loaded only after portal access is granted. Confirmation,
frame refusal, token removal and safe sign-in return paths remain in place.

## Original presentation-pass acceptance

Validation commands: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @kaneo/web test`,
`pnpm --filter @kaneo/web build`, and `node scripts/quills-web/cli.mjs check`.
Browser checks use the repository Stagehand Chromium harness against the local
built web and real API. The custom-palette check changes only the config response
in an isolated browser fixture; it does not change workspace settings.
Local browser data is synthetic; no production data or credentials are used.
Screenshots demonstrate local built-web behavior, not a deployed release.

## Added feature parity

The follow-up from `8d3fcb56` closes the roadmap, editor attachment, discovery,
and help navigation gaps identified above. Reference behavior was checked against
[UserJot planning](https://feedback.userjot.com/help/articles/plan-work) and
[Featurebase roadmaps](https://feedback.featurebase.app/en/help/articles/8609319-roadmaps-overview).

- Public Roadmap navigation now opens real column or date-based roadmaps, with a
  roadmap selector, URL search/sort and independently paginated columns. Cards
  link to their existing feedback details and show status, dates and engagement.
- Help home, locale, collection and article views share a persistent collection
  sidebar. The current collection expands its articles; mobile uses a labelled
  shadcn Sheet. All links come from visibility-filtered API responses.
- Home and board filters persist in shareable URLs. Similar requests in the
  composer link to the existing post without discarding the draft. Post detail
  exposes follow/unfollow using the existing subscription endpoint.
- Post and comment create/edit forms share a Markdown toolbar and preview, file
  selection, removal and pending/error states. Real uploads use the existing
  managed storage provider; saved files open an authorized preview/download Sheet.
  A failed PUT obtains a fresh signed URL on retry, and successful uploads are
  reused when registration must retry.

### Attachment ownership and lifecycle

Kaneo `public` still owns accounts, sessions and workspaces. Quills `files`,
`posts`, `post_comments` and existing customer principals own the feedback data.
Workspace and actor IDs come from the authenticated portal context. A preparation
route creates the canonical customer profile before upload signing; it does not
create another authentication or membership model.

Migration `0023_cynical_jocasta.sql` adds nullable post/comment relationships to
`quills.files`, tenant-composite foreign keys, indexes and a single-parent check.
It preserves existing file rows and the separate Quills migration history.
Migration `0025_defer_feedback_attachment_parents.sql` makes these parent checks
deferrable for workspace archive import, matching the existing import contract.
The no-op `0024` is retained because the local test runner applied its generated
placeholder before the SQL was filled in; its original applied checksum is preserved.
Attachment claims lock files in stable order, require the current owner and a
live portal upload, and commit with the parent mutation and its audit/outbox.
Mixed unauthorized batches roll back. Downloads recheck the persisted parent,
board visibility, moderation and comment deletion before signing a URL; responses
contain only attachment metadata and the short-lived URL.

Removing an attachment deletes its file reference through the existing cleanup
trigger. Unattached registered portal drafts expire after one day. Soft-deleted
parents deny downloads; hard parent deletion cascades references into cleanup.
Storage keys, shared reference probes, workspace deletion and verification leases
continue through the existing shared storage lifecycle. This does not add a bucket
sweeper for an upload abandoned before it is registered. Existing signed download
URLs remain usable until their normal expiry.

The official shadcn skill was applied to the new Card, Select, Sheet, Button,
Field and editor controls, using the existing Base UI/coss components. No new UI
dependency was added. A narrow C11 exception in post metadata explains that upload
operations are composed by the shared attachment hook rather than the page module.

## Previous presentation-pass evidence

The review and verification below describe the preceding `8d3fcb56` presentation
pass. Follow-up feature validation is recorded separately at the end.

## Review verdict

Required lenses: structure, performance, chaos, QA, lean, and TypeScript/React.
The TypeScript specialist was included for Base UI controlled-component contracts
and TanStack query/router behavior. Code Review Graph was not used, as requested.

All verified findings were repaired:

- Board search stays mounted and focused through deferred requests and errors.
- Feed votes serialize; the active row retains its error and explicit retry action.
- Home feed uses the route-prefetched ten-post request.
- Portalled selects and sheets carry scoped branding without changing the host.
- Dynamic titles update the browser title without stealing focus from drafts.
- Create, edit and confirmation sheets use the scrollable panel.
- Header sign-in preserves search/ordinary anchors and strips mail-link tokens.
- Home and board share one board-navigation component, addressing the lean finding
  (`net: -35 lines possible` in the review estimate).

QA and TypeScript follow-up reviews confirmed their repairs with no remaining
verified findings. No finding was dismissed or downgraded to avoid a repair.
Browser checks additionally found and repaired dark-mode contrast for selected
board counts, stage values and error text, plus a gap in the tap area of wrapped
post titles.


## Final verification

- Full web suite: **586 files / 2,728 tests passed**.
- Focused portal/core/UI suite: **73 files / 328 tests passed**.
- Repository typecheck: **30/30 tasks successful**.
- Repository lint/format, portal C1–C23 conformance and `git diff --check`: passed.
- Production web build: passed. Existing large-chunk warnings remain.
- Stagehand: **88 audits** covering 22 routes/states at 1440px and 375px, in light
  and dark mode. Zero WCAG 2 A/AA and 2.1 AA axe violations, horizontal overflows,
  incorrect themes, or duplicate/missing main and h1 landmarks.
- Browser interactions: board Select inside Sheet; sort; keyboard stage selection;
  home/board search; vote/unvote with original state restored; subscription Switch
  on/off with original state restored; help search submitted with Enter.
- Custom palette: standalone Select, Sheet and nested Select preserved workspace
  colors while the host document stayed unchanged. Only the config response used
  a fixture for this isolated check; the remaining API requests were real.
- At 375x812, the real API flow created a long post, edited/saved it, created and
  edited/saved a long comment, then deleted the comment and temporary test post.
  The wrapped-title tap area was verified in this flow.

Local evidence files: `/tmp/quills-parity-browser-audit.json`,
`/tmp/quills-parity-expanded-browser.log`, `/tmp/quills-parity-theme.log`,
`/tmp/quills-parity-long-edit.log`, `/tmp/quills-parity-final-all-web.log`,
`/tmp/quills-parity-final-repo-types.log`, `/tmp/quills-parity-final-build.log`
and `/tmp/quills-parity-final-lint.log`. Screenshots follow
`/tmp/quills-parity-{page}-{light|dark}-{1440|375}.png`.

Invite, unsubscribe and CSAT were included in the visual matrix in their missing
or invalid credential states; OAuth used its failure state. Their successful
mail-token flows were verified in the prior RFC implementation and were not
repeated in this presentation pass. This run used local Chromium, not a hosted
release, Safari or Firefox. No API/schema behavior changed, so the API integration
suite was not repeated.

**Ship** for this UI parity pass: required checks pass and all verified review
findings are repaired. No push or deployment is included.

## Feature follow-up validation

This follow-up changes both API and web boundaries; the original presentation-only
API exemption above does not apply. Validation uses local synthetic data only.

- Repository typecheck: 30/30 tasks successful.
- Repository lint/format and portal C1–C23 conformance: passed.
- Full web suite: 614 files / 2,812 tests passed. After the submission-key addition,
  the affected hook and three form suites passed: 4 files / 24 tests.
- Production web and API bundles: built successfully; existing chunk-size warnings remain.
- Stagehand: 20 roadmap/help audits at 1440px and 375px, light and dark, with no
  WCAG 2 A/AA or 2.1 AA violations and no horizontal overflow. The settled mobile
  help navigation Sheet passed an additional accessibility audit.
- Real API/storage browser flows: roadmap selection, date buckets, URL search
  across reloads, help navigation, Markdown preview, post/comment file upload,
  download, edit/removal, follow/unfollow and deletion. A real PNG upload decoded
  in the attachment preview. Temporary browser posts/comments were cleaned up.
- Focused PostgreSQL regressions cover foreign and mixed file batches, parent
  visibility, concurrent claims, deleted comments, tenant FKs and draft retention.
  Route contracts cover the new preparation/download/discard endpoints.

Evidence: `/tmp/quills-extension-all-web.log`,
`/tmp/quills-extension-draft-tests.log`, `/tmp/quills-extension-final-types.log`,
`/tmp/quills-extension-final-lint.log`, `/tmp/quills-extension-conformance.log`,
`/tmp/quills-extension-build.log`, `/tmp/quills-extension-browser-audit.json`,
`/tmp/quills-extension-browser.log`, `/tmp/quills-extension-image.log` and
`/tmp/quills-extension-cleanup.log`. Screenshots use
`/tmp/quills-extension-{page}-{light|dark}-{1440|375}.png`.

This is local Chromium evidence. Hosted release, non-Chromium rendering and
production-volume migration locking were not tested. Deployments must apply the
forward migration and configure the existing managed storage provider.

### API verification details

`pnpm --filter @kaneo/api test:quills` ran all 105 suites. The first 65 passed
(1,478 tests); 40 later suites were blocked when the running test process picked
up a generated custom migration before its SQL was populated. The applied
placeholder was restored byte-for-byte and the actual change moved to forward
migration `0025`; the migration ledger was not altered.

All 40 blocked suites plus completion, migration/integration and feedback tests
were rerun: 41 suites passed, with four five-second timing failures in the two
remaining suites. Those two suites then passed unchanged in isolation (16 tests).
All 105 suites are covered across the full run and these reruns; this was not a
single green full-suite execution. No blocked/skipped database test is counted as
passing. The added transfer case imports both post and comment file relationships,
including the dry-run rollback, and the attachment replay regression passed.

Evidence: `/tmp/quills-extension-all-api.log`,
`/tmp/quills-extension-api-recheck.log`,
`/tmp/quills-extension-api-timing-recheck.log`,
`/tmp/quills-extension-transfer-types.log` and
`/tmp/quills-extension-api-build.log`.

### Feature follow-up review

All six required lenses ran: structure, performance, chaos, QA, lean and
TypeScript/React. The specialist was selected for the React, Base UI and TanStack
contracts. Code Review Graph was not used, as requested. Lean found no removable
layer or dependency (`Lean already`).

Verified findings and repairs:

- Plain-HTTP origins: draft keys use `crypto.getRandomValues`; a regression removes
  the secure-context-only UUID API.
- Long feedback searches: the shared setter clamps both state and navigation to
  200 characters; tests validate the result through both real route schemas.
- ETA month boundaries: card labels use UTC, matching roadmap bucket generation.
- Upload errors: PortalForm preserves recognized permission, authentication and
  rate-limit problems; the 429 regression retains the draft and retry countdown.
- Long date roadmaps: only three periods load per page, with previous/next actions
  and debounced search. A 102-period fixture verifies four initial requests.
- Draft retention: the live-file predicate matches the existing unattached-file
  partial index. Index choice still depends on actual database statistics.

Structure, chaos and performance reviewers confirmed their repairs. QA's search
finding was confirmed and repaired against the actual route validators. The
TypeScript and lean lenses had no additional findings. No verified finding was
waived or downgraded to avoid a repair. The focused repair suite passed 17 files /
48 tests; final rebuilt-browser and broad-suite results follow in the evidence logs.

The post-review API rerun passed both focused suites (32 tests), including the
archive import and live-draft retention checks. A concurrent attempt had hit
five-second test limits and cascading assertions; the unchanged isolated rerun
resolved these without increasing a timeout. The final browser run passed the
20-page/state matrix and upload/comment/removal/follow flows with the UUID method
disabled in a browser capability fixture, and verified a 201-character input is
kept at 200 characters in both the input and URL. The final mobile Sheet audit
passed, with no temporary test posts remaining. The repaired web typecheck passed
all four tasks. See `/tmp/quills-extension-final-api-isolated.log`,
`/tmp/quills-extension-final-browser.log`, `/tmp/quills-extension-final-help.log`
and `/tmp/quills-extension-final-web-types.log`.

Final full web verification passed **615 files / 2,819 tests** with four workers,
including the regression that clears a successful comment and gives the next
submission a fresh key. The pre-PR repository typecheck passed **30/30 tasks**;
repository lint/format and `git diff --check` also passed. Evidence:
`/tmp/quills-extension-final-all-web.log`, `/tmp/quills-resume-comment-tests.log`,
`/tmp/quills-pr-typecheck.log` and `/tmp/quills-extension-final-lint.log`.
