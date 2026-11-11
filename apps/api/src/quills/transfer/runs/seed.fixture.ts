import {
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../../../database/quills/client";
import { exportRuns } from "../../../database/quills/schema/export-runs";
import { importRuns } from "../../../database/quills/schema/import-runs";
import type { ContractEnv } from "../../framework/contract";

// Seed helpers for the transfer run fixtures. Not fixtures themselves.

type Work<T> = (db: Database, actor: QuillsActor) => Promise<T>;

/** Work in A as `caller` (an export run belongs to its initiator) and in B as B's owner. */
export async function bothSides<T>(
  env: ContractEnv,
  caller: string,
  work: Work<T>,
) {
  return {
    a: await withQuillsWorkspace({ workspaceId: env.a, userId: caller }, work),
    b: await env.scoped(env.b, work),
  };
}

/** A finished export run whose file has not expired. */
export const finishedExport: Work<string> = async (db, actor) => {
  const [run] = await db
    .insert(exportRuns)
    .values({
      fileName: "posts-contract.csv",
      status: "completed",
      s3Key: `contract/${actor.workspaceId}/export-${Date.now()}-${Math.random()}.csv`,
      sizeBytes: 10,
      entityCounts: { posts: 1 },
      initiatedByPrincipalId: actor.principalId,
      finishedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: exportRuns.id });
  return run!.id;
};

/** A finished import run with one reported row error. */
export const finishedImport: Work<string> = async (db, actor) => {
  const [run] = await db
    .insert(importRuns)
    .values({
      source: "csv",
      fileName: "posts.csv",
      status: "failed",
      totals: { rows: 1, created: 0, updated: 0, skipped: 0, errors: 1 },
      errorReport: [{ row: 1, message: "Unknown tag: x", field: "tags" }],
      initiatedByPrincipalId: actor.principalId,
      finishedAt: new Date(),
    })
    .returning({ id: importRuns.id });
  return run!.id;
};
