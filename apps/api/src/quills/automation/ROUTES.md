# P8a automation: workflows, runs and scheduled sweeps

Source rows: `docs/quills-port/ledger/phase-P8.md`, section `automation`. The format follows
`detailed-plan.md` §5.

All paths are under `/quills/{workspaceId}`. Every route is for teammates and uses
`defineQuillsRoute`. Each route module has a sibling `*.fixture.ts`, so
`framework/contract.test.ts` checks every route. Feature tests:
`automation/automation.test.ts` (graph rules and routes), `jobs/handlers/workflow.test.ts`
(engine and actor model) and `jobs/handlers/sweeps.test.ts` (sweeps). All use real PostgreSQL
with workspaces A and B.

## Boundary map

```
Tables and owning schema:  quills: workflows, workflow_versions, workflow_runs,
                           workflow_run_events, hook_deliveries (run ledger), settings (metadata),
                           conversations, conversation_tag_assignments, conversation_tags,
                           conversation_messages, conversation_attribute_definitions, teams,
                           principal, changelog_entries, status_incidents,
                           status_incident_updates, status_incident_components,
                           status_components, status_component_events, events, audit_log,
                           job_queue.
                           public (read only, through framework/platform-reads.ts):
                           workspace_member, user (role, banned), workspace_role.
Actor and workspace:       routes: the authenticated context (helper). Runs: the teammate
                           who wrote the workflow's newest version (see the actor model).
Permissions:               configuration: quills:manage_settings. Manual run and the runnable
                           list: quills:update. No native permissions.
Persisted relationships:   workflow_versions.created_by (the acting teammate);
                           workflow_runs.workflow_id and conversation_id; the IDs that a graph
                           action names (teammate, team, tag), checked at save, at publish and
                           again by the domain code at run time.
Transaction:               one scoped transaction per request. A run is one scoped transaction
                           as the acting teammate: ledger claim, actions, run row, run events
                           and the outbox changes commit together or not at all. Each sweep is
                           one system transaction per workspace.
External effects:          none in a request or a run. Changes that a run or a sweep records
                           reach webhooks through the P4 handlers after commit.
Completion checks:         authenticated endpoint, tenant/object access, mutation (rollback),
                           read (two workspaces), worker (retry, replay, denied and failed runs).
```

## Actor model

A run acts as the teammate who wrote the workflow's newest version. Publishing writes a version
by the caller, and so does every change to a workflow's name, trigger or graph, and every
restore. So the acting teammate is the teammate who last put the current logic into effect: an
edit never runs with another teammate's permissions. `actorPrincipalId` in the workflow response
names that teammate.

Before each run, the engine checks that teammate's CURRENT Kaneo state with
`teammateMayAct` (`framework/platform-reads.ts`): an unbanned account that is an instance
administrator, or a current member whose role grants `workspace:read` and `quills:update`.
Every workflow action needs `quills:update` on its own route. The run then executes in
`withQuillsWorkspace` as that teammate, which re-checks the membership in the transaction.
A teammate who was removed, banned or downgraded (for example to viewer) makes the run fail as
`denied`: the run is recorded as `interrupted` with the events `started`, `denied`, and nothing
else changes. No run uses `withQuillsSystemWorkspace` to act; the system scope only reads the
workflow and records a denied or failed run.

A manual run also acts as the acting teammate. The requester needs `quills:update`, which every
action needs anyway.

The actions behave as they do when that teammate uses the routes. For example, a priority,
assignee or team change by a teammate who is not the assignee wakes a snoozed conversation
(`support/conversation-ops.ts` `wakes`), and the route records only the priority or assignment
event for it.

