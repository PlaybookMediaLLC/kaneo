---
name: pr-video-evidence
description: >
  Use for every implementation task, feature, bug fix, refactor,
  and pull request, including subsequent review corrections.
  Produce narrated video evidence of the actual implementation,
  with visual annotations, passing assertions, synchronized
  captions, and playable Capy attachments before declaring
  work complete or marking a pull request ready for review.
---

# Narrated PR Video Evidence

## 1. Objective

Enable asynchronous engineering review without requiring the
reviewer to check out branches, start applications, reproduce
workflows, or manually verify every implementation.
Every applicable implementation must be accompanied by a
concise, narrated, visually annotated recording that demonstrates
the actual working functionality.
The reviewer should be able to inspect the code, watch the
recording, annotate specific video frames in Capy, submit
feedback, and review a corrected implementation.
This is a mandatory engineering verification workflow,
not a marketing video production workflow.

## 2. When to execute

Execute this skill:

- Before marking any pull request ready for review.
- Before reporting an implementation as complete.
- After implementing a feature or fixing a bug.
- After addressing pull request review comments.
- After receiving visual annotations or feedback in Capy.
- After changes that invalidate previous verification evidence.

Execute automatically, even when the user has not explicitly
requested a recording, demonstration, or verification.
Do not wait for the reviewer to request evidence.

## 3. Understand the implementation

Before recording:

1. Read the original task and acceptance criteria.
2. Inspect the implementation and relevant code changes.
3. Identify every affected user-facing workflow.
4. Identify relevant backend behavior and side effects.
5. Identify important edge cases and failure states.
6. Determine what observable evidence would demonstrate
   that each acceptance criterion has been satisfied.

Create a verification plan mapping acceptance criteria
to tests, browser actions, and observable results.
Do not merely demonstrate the happy path when the change
also affects permissions, validation, financial calculations,
error handling, or data persistence.

## 4. Prepare the verification environment

Use the actual implementation from the current branch.

- Start the required application and dependent services.
- Use the repository's established setup and seed scripts.
- Use isolated, deterministic test fixtures.
- Authenticate using approved test accounts.
- Verify the application is healthy before recording.
- Use fictional or sanitized customer and financial data.
- Prevent real payments, customer messages, emails,
  notifications, or other external side effects.

Never bypass authentication, permissions, or application
validation to make a demonstration succeed.
Never substitute a mock interface for a working application.
If environment setup fails, investigate and resolve the
failure where possible. Otherwise, report the exact blocker.

## 5. Execute automated verification

Run all applicable repository-mandated checks, including:

- Type checking.
- Linting.
- Unit tests.
- Integration tests.
- Contract tests.
- End-to-end tests.
- Security and authorization checks.
- Financial correctness checks.

Reuse existing test infrastructure.
For each demonstrated workflow, assert the expected result
using the application UI, API response, database state,
or another appropriate verification mechanism.
A successful video recording does not replace automated tests.
Never claim a behavior works unless it has been observed
and verified.

## Mandatory independent engineering review

Narrated video evidence must be generated only after the
implementation has passed independent engineering review.
A successful demonstration is not sufficient evidence
of architectural correctness, security, financial accuracy,
maintainability, or production readiness.

### 1. Discover repository-specific reviewers

Before implementation, inspect the repository's:

- AGENTS.md
- CLAUDE.md
- Nested product-specific instruction files
- .claude/agents/
- .claude/skills/
- .claude/prompts/
- .agents/skills/
- Other repository-defined review procedures

Load all applicable repository instructions.
Identify the available review agents, their responsibilities,
their invocation conditions, and the required quality gates.
Reuse existing reviewer definitions rather than replacing
them with generic review prompts.
Current repository and product-specific guardrails take
precedence over outdated assumptions in reviewer definitions.

### 2. Review orchestration

After implementation and initial verification, assemble an
independent review team.
The implementing agent acts as the review coordinator.
Dispatch independent reviewers in parallel where their
responsibilities do not require sequential execution.
Each reviewer must receive:

