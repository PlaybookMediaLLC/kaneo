import { createId } from "@kaneo/ids";
import { z } from "zod";
import type { Database, QuillsActor } from "../database/quills/client";
import { auditLog } from "../database/quills/schema/audit-log";
import { events } from "../database/quills/schema/events";
import { enqueueQuillsEvent } from "./jobs/queue";

export const changeSchema = z.object({
  type: z.enum([
    "board.project_linked",
    "board.project_unlinked",
    "post.task_linked",
    "post.task_unlinked",
    "team.bound",
    "team.unbound",
    "workspace.imported",
    "webhook.created",
    "webhook.updated",
    "webhook.deleted",
    "webhook.secret_rotated",
    "post.subscription_changed",
    "changelog.subscription_changed",
    "changelog.subscribers_imported",
  ]),
  entityType: z.enum([
    "board",
    "post",
    "team",
    "workspace",
    "webhook",
    "principal",
  ]),
  entityId: z.string().min(1).max(200),
  payload: z.record(z.string(), z.string().max(500)).default({}),
});
export async function recordQuillsChange(
  db: Database,
  actor: QuillsActor,
  input: z.input<typeof changeSchema>,
) {
  const change = changeSchema.parse(input);
  const eventId = createId("event");
  await db.insert(auditLog).values({
    actorPrincipalId: actor.principalId,
    actorType: "user",
    eventType: change.type,
    targetType: change.entityType,
    targetId: change.entityId,
    metadata: change.payload,
    channel: "api",
  });
  await db.insert(events).values({
    eventId,
    ...change,
    actorType: "user",
    actorId: actor.principalId,
    // Marks events recorded after delivery was enabled, so the worker never replays an older backlog.
    context: { deliver: true },
  });
  await enqueueQuillsEvent(db, eventId);
  return eventId;
}
