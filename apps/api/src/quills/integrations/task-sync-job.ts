import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { boards } from "../../database/quills/schema/boards";
import { hookDeliveries } from "../../database/quills/schema/hook-deliveries";
import type { JobQueueRow } from "../../database/quills/schema/job-queue";
import { postTasks } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { recordQuillsChange } from "../events";
import { doneTaskWorkspace } from "../framework/platform-reads";
import { enqueueQuillsJob, finishQuillsJob } from "../jobs/queue";
import { statusOnTaskDone } from "./task-sync";

// Task sync (RFC 0003, feature 12, D12). Kaneo publishes `task.status_changed` after the task
// change commits. handOffTaskStatus enqueues a Quills job for a task that is now in a done column
// and has a post link. The job reads the stored post_tasks links in the task's workspace and sets
// each linked post to its board's `taskSync.statusOnTaskDone` status.

export const taskSyncPayloadSchema = z
  .object({ taskId: z.string().min(1).max(200) })
  .strict();

/**
 * The durable handoff: one task-sync job for a done task with a post link. It runs after the
 * Kaneo commit, so a rolled-back task change enqueues nothing.
 */
// ponytail: a process that stops between the Kaneo commit and this enqueue loses the sync for that
// change. Add a reconciling sweep over post_tasks if that gap matters.
export async function handOffTaskStatus(event: { taskId?: unknown }) {
  if (typeof event.taskId !== "string") return;
  const taskId = event.taskId;
  const workspaceId = await doneTaskWorkspace(taskId);
  if (!workspaceId) return;
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [link] = await db
      .select({ postId: postTasks.postId })
      .from(postTasks)
      .where(eq(postTasks.taskId, taskId))
      .limit(1);
    // Each completion is a new handoff. The job's ledger keeps a repeat from changing a post again.
    if (link)
      await enqueueQuillsJob(
        db,
        "quills.workflow",
        { taskId },
        `task-sync:${taskId}:${randomUUID()}`,
        3,
      );
  });
}

/**
 * `quills.workflow`: sets the mapped status on the live posts that link to a done task. One
 * transaction holds the ledger rows, the status changes, their outbox events and the job outcome,
 * so a retry changes nothing twice. The ledger key is per task, post and status.
 */
export async function runTaskSyncJob(workspaceId: string, job: JobQueueRow) {
  const { taskId } = taskSyncPayloadSchema.parse(job.payload);
  // A platform read, outside the scoped transaction. A task that is no longer done, was deleted or
  // moved to another workspace changes nothing.
  const done = Boolean(await doneTaskWorkspace(taskId, workspaceId));
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    // The stored links of this workspace only (row security), never the task ID alone.
    const linked = done
      ? await db
          .select({
            postId: posts.id,
            settings: boards.settings,
          })
          .from(postTasks)
          .innerJoin(posts, eq(posts.id, postTasks.postId))
          .innerJoin(boards, eq(boards.id, posts.boardId))
          .where(
            and(
              eq(postTasks.taskId, taskId),
              isNull(posts.deletedAt),
              isNull(boards.deletedAt),
            ),
          )
          // ponytail: at most 100 linked posts per task; page the links if tasks get more.
          .limit(100)
      : [];
    for (const post of linked) {
      const target = statusOnTaskDone(post.settings);
      if (!target) continue;
      // Two jobs for one task change each post once: the second waits here, then finds the status set.
      const [current] = await db
        .select({ statusId: posts.statusId })
        .from(posts)
        .where(eq(posts.id, post.postId))
        .for("update");
      if (!current || target === current.statusId) continue;
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(
          and(eq(postStatuses.id, target), isNull(postStatuses.deletedAt)),
        );
      if (!status) continue;
      const [first] = await db
        .insert(hookDeliveries)
        .values({
          // One row per handoff and post: a replayed job changes nothing, and a later completion
          // of the task (a new job) applies again.
          jobId: `task-sync:${job.id}:${post.postId}`,
          hookType: "task_sync",
        })
        .onConflictDoNothing()
        .returning({ key: hookDeliveries.jobId });
      if (!first) continue;
      await db
        .update(posts)
        .set({ statusId: status.id, updatedAt: new Date() })
        .where(eq(posts.id, post.postId));
      // The existing fan-out tells the post's voters and followers.
      await recordQuillsChange(db, null, {
        type: "post.status_changed",
        entityType: "post",
        entityId: post.postId,
        payload: { statusId: status.id, source: "task" },
      });
    }
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });
}
