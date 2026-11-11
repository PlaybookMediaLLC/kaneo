import { z } from "zod";
import { typeIdSchema } from "@kaneo/ids/zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { runWorkflow } from "../../automation/engine";
import { loadEvent } from "../fanout";
import { finishQuillsJob } from "../queue";

export const workflowPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    workflowId: typeIdSchema("workflow"),
  })
  .strict();

/**
 * `quills.workflow`: one workflow run for one outbox event. The engine's ledger key makes a
 * replay do nothing; a denied or failed run is recorded on the run, so the job still succeeds.
 * A transient error throws, and the worker retries the job (three attempts).
 */
export async function runWorkflowJob(workspaceId: string, job: JobQueueRow) {
  const { eventId, workflowId } = workflowPayloadSchema.parse(job.payload);
  const event = await withQuillsSystemWorkspace(workspaceId, (db) =>
    loadEvent(db, eventId),
  );
  if (event)
    await runWorkflow(
      workspaceId,
      workflowId,
      event,
      job.attempts >= job.maxAttempts,
    );
  await withQuillsSystemWorkspace(workspaceId, (db) =>
    finishQuillsJob(db, job.id, job.leaseToken!),
  );
}
