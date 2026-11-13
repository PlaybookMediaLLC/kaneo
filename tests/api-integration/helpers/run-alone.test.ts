import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import db from "../../../apps/api/src/database";
import { resetTestDatabase } from "./database";
import { runAlone } from "./run-alone";

describe("runAlone", () => {
  it("lets a reset finish while app work locks tables in reverse order", async () => {
    await resetTestDatabase();
    // Like the notification check: "user" first, then "task", which TRUNCATE
    // locks before "user".
    const userLocked = Promise.withResolvers<void>();
    const appWork = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from "user" limit 0`);
      userLocked.resolve();
      await tx.execute(sql`select pg_sleep(0.3)`);
      await tx.execute(sql`select 1 from task limit 0`);
    });
    await userLocked.promise;

    await Promise.all([appWork, resetTestDatabase()]);
  });

  it("holds new queries and transactions until the work ends", async () => {
    const order: string[] = [];
    let held: Promise<unknown> = Promise.resolve();

    await runAlone(async (client) => {
      held = Promise.all([
        db.execute(sql`select 1`).then(() => order.push("query")),
        db
          .transaction((tx) => tx.execute(sql`select 1`))
          .then(() => order.push("transaction")),
      ]);
      await client.query("select pg_sleep(0.1)");
      order.push("work");
    });
    await held;

    expect(order[0]).toBe("work");
    expect(order).toHaveLength(3);
  });

  it("opens the pool again when the work fails", async () => {
    await expect(
      runAlone(() => Promise.reject(new Error("work failed"))),
    ).rejects.toThrow("work failed");
    await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
  });
});
