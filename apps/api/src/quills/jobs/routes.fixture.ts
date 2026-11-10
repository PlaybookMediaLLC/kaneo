import { createId } from "@kaneo/ids";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { fixture, type ContractEnv } from "../framework/contract";

const failedJob = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const jobId = createId("job");
    await db.insert(jobQueue).values({
      jobId,
      queue: "quills.event",
      status: "failed",
      dedupeKey: jobId,
      payload: { eventId: jobId },
    });
    return jobId;
  });

export const listQuillsJobs = fixture({
  seed: (env) => failedJob(env, env.a),
  valid: () => ({}),
});

export const retryQuillsJob = fixture({
  seed: async (env) => ({
    a: await failedJob(env, env.a),
    b: await failedJob(env, env.b),
  }),
  valid: (ids) => ({ params: { jobId: ids.a } }),
  foreign: (ids) => ({ jobId: ids.b }),
});