- Original task and acceptance criteria.
- Base branch and current commit SHA.
- Actual implementation diff.
- Relevant architecture and repository instructions.
- Affected components, callers, and execution paths.
- Existing and newly added tests.
- Initial verification results.
- Known risks and unresolved questions.

Reviewers must inspect the actual source code and tests.
Do not give reviewers only the implementing agent's summary.
They must independently establish whether the implementation
is correct.
Reviewers should initially operate in read-only mode.
The implementing agent coordinates all remediation to
prevent conflicting edits.
Do not recursively dispatch additional review teams from
review-only subagents.

### 3. Mandatory Oppulence Canvas review team

When working in Oppulence Canvas, load and execute the
following core reviewers for every substantive code change.

#### Senior engineering reviewer

Source:
.claude/agents/senior-code-critic.md
Responsibilities:

- Implementation correctness.
- Architectural integrity.
- Maintainability.
- Security.
- Performance.
- Error handling.
- Concurrency and race conditions.
- Test quality and coverage.
- Unnecessary complexity.

Require a critical assessment with concrete findings
and a merge recommendation.

#### Structural and blast-radius reviewer

Source:
.claude/skills/review-changes/SKILL.md
Use the code-review-graph MCP integration.
Begin with get_minimal_context_tool and follow the
repository's graph-first review policy.
Inspect:

- Risk-scored changed functions.
- Callers and callees.
- Affected execution flows.
- Shared dependencies.
- Impact radius.
- Existing test coverage.
- Untested high-risk behavior.

Use targeted source inspection to verify graph findings.
If the graph integration is unavailable, explicitly report
the limitation and use targeted source-based impact analysis.
Never fabricate graph results.

#### Simplicity and production-quality reviewer

Source:
.claude/skills/ponytail-review/SKILL.md
Evaluate the implementation in the following order:

1. Correctness.
2. Safety.
3. Behavior under expected production load.
4. Adequate testing.
5. Performance.
6. Simplicity.

Identify unnecessary abstractions, duplicated code,
unnecessary dependencies, speculative functionality,
dead code, and maintainability problems.
Every finding must include a concrete failure scenario
or a demonstrable unnecessary cost.
Prefer the smallest correction that solves the problem.

### 4. Specialist reviewer selection

Dispatch additional reviewers according to the affected
functionality and the implementation's risk profile.
Do not omit an applicable specialist merely because the
core review team reported no findings.

#### Frontend and React changes

Use:
.claude/agents/nextjs-deep-bug-hunter.md
Inspect runtime failures, React lifecycle behavior,
hydration, asynchronous state, accessibility, rendering,
data fetching, memory leaks, and performance.
For material visual changes, also use:
.claude/agents/premium-ui-architect.md
Evaluate product design consistency, layout, typography,
visual hierarchy, responsive behavior, and interaction quality.

#### API, mutation, and business logic changes

Use:
corinthian/.claude/agents/api-first-enforcer.md
corinthian/.claude/agents/api-standards-enforcer.md
Apply their review procedures to the relevant product
architecture.
Verify:

- API-first architecture.
- Input and output contracts.
- Zod validation.
- Authentication and authorization.
- Tenant isolation.
- Error semantics.
- Side effects.
- Business logic ownership.
- Transaction boundaries.
- Consistency between UI and agent-accessible APIs.

Never apply obsolete authentication or tenant assumptions.
Read the current root and product-specific CLAUDE.md
and inspect the actual API implementation.

#### Security and financial changes

Use the applicable security review prompt:
.claude/prompts/security-review.md
corinthian/.claude/prompts/security-review.md
For changes crossing product boundaries, review both
trust boundaries independently.
Dispatch a dedicated security and financial correctness
reviewer for changes affecting:

- Money movement.
- Payment instructions.
- Invoices and collections.
- Banking and transactions.
- Forecasting and financial calculations.
- Permissions and authorization.
- Tenant-owned data.
- External financial integrations.
- Webhooks.
- Background jobs.
- Data migrations.
- Sensitive information.
- Automated financial actions.

