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
    "user.created",
    "user.identified",
    "user.updated",
    "user.deleted",
    "user.lead_merged",
    "user.tagged",
    "user.untagged",
    "user.blocked",
    "user.unblocked",
    "user.company_set",
    "user.company_removed",
    "company.created",
    "company.updated",
    "company.deleted",
    "user_attribute.created",
    "user_attribute.updated",
    "user_attribute.deleted",
    "company_attribute.created",
    "company_attribute.updated",
    "company_attribute.deleted",
    "segment.created",
    "segment.updated",
    "segment.deleted",
    "segment.members_added",
    "segment.members_removed",
    "segment.evaluated",
    "segment.evaluated_all",
    "team.updated",
    "team.deleted",
    "settings.portal_updated",
    "settings.branding_updated",
    "settings.widget_updated",
    "settings.widget_secret_rotated",
    "settings.widget_install_code_minted",
    "settings.developer_updated",
    "settings.labs_updated",
  ]),
  entityType: z.enum([
    "board",
    "post",
    "team",
    "workspace",
    "principal",
    "company",
    "user_attribute",
    "company_attribute",
    "segment",
    "settings",
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
