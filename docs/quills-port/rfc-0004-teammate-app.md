# RFC 0004: the Quills teammate app

Status: accepted (2026-11-14). Owner: lane Z.

## 1. Summary

Kaneo keeps one UI for project work. Quills (feedback and support) gets its own teammate app at
`/feedback/{workspaceId}`, with its own shell. The layout follows the Plain support app as a
functional benchmark only: no Plain code, text or images are copied.

The first version covers the feedback work of RFC 0003 and the support inbox (conversations and
tickets). The teammate API for both exists, so this RFC is mostly web work.

## 2. Decisions

1. **URL.** The app lives at `/feedback/{workspaceId}/...` under `_layout/_authenticated`. It does
   not use Kaneo's `WorkspaceLayout`, so Kaneo's sidebar is not shown. The old
   `/dashboard/workspace/{workspaceId}/quills/...` paths redirect to the same sub-path. Kaneo's
   sidebar entry opens the app.
2. **Shell.** It has three parts:
   - an icon rail on the left with the sections and, at the bottom, "Back to Kaneo" and the account;
   - a section nav column with the views of the current section, each with a count, and a
     collapsible "Browse" group;
   - a main panel with a header (title, Filters `F`, Display `V`), status tabs and a grouped list.
3. **Detail.** An item opens in three panes: a compact list, the item (header with status and
   assignee pickers, the thread, a floating action bar with Reply `R` and Note `N`), and a
   properties panel. `J`/`K` and the arrow keys move between items, and `Esc` goes back to the
   list. Shortcuts do nothing while focus is in a text field.
4. **Sections in version 1.**
   - Support: My conversations, All conversations, Unassigned, Tickets, and pinned conversation
     views.
   - Feedback: Inbox (posts by status), Triage, Duplicates, Autopilot, and Browse by board.
   - Insights: Insights, Surveys.
   - Changelog.
   - Settings: boards and voting, segments, task sync.
5. **Data.** Lanes use the existing teammate routes. A lane that finds a real gap (for example
   the nav counts) adds one teammate route under the `apps/api/AGENTS.md` contract and reports
   it. Lanes add no migrations.
6. **Standards.** Pages come from the quills-web CLI with the `teammate` audience, pass
   conformance (200-line files, static i18n keys, `TeamStateView`) and keep loading, empty and
   error states. Lists refresh through the existing team cache and WebSocket hooks.
7. **Small screens.** Below `md`, the rail becomes a top bar and the panes stack: list, then item.
   The properties panel opens as a sheet.
8. **Accessibility.** Landmarks for rail, nav and main; `aria-current` on the active view;
   visible focus; every shortcut has a button.

## 3. Local stack

`pnpm dev:demo` starts a seeded local stack for tests and demos:

1. A dedicated PostgreSQL container (pgvector image, its own volume and port). It does not use
   any other database.
2. The Kaneo and Quills migrations.
3. The portal showcase seed, extended with support and RFC 0003 data: conversations, tickets,
   feedback signals, surveys with responses, scored posts, segments, changelog reactions.
4. The API and the web app, with the sign-in details of the demo teammate and customer printed.
5. AI through OpenRouter when `~/.config/kaneo/quills-ai.env` holds `QUILLS_AI_API_KEY`. The
   command never prints the key.

`pnpm dev:demo --reset` drops and reseeds the demo data.

## 4. Lanes and file ownership

| Lane | Work | Owns |
|---|---|---|
| S | Shell, routes, redirects, list and detail primitives, nav counts | `apps/web/src/quills/team/**`, `apps/web/src/quills/ui/inbox/**`, `apps/web/src/routes/_layout/_authenticated/feedback/**`, the old quills route folder |
| D | `pnpm dev:demo` and the extended seed | `scripts/dev-demo/**`, `apps/api/src/quills/dev/**`, root `package.json` script |
| P | Feedback inbox and post detail | `apps/web/src/quills/pages/team-posts/**`, `team-post/**` |
| C | Conversations inbox, detail and pinned views | `pages/team-conversations/**`, `team-conversation/**` |
| T | Tickets inbox and detail | `pages/team-tickets/**`, `team-ticket/**` |
| R | RFC 0003 pages in the new shell: triage, duplicates, autopilot, insights, surveys, changelog, settings | the existing `pages/team-*/**` of RFC 0003 |

Shared files take additive edits only: `apps/web/src/quills/team/nav.ts`, the i18n index,
`seams.json`, `openapi.json`, `routeTree.gen.ts`. Lane Z merges and regenerates them.

Order: S and D run first and in parallel. P, C, T and R start from the merged shell.

## 5. Completion

A lane is done when its pages work in the new shell with loading, empty and error states, its
tests pass (web, and API tests under a real database for any new route), conformance and lint
pass, and the review team finds no blocking issue.

## 6. Status

| Lane | Status |
|---|---|
| S | planned |
| D | planned |
| P | planned |
| C | planned |
| T | planned |
| R | planned |