Verify the current repository's financial invariants.
These include:

- Correct monetary units.
- Currency preservation.
- Rounding semantics.
- Tenant isolation.
- Authorization.
- Idempotency.
- Duplicate and retry safety.
- Concurrency.
- Out-of-order events.
- Partial failure.
- Database constraints.
- Transactional correctness.
- Reconciliation.
- Auditability.
- Recovery behavior.

Do not treat passing mock-based tests as proof of
database, transaction, or tenant-isolation correctness.
For high-risk financial behavior, independently verify
the underlying business assumptions.

#### Entitlements and feature gating

Use:
.claude/agents/requirements-gating-architect.md
Verify both server-side and client-side enforcement,
entitlements, onboarding requirements, redirects,
and fail-closed behavior.

#### Code quality remediation

Use:
.claude/agents/deslop-refactor.md
Invoke when the review identifies concrete problems
in code quality, duplication, type safety, or complexity.
Restrict remediation to the affected implementation.
Do not introduce unrelated cleanup or speculative
refactoring.

### 5. Cross-agent compatibility

These review procedures must work regardless of whether
the implementing agent is Claude Code, Codex, Capy,
or another supported coding agent.
When native custom subagent invocation is available,
invoke the repository-defined reviewers directly.
Otherwise, read the applicable reviewer definition and
dispatch an independent subagent using its full review
instructions.
Preserve the reviewer's responsibilities and constraints.
Never claim a reviewer was dispatched when no independent
review occurred.
If independent review is required but unavailable, report
the blocker and keep the implementation in draft.

### 6. Review findings and severity

Require every reviewer to provide structured findings.
Each finding must contain:

- Reviewer identity.
- Finding identifier.
- Severity.
- File path and line numbers.
- Affected behavior.
- Concrete failure scenario.
- Evidence supporting the finding.
- Recommended correction.
- Required verification.

Use the repository's severity definitions.
P0 — Critical:
Potential financial corruption, cross-tenant data exposure,
unauthorized financial actions, credential exposure,
or other critical failures.
P1 — High:
Material correctness, authorization, financial reporting,
reconciliation, or reliability defects.
P2 — Medium:
Recoverable inconsistencies, limited operational failures,
maintainability risks, and meaningful edge cases.
P3 — Low:
Non-critical readability, naming, and cleanup observations.
P0 and P1 findings must block readiness for review.
P2 findings must normally be resolved before merge unless
explicitly accepted by the authorized reviewer.
P3 findings must not distract from higher-risk defects.
Apply stricter repository-specific rules wherever they exist.

### 7. Consolidate and adjudicate findings

The implementing agent must collect all reviewer results
into one consolidated review report.

- Deduplicate overlapping findings.
- Verify findings against actual source code.
- Resolve disagreements using evidence.
- Reject unsupported or speculative findings.
- Identify shared root causes.
- Prioritize corrections by severity.
- Document the justification for rejected findings.

Do not accept a finding merely because a reviewer reported it.
Do not dismiss a finding merely because the implementing
agent disagrees with it.

### 8. Mandatory remediation and re-review

Resolve all blocking findings.
Follow repository testing rules, including test-first
requirements and the prohibition against tautological tests.
After remediation:

1. Rerun the relevant automated tests.
2. Return the corrected implementation to the applicable
   independent reviewers.
3. Require verification that the original findings are resolved.
4. Inspect the remediation for newly introduced defects.
5. Repeat until all blocking findings are closed.

Reviewers must independently verify the actual corrections.
The implementing agent may not close findings solely
through self-certification.
Never weaken tests, validation, authorization, financial
invariants, or quality gates to obtain a passing result.
If review cannot converge, keep the pull request in draft
and report the unresolved findings.

### 9. Final repository quality gates

