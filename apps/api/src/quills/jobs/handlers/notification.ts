import { z } from "zod";
import { typeIdSchema } from "@kaneo/ids/zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { inAppNotifications } from "../../../database/quills/schema/notifications";
import { loadEvent, subscribers } from "../fanout";
import { claimDelivery, settleDelivery } from "../ledger";
import { wants } from "../preferences";
import { finishQuillsJob } from "../queue";

export const notificationPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    principalId: typeIdSchema("principal"),
  })
  .strict();

/** One transaction holds the ledger row, the notification and the job outcome, so a retry never adds a second row. */
export async function runNotificationJob(
  workspaceId: string,
  job: JobQueueRow,
) {
  const { eventId, principalId } = notificationPayloadSchema.parse(job.payload);
  const key = `notification:${eventId}:${principalId}`;
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    if ((await claimDelivery(db, key, "notification")) === "send") {
      const event = await loadEvent(db, eventId);
      const content =
        event && (await subscribers[event.type]?.notification?.(db, event));
      if (content && (await wants(db, principalId, content.type, "inApp")))
        await db.insert(inAppNotifications).values({
          principalId,
          type: content.type,
          title: content.title,
          body: content.body ?? null,
          postId: content.postId ?? null,
          commentId: content.commentId ?? null,
        });
      await settleDelivery(db, key, "completed");
    }
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });
}