API-key scope: create, update, publish and restore make the caller the run's actor, so they
declare `alsoRequires: ["update"]`, so the framework checks `update` with `manage_settings`
against the role and the API-key scope, and the contract tests both. A key scoped only to `quills:manage_settings` gets 403 on those four routes
(`automation.test.ts`, "refuses to create, edit, publish or restore through a key without
quills:update"). A run then acts with the author's current role, re-checked at run time.

## Workflows

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsWorkflows` | `GET /automation/workflows` (first 200, run order) | manage_settings | `workflows`, `workflow_versions` | - |
| `getQuillsWorkflow` | `GET /automation/workflows/{workflowId}` | manage_settings | same | - |
| `createQuillsWorkflow` | `POST /automation/workflows` (name, trigger, graph; starts as a draft) | manage_settings | `workflows`, `workflow_versions`, reads teammates, teams, tags | `workflow.created` |
| `updateQuillsWorkflow` | `PATCH /automation/workflows/{workflowId}` (a no-op save records nothing) | manage_settings | same | `workflow.updated` |
| `deleteQuillsWorkflow` | `DELETE /automation/workflows/{workflowId}` (soft delete) | manage_settings | `workflows` | `workflow.deleted` |
| `reorderQuillsWorkflows` | `PUT /automation/workflows/order` (every workflow once, ≤ 200) | manage_settings | `workflows` | `workflow.reordered` |
| `publishQuillsWorkflow` | `POST /automation/workflows/{workflowId}/publish` (also re-enables a paused one) | manage_settings | `workflows`, `workflow_versions` | `workflow.published` |
| `pauseQuillsWorkflow` | `POST /automation/workflows/{workflowId}/pause` | manage_settings | `workflows` | `workflow.paused` |
| `listQuillsWorkflowVersions` | `GET /automation/workflows/{workflowId}/versions` (newest 50) | manage_settings | `workflow_versions`, `principal` | - |
| `restoreQuillsWorkflowVersion` | `POST /automation/workflows/{workflowId}/versions/{versionId}/restore` | manage_settings | `workflows`, `workflow_versions` | `workflow.version_restored` |

Merged: 11. `createQuillsWorkflow`; `updateQuillsWorkflow`; `deleteQuillsWorkflow`;
`getQuillsWorkflow`; `listQuillsWorkflows`; `reorderQuillsWorkflows`; `listQuillsWorkflowVersions`;
`restoreQuillsWorkflowVersion`; `setQuillsWorkflowStatus` (split into publish and pause: publish
records the acting teammate). The ledger's read actions (`ROUTING_MANAGE`) are configuration
reads, so they need manage_settings.

## Runs and reporting

| operationId | Route | Action | Tables | Event |
|---|---|---|---|---|
| `listQuillsRunnableWorkflows` | `GET /automation/runnable-workflows` | update | `workflows` | - |
| `runQuillsWorkflowManually` | `POST /automation/workflows/{workflowId}/run` (`conversationId`; 409 unless live) | update | `workflows`, `conversations` | `workflow.run_requested` |
| `previewQuillsWorkflow` | `GET /automation/workflows/{workflowId}/preview?conversationId` (dry run) | manage_settings | `workflows`, `conversations`, tag assignments | - |
| `listQuillsWorkflowRuns` | `GET /automation/workflows/{workflowId}/runs` (`limit` ≤ 100) | manage_settings | `workflow_runs` | - |
| `listQuillsWorkflowRunEvents` | `GET /automation/runs/{runId}/events` (≤ 200) | manage_settings | `workflow_run_events` | - |
| `getQuillsWorkflowEffectiveness` | `GET /automation/effectiveness?days` (1–90, default 7) | manage_settings | `workflow_runs`, `workflows` | - |

Merged: 6. `listQuillsRunnableWorkflows` (the source's `CONVERSATION_REPLY` maps to update);
`runQuillsWorkflowManually` (an inbox action like a macro, so update, not the ledger's
manage_settings); `previewQuillsWorkflow`; `workflowQuillsRuns`; `workflowQuillsRunTimeline`;
`workflowQuillsEffectiveness` (without the block funnel: no journey blocks are ported).

## Settings

| operationId | Route | Action | Event |
|---|---|---|---|
| `getQuillsWorkflowAbandonedAutoClose`, `setQuillsWorkflowAbandonedAutoClose` | `GET`, `PUT /automation/settings/abandoned-auto-close` | manage_settings | `settings.workflow_abandoned_auto_close_updated` |
| `getQuillsWorkflowCloseSpam`, `setQuillsWorkflowCloseSpam` | `GET`, `PUT /automation/settings/close-spam` | manage_settings | `settings.workflow_close_spam_updated` |

Merged: 4. Stored in `settings.metadata` under the source keys (`workflowAbandonedAutoClose`,
`workflowCloseSpam`). Storage only: see "Not implemented".

Total: 20 routes for 23 source capabilities.

## Engine

- Graph: `trigger`, `condition`, `branch` and `action` steps with edges, at most 100 steps,
  200 edges and 64 KiB. Conditions are a leaf or a group two levels deep. Fields:
  `conversation.status`, `.channel`, `.priority`, `.tags`, `.team`, `conversation.attr.<key>`,
  `message.body`, `message.sender`; the source's operators. List operators (`contains_any`,
  `contains_all`, `includes_any`, `excludes_all`) take `values`; the others take `value`. ID
  values (tags, team) are TypeIDs. The evaluator and walker (`graph.ts`) follow the source: an
  unresolved field matches only `is_empty`; malformed stored input never matches; a revisited
  step, an unknown step or an invalid stored action ends the walk. Conditions read one snapshot
  taken before any action runs, as in the source.
- Actions: `assign_agent`, `assign_team`, `add_tag`, `set_priority`, `snooze` (seconds),
  `close` (needs the required attributes, as the route does) and `reopen`. Each runs through
  `support/conversation-ops.ts`, the code the conversation routes use, and records the same
  event as the route, with `workflowRunId` in the payload.
- Triggers: `conversation.status_changed`, `.assigned`, `.priority_changed`,
  `.attribute_changed`, `.tags_changed`, `message.created`, `message.note_created`.
- Dispatch: `jobs/fanout.ts` calls `enqueueWorkflowRuns` in the fan-out transaction. It queues
  one `quills.workflow` job per live workflow on the event's type (in run order, ≤ 100), or for
  `workflow.run_requested` the requested workflow. Deduplication key `<eventId>:<workflowId>`,
  three attempts. A change that carries `workflowRunId` (made by a run) or that has no actor
  (made by a sweep) starts no run, so a workflow cannot trigger itself or another workflow, and
  a snooze action cannot loop on its own wake. The queue runs right after `quills.event`.
- Run (`automation/engine.ts`, handler `jobs/handlers/workflow.ts`): the acting teammate check,
  then one scoped transaction as that teammate. It re-reads the live workflow and its acting
  teammate and walks the graph. A walk with no actions writes nothing and records no run.
  Otherwise it claims the ledger key `workflow:<eventId>:<workflowId>` in `hook_deliveries`,
  walks again on the locked conversation, applies the actions and writes the run (`done`) and
  its events, ending in `completed` or `halted`. A replay finds the key and does nothing. A
  404 or 409 from an action rolls back every action and records a `failed` run. A transient
  error retries the job; the last attempt records a `failed` run.
- Retention: `jobs/retention.ts` deletes finished runs (and their events) after the event
  retention (90 days by default), in batches of 1,000.

## Scheduled sweeps

`runQuillsJobs` (the scheduler's existing ten-second Quills tick) runs `runQuillsSweeps` for
each workspace that `quills.runnable_workspaces` lists, before it drains its jobs. Migration
0013 adds the `quills.workflow` queue and the due-work branches to that function. The sweeps
run in one system transaction in an unarchived workspace; when it fails, each sweep runs again
in its own transaction, so one failing sweep does not block the others. Each handles at most 50
rows, claims them with `FOR UPDATE SKIP LOCKED` (the lock re-checks the row, so a concurrent
edit wins) and changes their state, so a repeat or a concurrent instance finds nothing.
Changes are recorded with no actor (`system`) and start no workflow run.

| Sweep | Due when | Change | Event |
|---|---|---|---|
| Snooze wake (P5a) | `status = snoozed` and `snoozed_until` ≤ now | `setStatus(open)` | `conversation.status_changed` |
| Scheduled changelog (P1b) | not notified, not deleted, `published_at` in the last day and ≤ now | stamps `notified_at`; records the event unless the route already did | `changelog.published` (`notify: "true"`) |
| Maintenance start (P6) | scheduled, `auto_start`, start ≤ now and in the last day, and not already past an auto-complete end | `startMaintenanceWindow` (shared with the start route) | `status.maintenance_started` |
| Maintenance complete (P6) | scheduled, in progress or verifying, `auto_complete`, end ≤ now | `completeMaintenanceWindow`; restores held components | `status.incident_resolved` |

A start missed by more than a day (an outage, or a window planned before this sweep existed) is
left for a teammate. A re-scheduled changelog entry that was announced once is not announced
again (the source claims each entry once too).

## Event catalogue additions

Types: `workflow.created`, `workflow.updated`, `workflow.deleted`, `workflow.reordered`,
`workflow.published`, `workflow.paused`, `workflow.version_restored`, `workflow.run_requested`,
`settings.workflow_abandoned_auto_close_updated`, `settings.workflow_close_spam_updated`.
Entity: `workflow`. Payloads carry IDs only.

## Migration

`drizzle/quills/0013_workflow_runs_sweeps.sql` (custom), no table changes:

1. Pauses every live workflow, workspace by workspace (row security applies). No route could
   publish one before this release, so each came from an import; it runs again only after a
   teammate publishes it here. The import path now pauses imported live workflows too
   (`transfer/import-archive.ts`). Affected data: `workflows.status` of imported live rows.
   Rollback: publish the workflows again.
2. Replaces `quills.runnable_workspaces` with the same signature, owner and grants. It adds
   `quills.workflow` to the queue list and three due-work branches (snoozed conversations,
   unannounced changelog entries, maintenance bounds). The branches use
   `conversations_snoozed_until_idx`, `changelog_published_at_idx` and
   `status_incidents_kind_status_idx`.

## Not implemented

| Source capability | State | Reason |
|---|---|---|
| AI steps (`let_assistant_answer`, attribute detection, AI spam classification) | out of scope | The assistant slice owns AI. |
| `send_webhook`, mail actions | not ported | The P4 webhook handler delivers only to registered webhooks; an arbitrary-URL action needs its own SSRF-checked handler and ledger. Registered webhooks already receive every change a run records. |
| `wait` steps, customer-facing journeys and blocks (`message`, `reply_buttons`, `collect_*`, `request_csat`, …) | not ported | Need parked runs, resume on customer replies, the exclusive lock and the widget audience. Every workflow is `background`; the graph schema rejects these steps. |
| `remove_tag`, `add_note`, `set_attribute` actions | not ported | Their route logic is inline in the conversation route handlers, not in shared domain code; extract it first. |
| `apply_sla`, `set_ticket_status`, `convert_to_ticket` actions | not ported | No SLA clock engine is ported; ticket actions need the ticket domain functions extracted. |
| SLA breach sweep and the `sla.*` triggers | not implemented | Nothing applies an SLA (`sla_applied` is never set), so no clock can breach. Needs the SLA clock engine first. |
| Unresponsive, ticket, `conversation.created`, `conversation.csat_submitted`, assistant and `page.visited` triggers | not ported | No event of those types exists yet, or they need the timer sweeps of parked journeys. |
| Trigger settings (frequency cap, audience, send window, channels, inactivity) | not ported | Condition steps gate a run; the stored `trigger_settings` stays `{}`. |
| Abandoned auto-close and close-spam behavior | part | The settings are stored; their consumers (parked journeys, AI classification) are not ported. |
| Scheduled changelog `notify` choice | part | P1b stores no notify choice for a scheduled entry, so the sweep records `notify: "true"`. |
| Run reporting funnel (`sentRuns`, `engagedRuns`) | not ported | Needs journey blocks. |
| Bulk conversation changes as triggers | not ported | A bulk update records `conversation.bulk_updated`, which names many conversations; no workflow starts from it. |
| API-key scope at run time | closed | The four actor-setting routes require `update` in the caller's real scope. See "Actor model". |
| Indexes for long run histories | not added | `(workflow_id, started_at)` and `(workspace_id, started_at)` on `workflow_runs` need a generated migration; retention bounds the rows instead. |