For Oppulence Canvas, execute the existing ship path:
bun run gauntlet --changed
bun run devx:ship-check --profile=pr
bun run devx:pr-evidence
For P0 financial surfaces, also execute the applicable
financial profile:
bun run devx:ship-check:financial
Run relevant contracts, integration tests, database checks,
and end-to-end verification according to repository policy.
Do not alter the Gauntlet baseline or quality budgets.
Respect the repository's existing hosted CI policy.
Do not introduce unnecessary hosted CI workflows.
Any failed mandatory quality gate blocks readiness
for review.

### 10. Review evidence manifest

Preserve a structured record containing:

- Repository.
- Base branch.
- Reviewed commit SHA.
- Reviewer identities.
- Reviewer source definitions.
- Specialist selection rationale.
- Review scope.
- Findings by severity.
- Corrections applied.
- Findings independently verified as resolved.
- Accepted exceptions and their authorization.
- Outstanding findings.
- Automated verification results.
- Final review recommendation.

Store the report alongside the narrated video evidence.
The report and video must describe the same implementation.

### 11. Narrated video generation

Generate the final narrated recording only after:

- Independent engineering review is complete.
- All blocking findings are resolved.
- Applicable mandatory quality gates pass.
- The final implementation commit is identified.

Include demonstration beats covering important defects
identified and corrected during the review where relevant.
Do not narrate every review finding.
Show the observable behavior necessary for the human
reviewer to verify the corrected implementation.
Attach both the narrated video and the consolidated
engineering review report to the Capy thread.

### 12. Subsequent review iterations

When human feedback results in implementation changes:

- Reassess the change's blast radius.
- Dispatch the core and applicable specialist reviewers.
- Resolve new and previously outstanding findings.
- Rerun required verification.
- Regenerate the narrated video.
- Update the consolidated review report.
- Associate all evidence with the updated commit SHA.

Do not reuse stale review approvals or video evidence.

### 13. Final readiness gate

An implementation must not be declared complete or marked
ready for review until:

- Core review team executed.
- Applicable specialist reviewers executed.
- Review findings consolidated.
- P0 and P1 findings independently verified as resolved.
- P2 findings resolved or explicitly accepted.
- Repository quality gates passed.
- Financial and security invariants verified where applicable.
- Review report attached.
- Narrated video attached where applicable.
- Evidence associated with the current commit.
- Remaining limitations disclosed.

Never merge without explicit authorization.

## 6. Build the demonstration storyboard

Generate a structured storyboard before recording.
Each demonstration beat should identify:

- Acceptance criterion.
- Application route or starting state.
- Browser or terminal action.
- Target element or control.
- Expected result.
- Assertion confirming the result.
- Spoken narration.
- Visual annotation.
- Estimated duration.

Organize the recording around what the reviewer needs to
understand, rather than the sequence in which code was written.
Show the existing problem when useful, followed by the
corrected behavior.
Prioritize evidence over presentation.

## 7. Capture the actual application

For web applications, prefer Playwright and Chromium.
Reuse existing browser fixtures, recording scripts,
authentication utilities, and test helpers.
Prefer high-quality Chrome DevTools Protocol screencasting
when available. Otherwise, use Playwright video recording
or another approved capture mechanism.
Record actual interactions, including relevant:

- Navigation.
- Mouse movement and clicking.
- Form inputs.
- Menu and dialog interactions.
- Data changes.
- Validation messages.
- Loading and success states.
- Error and recovery states.
- Persisted state after navigation or refresh.

Capture the resulting application state after each meaningful
interaction.
Do not record long installation sequences, compilation delays,
irrelevant navigation, or unnecessary waiting.
Do not remove footage that exposes a genuine application
failure in order to present a misleading successful result.

## 8. Visual annotations

Every recording must make it immediately apparent which
part of the interface is being discussed.
Support the following visual treatments:

- Element bounding boxes.
- Animated highlights.
- Visible cursor movement.
- Click indicators.
- Arrows.
- Numbered callouts.
- Restrained camera zooms.
- Spotlights around relevant components.
- Brief explanatory text where necessary.

