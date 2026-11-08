# Upstream maintenance policy

**Purpose:** keep this fork inexpensive to maintain while community-owned Kaneo and Orchestrator continue to evolve.

## 1. Kaneo is the project-management engine

- Parent repository: https://github.com/usekaneo/kaneo
- Fork: https://github.com/PlaybookMediaLLC/kaneo
- Default integration branch in the fork: `develop` (protected).
- Preserve upstream's task models, authentication, project boards, REST/MCP, database conventions and integrations wherever possible.
- Add feedback-specific code in new, Playbook-owned modules. Make the minimal registration/navigation changes needed to expose it.
- Do not replace the upstream design system, rename internal source identifiers en masse or rewrite workflows simply for cosmetic consistency.

**Update process:** review upstream commits regularly; open a sync branch/PR against `develop`; reconcile actual conflicts; run migration, unit, integration, browser, security and workflow checks; merge after review. No automatic force-push, reset or unattended merge.

Upstream CI may rely on Blacksmith runners unavailable in this fork. Keep a compatible GitHub-hosted CI adaptation rather than blindly copying runner-specific assumptions. New upstream workflows and new package versions still need review.

## 2. Orchestrator is an external execution dependency

- Source: https://github.com/OrchestratorInc/agent-orchestrator
- Use the **unmodified official application** first. Founders install it independently and authenticate their coding CLIs themselves.
- Integrate through GitHub issues, repository events, documented CLI/API interfaces and MCP; do not patch the Go daemon or Electron UI.
- `vendor/orchestrator` is a **README-only placeholder**, not a submodule. If a source pin is needed for tests, remove that placeholder directory before adding a Git submodule with the same path; then pin a reviewed release/commit.
- Submodule updates modify a Git pointer, not the customer's installed app. Official client downloads and compatibility checks need their own documentation.
- Orchestrator's separate/private hosted cloud components are **not** part of the public source available for redistribution.
- Orchestrator's local primary HTTP API must never be exposed as a public web endpoint.

## 3. Branding and provenance

Use an original brand and assets for the Playbook-owned site and feedback widget. Don't replace Orchestrator's logo while asserting its source is unchanged. If a branded desktop installer is ever required, that constitutes a downstream distribution/customization project and needs explicit scope, trademark review, licensing review and extra compatibility testing.

Retain required copyright and license notices. Consult [attribution](attribution.md).

## 4. Update automation (planned only)

- `upstream-kaneo.yml`: would detect a new Kaneo upstream revision and create a reviewable update PR.
- `upstream-orchestrator.yml`: would monitor compatible Orchestrator releases/source pins, not modify the runtime or install it for customers.
- `integration-tests.yml`: would validate agreed API, issue-intake and feedback handoffs.
- `release.yml`: **already exists** in Kaneo; do not overwrite it with a placeholder.

No new workflow YAML or automation is implemented by this scaffold. Upstream compatibility is a release gate, not a claim that every upstream release is compatible.

## 5. Review checklist

Before accepting any upstream update: preserve fork-only files; inspect API/schema changes; inspect migration safety; check GitHub/Claude/MCP contracts; inspect security and licensing changes; verify CI runner compatibility; record commit SHAs and test outcomes in the PR. Keep an easy rollback path.
