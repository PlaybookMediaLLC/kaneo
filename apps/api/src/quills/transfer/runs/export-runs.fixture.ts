import { inArray } from "drizzle-orm";
import { exportRuns } from "../../../database/quills/schema/export-runs";
import { fixture } from "../../framework/contract";
import { bothSides, finishedExport } from "./seed.fixture";

// The contract never runs the worker, so each new run stays pending. Settle it before the next check:
// a workspace has one active export at a time.
export const createQuillsExportWorkspace = fixture({
  seed: (env) =>
    env.scoped(env.a, async (db) => {
      await db
        .update(exportRuns)
        .set({ status: "failed" })
        .where(inArray(exportRuns.status, ["pending", "running"]));
      return {};
    }),
  valid: () => ({ body: { kind: "posts" } }),
});

const byRun = fixture({
  seed: (env, caller: string) => bothSides(env, caller, finishedExport),
  valid: ({ a }) => ({ params: { runId: a } }),
  foreign: ({ b }) => ({ runId: b }),
});
export const getQuillsExportRuns = byRun;
export const listQuillsExportRunsDownload = byRun;
