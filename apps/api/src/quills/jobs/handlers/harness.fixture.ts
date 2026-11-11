import { resolve } from "node:path";
import { createId } from "@kaneo/ids";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  withQuillsSystemWorkspace,
  withQuillsWorkspace,
  type Database,
} from "../../../database/quills/client";
import { runQuillsMigrations } from "../../../database/quills/migrate";
import { events } from "../../../database/quills/schema/events";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import * as kaneo from "../../../database/schema";
import { drainQuillsWorkspace } from "../worker";
import { enqueueQuillsEvent } from "../queue";

/** Test support for delivery handlers: real PostgreSQL, workspaces A and B, an owner and a member in A. */
export function harness(name: string) {
  const prefix = `${name}_${Date.now().toString(36)}`;
  const ids = {
    a: `${prefix}_a`,
    b: `${prefix}_b`,
    owner: `${prefix}_owner`,
    mate: `${prefix}_mate`,
    outsider: `${prefix}_outsider`,
  };
  let pool: Pool;
  const db = () => drizzle(pool, { schema: kaneo });
  return {
    ...ids,
    db,
    async start(testPool: Pool, url: string) {
      const parsed = new URL(url);
      if (
        !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
        !parsed.pathname.startsWith("/quills_")
      )
        throw new Error("Use a disposable local quills_ database");
      pool = testPool;
      await migrate(drizzle(pool), { migrationsFolder: resolve("drizzle") });
      await runQuillsMigrations(url, resolve("drizzle/quills"));
      await db()
        .insert(kaneo.userTable)
        .values(
          [ids.owner, ids.mate, ids.outsider].map((id) => ({
            id,
            name: id,
            email: `${id}@example.test`,
          })),
        );
      await db()
        .insert(kaneo.workspaceTable)
        .values(
          [ids.a, ids.b].map((id) => ({
            id,
            name: id,
            slug: id,
            createdAt: new Date(),
          })),
        );
      await db()
        .insert(kaneo.workspaceUserTable)
        .values(
          (
            [
              [ids.a, ids.owner, "owner"],
              [ids.a, ids.mate, "member"],
              [ids.b, ids.outsider, "owner"],
            ] as const
          ).map(([workspaceId, userId, role]) => ({
            workspaceId,
            userId,
            role,
            joinedAt: new Date(),
          })),
        );
    },
    async stop() {
      if (!pool) return;
      await pool.query("DELETE FROM public.workspace WHERE id = ANY($1)", [
        [ids.a, ids.b],
      ]);
      await db()
        .delete(kaneo.userTable)
        .where(
          inArray(kaneo.userTable.id, [ids.owner, ids.mate, ids.outsider]),
        );
    },
    /** A scoped transaction as a teammate; it creates the teammate's principal on first use. */
    as: <T>(
      workspaceId: string,
      userId: string,
      work: Parameters<typeof withQuillsWorkspace<T>>[1],
    ) => withQuillsWorkspace({ workspaceId, userId }, work),
    principal: (workspaceId: string, userId: string) =>
      withQuillsWorkspace(
        { workspaceId, userId },
        async (_db, actor) => actor.principalId,
      ),
    system: <T>(workspaceId: string, work: (db: Database) => Promise<T>) =>
      withQuillsSystemWorkspace(workspaceId, work),
    /** Records any event type, including test-only ones that the catalogue rejects. */
    emit: (
      workspaceId: string,
      input: {
        type: string;
        entityType: string;
        entityId: string;
        actorId?: string;
        payload?: Record<string, string>;
        /** False for an event recorded before delivery existed. */
        deliver?: boolean;
      },
    ) =>
      withQuillsSystemWorkspace(workspaceId, async (tx) => {
        const eventId = createId("event");
        await tx.insert(events).values({
          eventId,
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId,
          actorType: "user",
          actorId: input.actorId ?? null,
          payload: input.payload ?? {},
          context: input.deliver === false ? {} : { deliver: true },
        });
        await enqueueQuillsEvent(tx, eventId);
        return eventId;
      }),
    /** Runs the worker without websocket delivery. */
    drain: (workspaceId: string) =>
      drainQuillsWorkspace(workspaceId, async () => {}),
    /** Makes every waiting job in the workspace due now, as its backoff would after a while. */
    due: (workspaceId: string) =>
      withQuillsSystemWorkspace(workspaceId, (tx) =>
        tx
          .update(jobQueue)
          .set({ runAt: sql`now() - interval '1 second'` })
          .where(sql`${jobQueue.status} = 'pending'`),
      ),
  };
}
