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
    "tag.created",
    "tag.updated",
    "tag.deleted",
    "status.created",
    "status.updated",
    "status.deleted",
    "status.reordered",
    "roadmap.created",
    "roadmap.updated",
    "roadmap.deleted",
    "roadmap.reordered",
    "roadmap.column_created",
    "roadmap.column_updated",
    "roadmap.column_deleted",
    "changelog.created",
    "changelog.updated",
    "changelog.published",
    "changelog.deleted",
    "changelog.category_created",
    "changelog.category_updated",
    "changelog.category_deleted",
    "changelog.category_reordered",
    "settings.changelog_updated",
    "settings.moderation_updated",
    "post.approved",
    "post.rejected",
    "comment.approved",
    "comment.rejected",
    "post.merged",
    "post.unmerged",
    "post_view.created",
    "post_view.deleted",
  ]),
  entityType: z.enum([
    "board",
    "post",
    "team",
    "workspace",
    "tag",
    "status",
    "roadmap",
    "changelog",
    "settings",
    "comment",
    "post_view",
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
  });
  await enqueueQuillsEvent(db, eventId);
  return eventId;
}
