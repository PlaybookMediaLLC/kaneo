# Delivery milestones

This is a dependency-ordered roadmap for a feedback-to-implementation product for **independent software founders**. No dates or automatic delivery commitments are implied. The GitHub links below are **milestone tracking issues**; they are **not** native GitHub Milestone records.

## Roadmap

| ID | Milestone | Tracker | Dependency | Exit condition |
| --- | --- | --- | --- | --- |
| M0 | Repository foundation and upstream boundaries | [#6](https://github.com/PlaybookMediaLLC/kaneo/issues/6) | None | Docs, directory ownership, license/brand rules and upstream policy approved |
| M1 | Customer feedback capture and public experience | [#7](https://github.com/PlaybookMediaLLC/kaneo/issues/7) | M0 | Portal/widget submit requests securely, with votes/comments and abuse protections |
| M2 | Triage, decisions, and Kaneo task linkage | [#8](https://github.com/PlaybookMediaLLC/kaneo/issues/8) | M1 | Founder reviews feedback and links it to canonical Kaneo tasks without losing evidence |
| M3 | GitHub handoff and unmodified Orchestrator intake | [#9](https://github.com/PlaybookMediaLLC/kaneo/issues/9) | M2 | Founder approval creates one actionable GitHub issue; configured Orchestrator can discover it without source modifications |
| M4 | Feedback-aware MCP and API integrations | [#10](https://github.com/PlaybookMediaLLC/kaneo/issues/10) | M2 (M3 for end-to-end) | Claude Code and other authorized clients can read context and propose work without credential sharing |
| M5 | Verified releases and customer close-the-loop | [#11](https://github.com/PlaybookMediaLLC/kaneo/issues/11) | M3 | Deployment/release evidence supports changelog and requester notifications |
| M6 | Founder onboarding, brand, and launch readiness | [#12](https://github.com/PlaybookMediaLLC/kaneo/issues/12) | M1–M5 | Founder completes full workflow safely with documented setup and passing validation |
| M7 | Optional direct runner bridge and managed execution | [#13](https://github.com/PlaybookMediaLLC/kaneo/issues/13) | M3–M6 and demand | Only if needed: outbound-only runner, live session controls and/or bounded cloud execution |

## Sequencing

M0 creates only source-layout documentation. M1 and M2 provide value without agents. M3 ships the lowest-maintenance automation path: **Kaneo-approved work -> GitHub issue -> official, locally installed Orchestrator**. M4 adds richer MCP/API access to feedback; it does not require a bespoke coding model. M5 only calls a feature *released* after deployment or explicit founder verification. M6 tests the complete founder journey. M7 is intentionally deferred and is **not** required for launch.

Keep the original Kaneo project-management engine upstream-owned. Do not begin by rebuilding its backlog, boards, tasks, roles, comments, or existing GitHub sync. Do not patch Orchestrator. Read [architecture](../architecture.md) and [upstream policy](../upstream-policy.md) before starting any milestone.

## Definition of done for future implementation PRs

Each feature PR must document its owner boundary and APIs, authorization and tenancy behavior, schema migrations if any, tests (unit/integration/browser as appropriate), migration/rollback considerations, upstream compatibility, and direct evidence for the customer-visible behavior. A passing test suite is necessary but not sufficient to claim a customer-facing release.

No implementation has been attempted as part of this scaffold.
