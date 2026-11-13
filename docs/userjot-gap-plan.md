# UserJot gap plan

This document lists the UserJot features that the milestones and the GitHub issues do not plan.
UserJot is a functional benchmark only. Do not copy its code, text, trademarks or images.
The parity matrix in [userjot-parity.md](./userjot-parity.md) stays the primary inventory.

## Method

1. The audit date is 2026-11-10.
2. The source is the UserJot sitemap: 292 pages on `userjot.com`, plus `llms.txt` and `llms-full.txt`.
3. The 16 product pages and the pricing page were read for features.
4. The help center index at `feedback.userjot.com/help/llms.txt` was read: 62 article titles and summaries.
5. The 125 blog pages, 45 glossary pages, 44 calculator pages, 40 comparison pages and 20 platform guides were scanned. They are content pages and add no product features.
6. The baseline is the 8 milestones (M0 to M7) and the open issues #6 to #95.
7. Each gap was checked against the issue bodies by keyword.

Limits:

- The help articles were checked by title and summary. The article bodies were not read.
- The REST API reference at `/docs/api` loads in the browser only. It was not read.

## Result

- 5 gaps need a new issue.
- 9 features are partly planned. They need no new issue now.
- 5 items are not product features.

Issues #26 to #55 already cover most of UserJot.
Issues #73, #76, #87, #88, #90 and #95 from the Featurebase audit cover 6 more UserJot features.

## Gaps

| ID | Priority | Milestone | Gap | UserJot source | Related issues |
| --- | --- | --- | --- | --- | --- |
| M1-57 | P2 | M1 | Operator availability, online status, reply time and away replies | `/live-chat-software`, Help: Operators and availability, Away replies | #50, #72 |
| M1-58 | P2 | M1 | Team push and email alerts for conversations and requests | `/`, Help: Conversation notifications, Notification preferences | #39, #50 |
| M1-59 | P2 | M1 | Inbox details: slash commands, reminders, customer profile panel, contact form and email authentication status | `/live-chat-software`, Help: Reply to conversations | #50, #54 |
| M1-60 | P1 | M1 | AI title and board selection when a customer submits feedback | `/in-app-feedback-widget`, `/slack` | #28, #33, #34, #42 |
| M4-04 | P2 | M4 | Conversation tools in REST and MCP, with documented agent routines | `/headless`, `/mcp`, `/grok-bot`, `/openai-dots` | #10, #44, #45, #50 |

## Issue specifications

The issue title format is `[<ID>][<Priority>] <title>`.

### M1-57 — Operator availability, online status, reply time and away replies

- Let each team member set a weekly schedule in their own time zone.
- Show an online mark in the widget only when a team member is online or in their hours.
- Show the usual reply time. Calculate it from past replies, or let the founder set it.
- Send one away note when a conversation waits for the team out of hours.
- Do not show a team member's name or schedule to the customer unless the founder permits it.

### M1-58 — Team push and email alerts for conversations and requests

- Send a push alert and an email alert for a new conversation, a customer reply and an assignment.
- Let each team member select the events and the channels in their notification preferences.
- Deliver push alerts through the web app and through `apps/mobile`.
- A single instance must work without a third-party push service. Push is optional.
- Do not put private message text in a push alert unless the team member permits it.

### M1-59 — Inbox details: slash commands, reminders, customer profile panel, contact form and email authentication status

- Add slash commands in the reply editor for common actions, for example assign, snooze and resolve.
- Let a team member set a reminder on a conversation.
- Show a customer panel next to the thread: activity, language, device and location.
- Let the founder ask a visitor for a name or an email before a chat starts, as optional or required. Signed-in customers skip this form.
- Show the SPF, DKIM and DMARC result for each forwarded email.
- Collect device and location data only when the founder turns it on.

### M1-60 — AI title and board selection when a customer submits feedback

- Let the customer write the feedback in their own words.
- Let the AI draft a title and select a board from the real boards of the product.
- Show the draft to the customer or the founder before it is saved. Do not add content that the customer did not write.
- Show similar requests from #33 at the same time, with a vote button.
- Keep a manual form that works when the AI provider is not available.
- Apply the AI provider policy and the cost limits from #23.

### M4-04 — Conversation tools in REST and MCP, with documented agent routines

- Expose the inbox from #50 in REST and MCP: list conversations, read a timeline, reply, add a private note, assign and resolve.
- Add a filter for conversations that wait for the team, and a filter for changes since a time.
- Accept an idempotency key on replies and notes.
- Let an authorized agent vote or file a request as an identified customer by external ID. Record the agent token in the audit history.
- Give each agent its own token. A token reaches one workspace only.
- Publish example routines for scheduled agents: draft replies as private notes, file requests from conversations, and draft a changelog entry.
- A private note never reaches the customer. An agent reply needs the permission that #10 requires for sensitive actions.

## Features that are partly planned

