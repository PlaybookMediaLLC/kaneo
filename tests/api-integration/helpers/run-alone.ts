import { setTimeout as delay } from "node:timers/promises";
import type { PoolClient } from "pg";
import { getDatabasePool } from "../../../apps/api/src/database";

const DRAIN_LIMIT_MS = 30_000;

/**
 * Runs `work` on its own client while no other query of this process runs.
 *
 * The app finishes some work after it responds, for example the notification
 * for a new workspace. TRUNCATE locks its tables one at a time, so a query
 * that locks the same tables in a different order deadlocks with it (40P01).
 * Wait for the running queries to finish, then hold new ones until `work` ends.
 */
export async function runAlone<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getDatabasePool();
  const deadline = performance.now() + DRAIN_LIMIT_MS;
  while (pool.idleCount < pool.totalCount || pool.waitingCount > 0) {
    if (performance.now() > deadline) {
      throw new Error(
        `${pool.totalCount - pool.idleCount} database clients still in use after ${DRAIN_LIMIT_MS} ms`,
      );
    }
    await delay(5);
  }

  const original = pool.connect;
  const connect = original.bind(pool);
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  pool.connect = ((callback?: Parameters<typeof original>[0]) =>
    callback
      ? void opened.then(() => connect(callback))
      : opened.then(() => connect())) as typeof pool.connect;
  try {
    const client = await connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  } finally {
    pool.connect = original;
    open();
  }
}
