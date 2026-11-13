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

## Data and permission boundary

All data remains in the existing Kaneo/Quills ownership model. This change adds no
API route, schema, tenancy, authentication, membership or permission model.
Feedback home uses existing workspace/viewer-scoped query and vote hooks. Voting
availability comes from each board's API capability; the API still authorizes the
mutation. Post data is loaded only after portal access is granted. Confirmation,
frame refusal, token removal and safe sign-in return paths remain in place.

## Acceptance evidence

Validation commands: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @kaneo/web test`,
`pnpm --filter @kaneo/web build`, and `node scripts/quills-web/cli.mjs check`.
Browser checks use the repository Stagehand Chromium harness against the local
built web and real API. The custom-palette check changes only the config response
in an isolated browser fixture; it does not change workspace settings.
Local browser data is synthetic; no production data or credentials are used.
Screenshots demonstrate local built-web behavior, not a deployed release.

## Remaining product differences

The references expose additional features such as public roadmaps, richer editor
attachments and other product-specific discovery tools. This pass does not add
unsupported navigation or pretend those backend capabilities exist. Public help
does not yet have the persistent collection sidebar shown by the references;
collection cards and existing back/related links remain its navigation.


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