| UserJot feature | Related issue | Missing part |
| --- | --- | --- |
| Launcher signals: title of a new update, unread mark, automatic open of a new update | #41, #42, #81 | The automatic open option is not stated. |
| Roadmap "for you" mark on shipped requests that the customer voted for | #37, #42 | The mark is not stated. |
| Changelog media: GIF search, video links, count of shipped requests | #38 | Media-safe rendering is in scope. GIF search and the shipped count are not stated. |
| Board sign-in controls: select the sign-in methods and hide the sign-in button | #18, #87 | Social sign-in is in scope. The control to hide sign-in is not stated. |
| AI agent settings: tone presets, reply length, automatic resolve of quiet threads | #51 | Tone and policies are in scope. The automatic resolve timers are not stated. |
| Search with typo tolerance, quoted phrases and excluded words | #31 | Search is in scope. These operators are not stated. |
| Board languages with right-to-left layout | #40 | Languages are in scope. Right-to-left layout is not stated. |
| AI mapping of CSV columns | #49 | Column mapping is in scope. The AI method is not stated. |
| One workspace for each client, with hand-over of ownership | #12 | Workspaces exist in Kaneo. Ownership transfer is not stated in the feedback issues. |

## Issues for partly planned features

Each row of "Features that are partly planned" gets one issue for its missing part.
The related issue keeps its scope.

| ID | Priority | Milestone | Missing part | Related issues |
| --- | --- | --- | --- | --- |
| M1-67 | P2 | M1 | Launcher announcement and automatic open of a new update | #41, #42, #81 |
| M1-68 | P2 | M1 | Roadmap "for you" mark on shipped requests | #37, #42 |
| M1-69 | P3 | M1 | Changelog media: GIF search, video links and a shipped count | #38 |
| M1-70 | P2 | M1 | Board sign-in controls | #18, #87 |
| M1-71 | P3 | M1 | AI agent style presets and automatic resolve of quiet threads | #51 |
| M1-72 | P2 | M1 | Search with typo tolerance, quoted phrases and excluded words | #31 |
| M1-73 | P2 | M1 | Right-to-left layout for the portal and the widget | #40 |
| M1-74 | P3 | M1 | AI mapping of CSV columns in imports | #49 |
| M6-06 | P3 | M6 | Workspace ownership transfer for agencies | #12 |

### M1-67 — Launcher announcement and automatic open of a new update

- Show the title of a new changelog entry on the widget launcher one time for each customer.
- Keep an unread mark on the launcher until the customer opens the entry.
- Let the founder turn on automatic open of the newest entry on the customer's next visit.
- Show only entries that the customer has access to.

### M1-68 — Roadmap "for you" mark on shipped requests

- In the widget roadmap, mark a shipped request that the signed-in customer voted for.
- Order the widget roadmap as in progress, planned, then shipped.
- Do not show the votes of one customer to a different customer.

### M1-69 — Changelog media: GIF search, video links and a shipped count

- Let the founder paste a video link that the entry shows as an embedded player.
- Let the founder search for a GIF in the editor. This search is optional and off by default, because it uses a third-party service.
- Show the count of requests completed in the last 12 weeks on the public updates page.

### M1-70 — Board sign-in controls

- Let the founder select the sign-in methods that the portal offers.
- Let the founder hide the sign-in button, so that customers enter only from the product through automatic login or single sign-on.
- The API must reject a sign-in method that is off.

### M1-71 — AI agent style presets and automatic resolve of quiet threads

- Add presets for tone, reply length, formality and emoji use.
- Resolve a conversation automatically when the customer is quiet after an AI answer. Use one timer for chat and one for email.
- Never resolve automatically after a team member reply.

### M1-72 — Search with typo tolerance, quoted phrases and excluded words

- Make search accept small spelling errors.
- Support a quoted phrase for an exact match and a minus sign to exclude a word.
- Use PostgreSQL only. Do not add a search service.
- Apply the visibility rules to each result.

### M1-73 — Right-to-left layout for the portal and the widget

- Show the portal, the widget and the emails in a right-to-left layout for right-to-left languages.
- Use CSS logical properties. Test with Arabic.

### M1-74 — AI mapping of CSV columns in imports

- Let the AI suggest a mapping from CSV columns to fields in the import preview of #49.
- The founder confirms or changes each mapping before the import starts.
- Send only the column names and a small sample to the AI provider. Keep the manual mapping when no provider is available.

### M6-06 — Workspace ownership transfer for agencies

- Let a workspace owner transfer ownership to a different member, with a confirmation from the new owner.
- Revoke the API tokens of the old owner on transfer, or show them for review.
- Record the transfer in the admin audit log.
- First check the current Kaneo owner functions. Add only the missing part.

## Items that are not product features

- Pricing plans and plan limits.
- The 44 SaaS calculators under `/tools`.
- The glossary and the blog.
- The 20 guides for website builders. They describe links and embeds that #41 and #42 cover.
- The "Powered by" badge page.

## Created issues

Each new issue is in the native GitHub milestone of the table above.

| ID | Issue |
| --- | --- |
| M1-57 | #103 |
| M1-58 | #104 |
| M1-59 | #105 |
| M1-60 | #106 |
| M4-04 | #107 |

Issues for partly planned features:

| ID | Issue |
| --- | --- |
| M1-67 | #108 |
| M1-68 | #109 |
| M1-69 | #110 |
| M1-70 | #112 |
| M1-71 | #113 |
| M1-72 | #115 |
| M1-73 | #117 |
| M1-74 | #119 |
| M6-06 | #121 |