Derive element coordinates from the actual browser viewport
and Playwright locators wherever possible.
Keep annotations synchronized with the corresponding action
and narration.
Annotations must not obscure important text, controls,
financial values, or application results.
Use consistent, restrained visual styling.
Avoid decorative animations, unnecessary motion, and
excessive zooming.
Preserve an unmodified source recording when practical.

## 9. Spoken narration

Every applicable demonstration must include audible,
intelligible spoken narration.
Prefer an approved local text-to-speech engine, such as
Kokoro, when available.
Reuse existing narration tooling before introducing
additional dependencies.
An approved cloud TTS provider may be used when local
generation is unavailable. Do not introduce paid services
or transmit sensitive data without authorization.
Generate narration as individual segments corresponding
to demonstration beats.
Measure the actual audio duration and synchronize the
recording accordingly.
Narration must explain:

- What changed.
- Why the change was necessary.
- What the user is doing.
- What the application does in response.
- Which acceptance criterion is being demonstrated.
- Relevant edge cases and limitations.

Use direct, natural engineering language.
Do not read every visible interface label aloud.
Do not use promotional language, exaggerated claims,
generic introductions, or unnecessary conclusions.
Example:
"The invoice is already paid. Attempting to send another
payment reminder now leaves the action disabled. The
underlying API also rejects the request, preventing a
duplicate reminder from being sent."
Only use narration like this when both behaviors have
actually been verified.

## 10. Audio and video synchronization

The narration, recorded actions, annotations, cursor
movement, and captions must share a consistent timeline.
Generate or measure narration segments before determining
the final scene durations.
When trimming or removing footage, apply the corresponding
timeline transformation to every affected track.
Ensure:

- Narration describes the currently visible behavior.
- Highlights appear when the relevant element is discussed.
- Captions accurately match the spoken narration.
- Audio is intelligible and free from clipping.
- No narration is truncated.
- There are no unintended silent gaps.
- The recording provides sufficient reading time.

Preserve separate audio and annotation tracks where practical.

## 11. Recording specifications

Default output:

- Container: MP4.
- Video codec: H.264.
- Audio codec: AAC.
- Resolution: 1920 x 1080.
- Frame rate: 30 fps.
- Pixel format: yuv420p.
- Aspect ratio: 16:9.
- Captions: readable, synchronized subtitles.
- Narration: clear spoken voice.
- Background music: none.

Target 30–120 seconds for straightforward changes.
For complex implementations, produce multiple focused
recordings instead of one unnecessarily long video.
Do not enforce an arbitrary duration if it prevents
adequate verification.
Use FFmpeg, Remotion, or existing repository tooling
to compose and encode the recording.
Optimize the output for browser playback and Capy attachment
limits without compromising the readability of the interface.

## 12. Backend and infrastructure implementations

Video evidence is not limited to frontend changes.
For backend, API, database, worker, infrastructure, or
developer-tooling changes, record appropriate observable
behavior through:

- Terminal sessions.
- API requests and responses.
- Database queries and assertions.
- Integration test execution.
- Worker processing.
- Event propagation.
- Observability dashboards.
- Before-and-after performance measurements.
- Error handling and recovery.

Narrate what is being verified and highlight the relevant
outputs.
Redact credentials and sensitive information.
For genuinely non-demonstrable changes, such as certain
documentation-only or mechanical dependency updates,
provide equivalent verification evidence and explicitly
document why a narrated recording is not applicable.
Never silently skip this requirement.

## 13. Evidence integrity

Associate every recording with:

- Repository name.
- Branch name.
- Exact commit SHA.
- Pull request number, if available.
- Capture timestamp.
- Application environment.
- Demonstrated acceptance criteria.
- Test commands.
- Assertion results.
- Relevant routes or endpoints.
- Known limitations.

