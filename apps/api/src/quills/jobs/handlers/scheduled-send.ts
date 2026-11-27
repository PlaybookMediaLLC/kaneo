import { z } from "zod";
import type { TypeId } from "@kaneo/ids";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { recordQuillsChange } from "../../events";
import { releaseScheduledMessage } from "../../support/scheduled-send-ops";
import { finishQuillsJob } from "../queue";

const payloadSchema = z
  .object({
    scheduledMessageId: z.string().min(1).max(200),
    ticketId: z.string().min(1).max(200).optional(),
    replyAll: z.enum(["true", "false"]).optional(),
  })
  .strict();

/**
 * Releases a delayed undo-send or scheduled reply when its `run_at` arrives (#323).
 * Runs inside one scoped workspace transaction: locks the message row, flips send_status
 * to 'sent', updates conversation/ticket previews, emits `message.created` or `ticket.replied`,
 * and finishes the job atomically. A recalled message is a safe no-op.
 */
export async function runScheduledSendJob(
  workspaceId: string,
  job: JobQueueRow,
): Promise<void> {
  const payload = payloadSchema.parse(job.payload);
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const released = await releaseScheduledMessage(
      db,
      payload.scheduledMessageId as TypeId<"conversation_msg">,
      {
        ticketId: payload.ticketId as TypeId<"ticket"> | undefined,
        replyAll: payload.replyAll === "true",
      },
    );
    if (released.released) {
      const actor = released.principalId
        ? { principalId: released.principalId, actorType: "user" as const }
        : null;
      if (released.ticketId) {
        await recordQuillsChange(db, actor, {
          type: "ticket.replied",
          entityType: "ticket",
          entityId: released.ticketId,
          payload: {
            messageId: released.messageId,
            ...(released.replyAll && { replyAll: "true" }),
          },
        });
      } else if (released.conversationId) {
        await recordQuillsChange(db, actor, {
          type: "message.created",
          entityType: "conversation_message",
          entityId: released.messageId,
          payload: { conversationId: released.conversationId },
        });
      }
    }
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });
}
