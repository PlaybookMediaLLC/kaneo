# Featurebase gap plan

This document lists the Featurebase features that the milestones and the GitHub issues do not plan.
Featurebase is a functional benchmark only. Do not copy its code, text, trademarks or images.

## Method

1. The audit date is 2026-11-10.
2. The source is the Featurebase sitemap: 251 pages on `www.featurebase.app`, plus `llms.txt`.
3. The 62 product, pricing, integration, security and use-case pages were read for features.
4. The 106 comparison pages, 76 customer pages and 7 career pages were scanned. They repeat the product pages and add no features.
5. The baseline is the 8 milestones (M0 to M7) and the 49 open issues (#6 to #55).
6. Each gap was checked against the issue bodies by keyword and against the current Kaneo code.

Recheck:

1. The recheck read the index of `help.featurebase.app`: 479 entries, which are all help article titles and all API reference operations.
2. The recheck found 7 more gaps. The section "Recheck gaps" lists them.
3. `developers.featurebase.app` has no separate index. The help center index contains the API reference.

Limits:

- The help articles were checked by title and summary. The article bodies were not read.
- The blog sitemap was not read. Blog articles are guides, not product pages.

## Result

- 38 gaps need a new issue: 31 from the first audit and 7 from the recheck.
- 11 features are partly planned. They need no new issue now.
- 7 items are not product features for a self-hosted product.

Priority key:

- P1: adds direct value to the founder feedback loop.
- P2: useful breadth for feedback, roadmap and changelog.
- P3: help desk and enterprise breadth. Start only when demand is verified.

## Gaps by milestone

### M1 — Customer feedback and UserJot parity

| ID | Priority | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- |
| M1-31 | P1 | In-app surveys (NPS, CSAT, CES, product-market fit, polls) | `/outbound/surveys`, `/pricing` | #41, #42 |
| M1-32 | P1 | Customer and company segments with custom attributes | `/pricing`, `/customer-feedback`, `/use-cases/roadmaps` | #26, #35 |
| M1-33 | P1 | Custom request fields and submission forms for each board | `/pricing` | #26, #28 |
| M1-34 | P1 | Submit and vote on behalf of a customer | `/pricing`, `/integrations/zendesk` | #28, #30 |
| M1-35 | P1 | AI translation of customer content and multilingual updates | `/customer-feedback`, `/outbound/changelog` | #40 |
| M1-36 | P2 | Multiple roadmaps, custom columns, date view and ETA | `/use-cases/roadmaps` | #37 |
| M1-37 | P2 | Changelog reactions, comments, categories and in-app popup | `/outbound/changelog` | #38, #42 |
| M1-38 | P2 | Portal analytics for boards, roadmap and changelog | `/pricing`, `/outbound/changelog` | #27, #38 |
| M1-39 | P2 | Community features: social sign-in, pinned posts, leaderboard, bans | `/use-cases/community` | #27, #29, #32 |
| M1-40 | P2 | Feedback intake from Intercom, Zendesk and a Discord command | `/integrations/intercom`, `/integrations/zendesk`, `/integrations/discord` | #48, #54 |
| M1-41 | P2 | More importers: Productboard, Frill, Beamer, LaunchNotes, Upvoty, Fider | `/switch`, `/customer-feedback`, `/integrations/other-tools` | #49 |
| M1-42 | P2 | Outbound messages: banners, proactive chats and emails | `/outbound` | #41, #50 |
| M1-43 | P3 | Product tours and tooltips | `/outbound` | #41 |
| M1-44 | P3 | Journeys: automated message flows with waits, branches and split tests | `/outbound` | #39 |
| M1-45 | P3 | Tickets: ticket types, forms, custom statuses and a customer ticket portal | `/help-desk/tickets` | #50 |
| M1-46 | P3 | Support workflows: routing, assignment, SLAs and office hours | `/automation`, `/help-desk` | #50 |
| M1-47 | P3 | More support channels: shared Slack channels, WhatsApp, Microsoft Teams | `/help-desk`, `/integrations/slack` | #47, #50 |
| M1-48 | P3 | Teammate AI Copilot, macros and inbox translation | `/help-desk`, `/pricing` | #50, #51 |
| M1-49 | P3 | AI agent custom actions and answer gap detection | `/ai-agent` | #51 |
| M1-50 | P3 | Support and AI reports: ready-made, custom, scheduled and exported | `/help-desk/reporting` | #50, #51 |
| M1-51 | P3 | Help center: AI search, `llms.txt`, AI translation, multiple help centers | `/help-center` | #53 |
| M1-52 | P3 | API documentation from an OpenAPI file | `/api-documentation` | #53 |

### M2 — Triage and Kaneo task linkage

| ID | Priority | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- |
| M2-01 | P1 | Revenue-aware prioritization and a scoring module | `/pricing`, `/integrations/mcp`, `/customer-feedback` | #8, #35, #46 |
| M2-02 | P2 | CRM sync with HubSpot and Salesforce | `/integrations/hubspot`, `/integrations/salesforce`, `/switch` | #35, #54 |
| M2-03 | P2 | Call transcript intake to triage (Gong, Fathom, Fireflies, Grain, Granola, tl;dv) | `/integrations/gong` and 5 related pages | #36, #46 |

### M3 — GitHub handoff and Orchestrator intake

| ID | Priority | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- |
| M3-01 | P2 | Issue tracker sync for Linear, Jira, ClickUp and Azure DevOps | `/integrations/linear`, `/integrations/jira`, `/integrations/clickup`, `/integrations/azure-devops` | #9 |

### M4 — Feedback-aware MCP and API integrations

| ID | Priority | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- |
| M4-01 | P2 | Zapier app and Segment integration for feedback events | `/integrations/zapier`, `/integrations/segment` | #10, #21, #44 |

### M5 — Verified releases and customer close-the-loop

| ID | Priority | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- |
| M5-01 | P1 | One "send update" action for all channels, with segment and language targets | `/customer-feedback`, `/outbound/changelog`, `/help-desk/tickets` | #11, #38, #39 |

### M6 — Founder onboarding, brand and launch readiness

| ID | Priority | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- |
| M6-01 | P2 | SAML SSO, SCIM, enforced 2FA and portal sign-in through an identity provider | `/enterprise`, `/security`, `/integrations/microsoft-entra-id` | #12, #18 |
| M6-02 | P2 | Custom roles and limited collaborator seats | `/pricing`, `/enterprise` | #12 |
| M6-03 | P2 | White-label controls and a custom email sending domain | `/pricing`, `/integrations/email` | #40 |

### M0 and M7

No gaps. M0 is contracts. M7 is the optional runner bridge, and Featurebase has no equivalent.

## Issue specifications

Each specification gives the scope for one new issue.
The issue title format is `[<ID>][<Priority>] <title>`.

### M1-31 — In-app surveys with targeting, logic and results

- Survey types: NPS, CSAT, customer effort, product-market fit, open question, and an idea poll where each pick is a vote on a request.
- Question types: rating, emoji, multiple choice, text and link. Support multi-step logic that selects the next question from the answer.
- Targeting: customer attributes, company, page URL and time on page. Show the estimated audience size before the survey goes live.
- Frequency: a default 14-day gap between surveys for one person, start and stop dates, and recurring schedules.
- Results: score, seen, answered and dismissed counts, each answer with its customer, CSV export, and read access through REST and MCP.
- Deliver surveys through the widget from #41 and #42.

### M1-32 — Customer and company segments with custom attributes

- Let the founder define custom attributes for customers and companies.
- Let the founder save a segment as a set of attribute rules.
- Use a segment to control access to a board, a roadmap and a changelog entry.
- Use a segment as a filter in triage and in search.
- The API must apply segment access. A hidden control is not an access check.

### M1-33 — Custom request fields and submission forms for each board

- Let the founder add fields to a board: text, number, select, multi-select, checkbox and date.
- Let the founder mark a field as required or as internal.
- Show public fields in the portal form and in the widget form.
- Include custom fields in the REST API, MCP, CSV import and CSV export.

### M1-34 — Submit and vote on behalf of a customer

- Let a team member create a request for an identified customer.
- Let a team member add a vote for an identified customer on an existing request.
- Record the team member, the customer and the source in the audit history.
- Subscribe the customer to status updates only when the notification rules in #39 permit it.

### M1-35 — AI translation of customer content and multilingual updates

- Translate requests and comments for the reader. Keep the source text and show which text is a translation.
- Let the founder write a changelog entry in more than one language. Show each customer the entry in their language.
- Let the founder set protected terms that the translation must not change.
- Apply the AI provider policy and the cost limits from #23.
- #40 covers interface labels only. This issue covers user content.

### M1-36 — Multiple roadmaps, custom columns, date view and ETA

- Let one product have more than one roadmap.
- Let each roadmap select its columns from the status list.
- Add a date-based roadmap type and an optional ETA on a request.
- Set visibility for each roadmap: public, signed-in customers, selected segments, or team only.

### M1-37 — Changelog reactions, comments, categories and in-app popup

- Let customers add emoji reactions and comments to a published changelog entry.
- Apply the moderation rules from #32 to those comments.
- Let the founder define changelog categories, for example New, Improved and Fixed.
- Add a widget popup and a card that announce a new entry to the customer one time.

### M1-38 — Portal analytics for boards, roadmap and changelog

- Count views and unique visitors for the portal, each board, the roadmap and each changelog entry.
- Show the source of each view: public page, widget or email.
- Do not use a third-party tracking service by default. Keep the data in the instance database.
- Do not record private customer data in analytics events.

### M1-39 — Community features: social sign-in, pinned posts, leaderboard and bans

- Let portal customers sign in with Google, GitHub, Discord or Microsoft.
- Let the founder pin a request to the top of a board.
- Show an optional leaderboard of the customers with the most helpful comments.
- Let the founder ban a customer from the portal. Keep the ban reversible and audited.

### M1-40 — Feedback intake from Intercom, Zendesk and a Discord command

- Intercom: let a support agent turn a conversation into a request or a vote.
- Zendesk: let a support agent turn a ticket into a request or a vote for the customer.
- Discord: add a `/feedback` command that sends a submission to a selected board with the Discord user attached.
- Send each submission to moderation and triage. Do not publish it automatically.
- Prevent duplicate requests when a provider sends an event again.

### M1-41 — More importers: Productboard, Frill, Beamer, LaunchNotes, Upvoty and Fider

- Add import adapters for feedback from Productboard, Frill, Upvoty and Fider.
- Add import adapters for changelog entries from Beamer and LaunchNotes.
- Use the preview, mapping, resume and rollback behavior from #49.
- #49 covers CSV, Canny, Nolt and ProductRoad only.

### M1-42 — Outbound messages: banners, proactive chats and emails

- Banner: a message at the top of the customer's app with an optional link.
- Proactive chat: a message from a team member in the widget. A reply opens a conversation in the inbox from #50.
- Outbound email: a message to a targeted audience with unsubscribe by message type.
- Use shared audience rules, schedules, and start and stop dates for all three types.
- Show sent, seen and replied counts for each message.

### M1-43 — Product tours and tooltips

- Let the founder build a step-by-step tour on the live site without code.
- Let the founder attach a tooltip to a page element.
- Show how many customers reach each step and where they stop.
- Deliver tours through the widget SDK from #41.

### M1-44 — Journeys: automated message flows with waits, branches and split tests

- Let the founder combine tours, chats, emails, banners and surveys into one flow.
- Support entry rules, waits, and branches on customer attributes and on customer actions.
- Support a split test with up to five paths and an optional control group.
- Report how many customers start, move through and complete each step.
- This issue depends on M1-31, M1-42 and M1-43.

### M1-45 — Tickets: ticket types, forms, custom statuses and a customer ticket portal

- Let a team member turn a conversation into a ticket. The customer continues in the same thread.
- Let the founder define ticket types. Each type has a form and a set of statuses.
- Group statuses as Under Review, Active, Waiting on customer, and Done.
- Show the customer their tickets in the widget and in the portal. Send an email when the status changes.
- Let a team member link many tickets to one request and update all linked customers in one action.
- A ticket is not a Kaneo task. Keep Kaneo as the project management engine.

### M1-46 — Support workflows: routing, assignment, SLAs and office hours

- Add a workflow builder with triggers, conditions and actions.
- Actions: assign, tag, reply, snooze, apply an SLA, and ask for a rating.
- Assignment: round robin and balanced assignment that skip team members who are away.
- SLAs: targets for first response, next response and time to close. The targets follow office hours.
- A workflow stays a draft until the founder sets it live.

### M1-47 — More support channels: shared Slack channels, WhatsApp and Microsoft Teams

- Shared Slack channels: each customer message becomes a conversation. Replies, reactions, files and edits stay in sync with the thread.
- WhatsApp: receive and reply to messages in the shared inbox.
- Microsoft Teams: receive and reply in channels that are shared with customers.
- Each channel must be optional. A single instance must work with none of them.

### M1-48 — Teammate AI Copilot, macros and inbox translation

- Copilot drafts a reply from help articles, macros and past conversations, and shows its sources.
- Copilot never sends a reply. A team member sends it.
- Macros: saved replies that a team member inserts in a conversation.
- Translation: the team member reads in their language and the customer receives the reply in the customer's language.

### M1-49 — AI agent custom actions and answer gap detection

- Let the founder connect the AI agent to an HTTP API with defined actions (GET, POST, PUT, DELETE).
- Require founder approval for each action definition. Apply the tool policy from #23.
- Show the questions for which the agent had no good answer, with the conversations behind each.
- Let the agent draft an article or a Q&A snippet for a gap. Nothing goes live without approval.
- Let the customer or team member rate an agent answer.

### M1-50 — Support and AI reports: ready-made, custom, scheduled and exported

- Ready-made reports: conversations, response times, SLAs, CSAT, team member performance, tags, tickets and AI agent results.
- Custom reports: charts, filters by attribute, and a layout that the user can change.
- Drill-in: show the conversations behind a number.
- Export to CSV, send a report by email on a schedule, and share a report through a link that expires.

### M1-51 — Help center: AI search, `llms.txt`, AI translation and multiple help centers

- Answer a search question with an AI answer that cites the source articles.
- Serve a Markdown version of each public article and an `llms.txt` index.
- Translate articles with AI and keep protected terms.
- Let one workspace have more than one help center.
- Show article views and reactions.
- #53 covers articles, visibility, version history and article feedback.

### M1-52 — API documentation from an OpenAPI file

- Import an OpenAPI 3.0 or 3.1 file from an upload, a URL or a CI push.
- Make one reference page for each endpoint, next to the help articles.
- Add a request console that sends requests only to the servers that the founder permits.
- Hold spec changes as a draft, list breaking changes, and support rollback.
- Publish more than one API version at the same time.

### M2-01 — Revenue-aware prioritization and a scoring module

- Store revenue for each company, for example monthly spend. Accept the value from the API, a CSV file or a CRM.
- Show the total revenue of the companies that asked for a request.
- Let the founder sort and filter triage by revenue, by vote count and by segment.
- Add a scoring module with founder-defined factors, for example impact and effort.
- Do not show revenue data in a public portal, a public API or a public MCP result.

### M2-02 — CRM sync with HubSpot and Salesforce

- Sync contacts and companies between the CRM and Kaneo customer records in both directions.
- Link a CRM ticket, case, deal or opportunity to a request.
- Use open deal value as an input to M2-01.
- Store tokens encrypted. Do not write tokens to logs.
- The integration must be optional.

### M2-03 — Call transcript intake to triage

- Connect a call recorder with an API key: Gong, Fathom, Fireflies, Grain, Granola or tl;dv.
- Use AI to find feature requests and problems in new transcripts.
- Send each finding to triage with the quote and a link to the call.
- Let the founder link a finding to an existing request or create a new one. Do not publish automatically.
- Apply the AI provider policy and the data retention rules from #23.

### M3-01 — Issue tracker sync for Linear, Jira, ClickUp and Azure DevOps

- Let the founder create or link an external issue from a request.
- Let the founder map external statuses to request statuses. Linear and Jira sync in both directions.
- Notify subscribers through the verified-release rules in M5. A status change alone is not proof of release.
- Kaneo stays the canonical project management engine. This sync is optional for founders who use another tracker.

### M4-01 — Zapier app and Segment integration for feedback events

- Zapier: triggers for a new request, a new comment and a status change. Actions to create a request and a comment.
- Segment: receive customer traits and events. Send feedback activity as events.
- Build both on the REST API from #44 and the event contract from #21.
- Do not send private requests or private customer data to an integration without explicit founder setup.

### M5-01 — One "send update" action for all channels, with segment and language targets

- From a request, let the founder send one update to the request page, the subscribers by email and the linked conversations.
- Show a preview of the recipient count for each channel before the founder sends.
- Let the founder target a release announcement by segment and by language.
- Let the founder post a release update to a customer Slack channel.
- Send only after a verified release or an explicit founder confirmation, as #11 requires.

### M6-01 — SAML SSO, SCIM, enforced 2FA and portal sign-in through an identity provider

- Add SAML 2.0 sign-in for the team. Kaneo has OIDC sign-in now.
- Add SCIM 2.0 to create and remove team members from an identity provider.
- Let an admin require two-factor authentication for all team members. Kaneo has optional two-factor authentication now.
- Let a private portal accept all users that an identity provider verifies, for example a Microsoft Entra ID tenant.

### M6-02 — Custom roles and limited collaborator seats

- Let an admin define a custom role from the permission vocabulary in `packages/permissions`.
- Add a limited collaborator role. This role can read and comment only on the items that a team member shares.
- The API must apply each role. A hidden control is not an access check.
- Do not change the built-in roles.

### M6-03 — White-label controls and a custom email sending domain

- Let the founder send notification emails from their own domain, with SPF and DKIM checks.
- Let the founder remove the product name from the portal, the widget and the emails.
- Let the founder change the widget icon.
- #40 covers the logo, colors and custom portal domain.

## Recheck gaps

The source for these gaps is the help center index at `https://help.featurebase.app/llms.txt`.

| ID | Priority | Milestone | Gap | Featurebase source | Related issues |
| --- | --- | --- | --- | --- | --- |
| M1-53 | P2 | M1 | Custom event tracking and a customer activity timeline | Help: Users, API reference: Events | #35, #69 |
| M1-54 | P3 | M1 | Visitor and lead records with qualification data | Help: Users, Workflows | #35, #50 |
| M1-55 | P3 | M1 | Help desk and help center importers | Help: Documentation, API reference: Helpdesk Imports, `/switch` | #49, #50, #53 |
| M1-56 | P3 | M1 | AI conversation attributes for routing and reports | Help: Help Desk, `/help-desk/reporting` | #50, #51, #72 |
| M2-04 | P2 | M2 | Insights: raw feedback evidence filed under a request | API reference: Posts | #8, #33, #36 |
| M4-02 | P3 | M4 | API access with OIDC workload identity in place of a stored key | Help: API guides | #10, #20, #44 |
| M4-03 | P3 | M4 | Code questions from the inbox to a coding agent, with human approval | `/integrations/cursor` | #10, #50 |

### M1-53 — Custom event tracking and a customer activity timeline

- Accept custom events for a customer through the SDK and the REST API, one event or a batch.
- Show a timeline of events, requests, votes, comments and conversations on the customer record and the company record.
- Let a segment rule use an event, for example "did event X in the last 30 days".
- Set a retention period for events. Do not put private event data in a public response.

### M1-54 — Visitor and lead records with qualification data

- Keep three record types: visitor (not known), lead (gave contact data) and customer (identified by the product).
- Let the founder define the qualification fields that the widget asks a lead for.
- Merge a lead into a customer when the product identifies the person. Do not transfer votes or comments to a different person.
- Let the founder require an email before a visitor starts a conversation.

### M1-55 — Help desk and help center importers

- Import past conversations, customers and companies from Intercom, Zendesk, Freshdesk and Crisp.
- Import a help center from its public URL: articles, collections, images and attachments.
- Keep redirect rules from the old article links to the new articles.
- Map source agents, teams and custom fields before the import starts. Support pause, resume and cancel.
- Use the job model from #49.

### M1-56 — AI conversation attributes for routing and reports

- Let the founder define conversation attributes, for example issue type, urgency and product area.
- Let the AI fill an attribute from the conversation when the founder turns detection on for that attribute.
- Let a workflow condition and a report filter use these attributes.
- Let a team member correct a value. Record that a value came from the AI.
- Apply the AI provider policy and the cost limits from #23.

### M2-04 — Insights: raw feedback evidence filed under a request

- Add an insight record: one piece of customer evidence with its quote, customer, company and source.
- Let the founder file an insight under a request without a new public request.
- Let the founder detach an insight or promote it into a new request.
- Count insights with votes when triage shows demand for a request.
- Insights are team-only. A public portal, API or MCP result does not show them.

### M4-02 — API access with OIDC workload identity in place of a stored key

- Let a server, a function or a CI job call the API with an OIDC token from its platform, for example GitHub Actions.
- Let an admin register a trusted issuer and the permitted subject claims for a workspace.
- Give each trust rule a scope, the same as an API token in #44.
- Reject a token with a wrong issuer, audience, subject or expiry. Record each use in the audit history.

### M4-03 — Code questions from the inbox to a coding agent, with human approval

- Let a team member send a code question about a customer conversation to a connected coding agent.
- Show the proposed question to the team member. Send it only after approval.
- Let an admin select the repositories and the team members that can use this function.
- Do not send customer personal data to the coding agent without explicit approval.
- Do not collect or proxy a subscription token, as #10 requires. This function is optional.

## Features that are partly planned

These features need no new issue now. Compare the scope again when the related issue starts.

| Featurebase feature | Related issue | Missing part |
| --- | --- | --- |
| AI finds feature requests in support conversations | #50, #51 | The team-side automatic detection is not in scope. The customer confirmation flow is in scope. |
| Signed outbound webhooks | #21, #44 | Webhooks are a delivery channel in #21. Signature and secret rotation are not stated. |
| Hosted MCP with OAuth and a permission for each tool | #10, #45 | Kaneo has MCP and OAuth. Read, write and delete marks for each tool are not stated. |
| Admin audit log | #32, #36 | Kaneo has an instance audit log. Feedback audit history is in scope. |
| Post privacy for author or company only | #26, #32 | Board privacy is in scope. Company-only requests are not stated. |
| Multi-brand workspace | #26, #40 | Boards and branding are product-scoped. Separate inbox brands are not stated. |
| Team mobile app for the inbox | #52 | #52 is a customer SDK. `apps/mobile` has no feedback or inbox scope. |
| AI spam detection | #32 | Spam protection is in scope. The AI method is not stated. |
| Help center article redirects, tabs and content blocks | #53, #83 | Redirect rules for imported article links are not stated. |
| CSV import and export of customers and companies, and profile merge | #35, #49 | Export and deletion are in scope. Bulk import and merge are not stated. |
| Portal page and navigation settings | #27, #40 | The portal routes are in scope. Founder control of the navigation is not stated. |

## Issues for partly planned features

Each row of "Features that are partly planned" gets one issue for its missing part.
The related issue keeps its scope.

| ID | Priority | Milestone | Missing part | Related issues |
| --- | --- | --- | --- | --- |
| M1-61 | P2 | M1 | Requests that only the author's company can see | #26, #32 |
| M1-62 | P3 | M1 | Feedback triage and inbox in the team mobile app | #50, #52 |
| M1-63 | P2 | M1 | AI spam score for requests, comments and conversations | #32 |
| M1-64 | P3 | M1 | Help center redirects, tabs and content blocks | #53, #83 |
| M1-65 | P2 | M1 | CSV import and export of customers and companies, and profile merge | #35, #49 |
| M1-66 | P2 | M1 | Portal page and navigation settings | #27, #40 |
| M2-05 | P2 | M2 | Automatic detection of feature requests in support conversations | #50, #51, #100 |
| M4-05 | P1 | M4 | Signed outbound webhooks with secret rotation | #21, #44 |
| M4-06 | P2 | M4 | Read, write and delete marks for each MCP tool | #10, #45 |
| M6-04 | P3 | M6 | Feedback events in the admin audit log, with an API | #32, #36 |
| M6-05 | P3 | M6 | More than one brand in one workspace | #26, #40 |

### M1-61 — Requests that only the author's company can see

- Add a request visibility value: author's company only.
- Members of the same company see, vote and comment on the request. Other customers do not.
- The API must apply this rule in lists, search, roadmap, changelog links, digests and MCP results.

### M1-62 — Feedback triage and inbox in the team mobile app

- Add a feedback triage view and a conversation inbox to `apps/mobile`.
- Let a team member reply, add a private note, assign and change a request status.
- Use the push alerts from #104. Follow `apps/mobile/AGENTS.md`.

### M1-63 — AI spam score for requests, comments and conversations

- Give each new request, comment and conversation a spam score.
- Hold an item above the limit for moderation. Do not delete it automatically.
- Let the founder release a held item. Keep a rule-based check that works without an AI provider.
- Apply the AI provider policy and the cost limits from #23.

### M1-64 — Help center redirects, tabs and content blocks

- Let the founder add redirect rules from old article links to new articles.
- Let the founder group collections into tabs.
- Add content blocks to the article editor: callout, tabs, columns, code and embedded video.

### M1-65 — CSV import and export of customers and companies, and profile merge

- Import customers and companies from a CSV file with a mapping preview.
- Export customers and companies to a CSV file. Only an authorized team member can export.
- Let the founder merge two customer profiles. Count one vote for each request after a merge. Record the merge in the audit history.

### M1-66 — Portal page and navigation settings

- Let the founder select the portal pages that are on: feedback, roadmap, updates and help.
- Let the founder set the order and the labels of the navigation, and add custom links.
- A page that is off returns "not found" from the API and the portal.

### M2-05 — Automatic detection of feature requests in support conversations

- Let the AI find feature requests and problems in team-side conversations.
- Send each finding to triage as an insight from M2-04 (#100), with the quote and a link to the conversation.
- Do not create a public request, a vote or a subscription without founder approval or customer confirmation.
- Let the founder turn detection off. Apply the AI provider policy from #23.

### M4-05 — Signed outbound webhooks with secret rotation

- Let the founder register a webhook endpoint and select its event topics.
- Sign each delivery with the endpoint secret. Include a timestamp to prevent replay.
- Let the founder rotate the secret. Keep the old secret valid for a short period.
- Retry failed deliveries with backoff and show a delivery log. Use the outbox from #21.
- Do not send private requests or private customer data unless the founder selects that topic.

### M4-06 — Read, write and delete marks for each MCP tool

- Mark each feedback MCP tool as read, write or delete with the standard MCP tool annotations.
- Let an admin turn off a tool or a class of tools for a token or a client.
- The server must reject a tool that is off. The mark alone is not an access check.

### M6-04 — Feedback events in the admin audit log, with an API

- Record feedback administration events in the Kaneo admin audit log: board, moderation, merge, import, export, token and integration changes.
- Add a read-only API for audit entries, for instance admins only.
- Do not write secrets or private message text to the audit log.

### M6-05 — More than one brand in one workspace

- Let one workspace have more than one brand. Each brand has a name, a logo, colors, a domain and a sender address.
- Link a board, a portal, a widget and a help center to one brand.
- A customer of one brand does not see content of a different brand.

## Items that are not product features

- Pricing plans, seat prices, usage fees and the cost calculator.
- The startup program and the discounts.
- The ROI calculator.
- SOC 2, GDPR hosting, the trust center and security questionnaires. A self-hosted instance puts these on the operator.
- Customer stories, comparison pages and the demo page.
- Career pages.
- Migration service by the vendor team.

## Created issues

Each new issue is in the native GitHub milestone of its section above.

| ID | Issue | ID | Issue | ID | Issue |
| --- | --- | --- | --- | --- | --- |
| M1-31 | #67 | M1-42 | #65 | M2-01 | #79 |
| M1-32 | #69 | M1-43 | #66 | M2-02 | #82 |
| M1-33 | #71 | M1-44 | #68 | M2-03 | #85 |
| M1-34 | #73 | M1-45 | #70 | M3-01 | #88 |
| M1-35 | #76 | M1-46 | #72 | M4-01 | #89 |
| M1-36 | #78 | M1-47 | #74 | M5-01 | #92 |
| M1-37 | #81 | M1-48 | #75 | M6-01 | #93 |
| M1-38 | #84 | M1-49 | #77 | M6-02 | #94 |
| M1-39 | #87 | M1-50 | #80 | M6-03 | #95 |
| M1-40 | #90 | M1-51 | #83 | | |
| M1-41 | #91 | M1-52 | #86 | | |

Recheck issues:

| ID | Issue | ID | Issue |
| --- | --- | --- | --- |
| M1-53 | #96 | M2-04 | #100 |
| M1-54 | #97 | M4-02 | #101 |
| M1-55 | #98 | M4-03 | #102 |
| M1-56 | #99 | | |

Issues for partly planned features:

| ID | Issue |
| --- | --- |
| M1-61 | #111 |
| M1-62 | #114 |
| M1-63 | #116 |
| M1-64 | #118 |
| M1-65 | #120 |
| M1-66 | #122 |
| M2-05 | #123 |
| M4-05 | #124 |
| M4-06 | #125 |
| M6-04 | #126 |
| M6-05 | #127 |