Generate an evidence manifest containing this metadata.
Recordings must correspond to the exact implementation
being presented for review.
Do not reuse an earlier recording after relevant code,
configuration, or behavior has changed.
Never fabricate test results, screenshots, video footage,
application states, or successful outcomes.
A recording is supporting evidence, not proof of every
property of the implementation.

## 14. Review the recording before delivery

Inspect the generated recording before presenting it.
Verify:

- The file exists and decodes successfully.
- The video and audible audio tracks are present.
- The entire recording is playable.
- The application text is legible.
- Narration and annotations are synchronized.
- Demonstrated outcomes match the actual implementation.
- Required acceptance criteria are covered.
- No credentials or sensitive information are visible.
- The recording belongs to the current commit.
- No unexplained errors or broken interactions are present.

Use media inspection tools such as FFprobe and FFmpeg.
Inspect representative frames at each demonstration beat.
If the recording fails verification, correct the recording
or implementation and regenerate the evidence.
Do not present failed, silent, incomplete, or fabricated
recordings as completed narrated evidence.

## 15. Deliver evidence through Capy

Use Capy's built-in artifact skill and available attachment
mechanism to deliver the actual MP4.
The video must appear as a playable attachment in the
current Capy thread so the reviewer can annotate individual
video frames.
Do not merely provide a filesystem path, terminal output,
or description of a video.
Verify that the artifact was successfully attached.
Include the recording or its authorized, accessible link
in the pull request description.
Do not expose private recordings through public file hosts.
Retain relevant supporting evidence where practical:

- Original recording.
- Narration transcript.
- Captions.
- Annotation metadata.
- Verification manifest.
- Browser trace.
- Important screenshots.
- Test results.

Do not commit large binary evidence files to the application
repository unless explicitly instructed.
If the attachment cannot be delivered, report the blocker
and keep the pull request in draft.

## 16. Pull request evidence summary

Include the following section in every applicable pull
request description:

### Narrated verification

Recording: [Playable demonstration]
Commit: [Exact verified commit SHA]

### Demonstrated behavior

| Acceptance criterion | Timestamp | Verification |
| --- | --- | --- |
| Criterion | 00:00 | Passed |

### Automated checks

List the commands executed and their actual results.

### Known limitations

Document any behavior that was not verified, environmental
limitations, or outstanding concerns.
Keep this summary concise and factual.

## 17. Capy visual feedback loop

When the reviewer submits video annotations:

1. Inspect every annotated frame and associated comment.
2. Retrieve the corresponding recording and commit context.
3. Identify the affected component or implementation.
4. Translate the feedback into concrete acceptance criteria.
5. Implement the requested corrections.
6. Add or update regression tests where appropriate.
7. Rerun all applicable verification.
8. Generate a fresh narrated recording.
9. Attach the updated recording to the same Capy thread.
10. Update the pull request evidence section.
11. Explain which review comments were addressed.

Preserve previous recordings as historical evidence.
Never use an outdated recording to represent corrected
behavior.
Repeat this process for each subsequent review round.

## 18. Oppulence Canvas integration

When working in Oppulence Canvas, inspect and reuse
the existing infrastructure, particularly:

- tooling/local/src/scripts/docs/screencast.ts
- tooling/local/src/scripts/docs/record-eigenn-video.ts
- tooling/local/src/scripts/devx/pr-evidence.ts
- tooling/local/src/scripts/devx/pr-evidence-markdown.ts
- videos/src/manifest.ts
- videos/src/demo.tsx
- videos/render.ts

Follow the repository's current AGENTS.md and DevX
verification requirements.
Reuse existing Playwright fixtures, seeded environments,
Remotion compositions, and FFmpeg utilities.
Use devx:video-evidence if the command has been implemented
and verified. Otherwise, use the available recording
infrastructure.
Do not assume a proposed command already exists.
Keep engineering recordings separate from public marketing
video profiles.
Do not apply marketing-specific scene duration, silence,
branding, or promotional requirements to engineering
verification recordings.
For financial changes, preserve all applicable financial
correctness, authorization, contract, and database checks.

