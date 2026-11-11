import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import {
  assistantWork,
  type Work,
  type Write,
} from "../../assistant/engine/index";
import { AiError } from "../../assistant/provider";
import { loadEvent } from "../fanout";
import { eventPayloadSchema, finishQuillsJob } from "../queue";

/**
 * Runs the assistant work for one recorded event (quills.ai). The work reads, calls the provider
 * with no transaction open, and returns its write; the write and the job's completion share one
 * transaction, so a lost lease rolls both back and the retry starts again. A provider failure of
 * background work throws, and the worker retries it; an unconfigured provider cannot recover by
 * retrying, so the job fails now.
 */
export async function runAiJob(workspaceId: string, job: JobQueueRow) {
  const { eventId } = eventPayloadSchema.parse(job.payload);
  const event = await withQuillsSystemWorkspace(workspaceId, (db) =>
    loadEvent(db, eventId),
  );
  if (!event) throw new Error("Outbox event missing");
  const work = assistantWork[event.type] as Work | undefined;
  let write: Write | undefined = work ? undefined : async () => {};
  let failure: string | undefined;
  try {
    write ??= await work!(workspaceId, event);
  } catch (error) {
    if (!(error instanceof AiError && error.code.endsWith("not_configured")))
      throw error;
    failure = error.message;
  }
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    await write?.(db);
    await finishQuillsJob(db, job.id, job.leaseToken!, failure, true);
  });
}