## 19. Failure handling

If any mandatory verification step fails:

- Investigate the failure.
- Fix the underlying issue where appropriate.
- Rerun verification.
- Regenerate the affected evidence.

If the failure cannot be resolved, report:

- The exact blocker.
- The commands attempted.
- The relevant error output.
- What remains unverified.
- The action required to proceed.

Keep the pull request in draft.
Never bypass verification or invent evidence to satisfy
the definition of done.

## 20. Definition of done

An implementation is ready for review only when:

- [ ] Original acceptance criteria are addressed.
- [ ] Applicable automated tests pass.
- [ ] Actual implementation behavior has been verified.
- [ ] Relevant failure states have been examined.
- [ ] Narrated recording has been generated.
- [ ] Visual annotations are accurate.
- [ ] Captions and narration are synchronized.
- [ ] Recording has passed quality inspection.
- [ ] Evidence corresponds to the current commit.
- [ ] Playable recording is attached in Capy.
- [ ] Pull request evidence summary is updated.
- [ ] Limitations are explicitly documented.
- [ ] No sensitive information is exposed.

For changes where video is genuinely inapplicable,
document the justification and equivalent evidence.
Do not mark the implementation complete until all
applicable requirements are satisfied.
Never merge a pull request without explicit authorization.

## 21. Kaneo & Quills repository integration

In `PlaybookMediaLLC/kaneo`, use this repository's isolated DevX verification pipeline in `scripts/pr-video-evidence/`:

1. Start the isolated seeded Kaneo + Quills stack (PostgreSQL on `54480`, Mailpit on `51390/51391`, API on `1390`, Web on `5190`, workspace `quills_portal_demo`):
   ```sh
   pnpm dev:demo
   ```
2. Complete independent engineering review first (core review lenses: `ponytail-review`, `senior-code-critic`, `review-changes`, plus applicable domain checks such as `apps/api/AGENTS.md` Kaneo/Quills boundaries, `review-animations`, Drizzle migrations, and workflow `actionlint`/`zizmor`).
3. Record narrated, visually annotated 1920x1080 @ 30fps H.264/AAC video evidence (local Kokoro TTS Grade-A `af_heart` `fp32` default with sentence breathing pauses and `-16 LUFS` voice mastering; optional `openai` `gpt-4o-mini-tts` fallback) and Playwright trace (`trace.zip`). Write narration in natural, conversational engineering prose (like a calm teammate walking through a screen recording — use contractions and plain spoken phrasing, never stiff robotic templates):
   ```sh
   # Built-in isolated Kaneo board + Quills shared workspace workflow
   pnpm devx:video-evidence --app kaneo --base-url http://127.0.0.1:5190 \
     --reviewer ponytail-review --reviewer senior-code-critic \
     --review-summary "Independent review completed with zero open blockers."

   # Built-in isolated Quills portal workflow
   pnpm devx:video-evidence --app quills --base-url http://127.0.0.1:5190 \
     --reviewer ponytail-review --review-summary "Independent review passed."

   # Custom PR scenario or backend/infra terminal scenario
   pnpm devx:video-evidence --script path/to/scenario.mjs --base-url http://127.0.0.1:5190 \
     --pr 123 --reviewer ponytail-review --review-summary "Independent review passed."
   ```
4. Validate generated evidence locally and embed `evidence.md` in the pull request description:
   ```sh
   pnpm devx:video-evidence:validate --manifest .cache/pr-video-evidence/<run>/evidence.json --allow-local-video
   pnpm devx:video-evidence:validate --pr-body-file .cache/pr-video-evidence/<run>/evidence.md --pr 123 --head-sha "$(git rev-parse HEAD)"
   ```
5. GitHub Actions check `pr-video-evidence` (`.github/workflows/pr-video-evidence.yml`) validates metadata presence, exact commit SHA freshness, assigned PR number, test assertions, independent review attestation, and absence of committed binary media or `trace.zip`.
