import { setTimeout as delay } from "node:timers/promises";
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
    const appWork = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from "user" limit 0`);
      await tx.execute(sql`select pg_sleep(0.3)`);
      await tx.execute(sql`select 1 from task limit 0`);
    });
    await delay(50);

    await expect(
      Promise.all([appWork, resetTestDatabase()]),
    ).resolves.toBeDefined();
  });

  it("holds new queries until the work ends", async () => {
    const order: string[] = [];
    let query: Promise<unknown> = Promise.resolve();

    await runAlone(async (client) => {
      query = db.execute(sql`select 1`).then(() => order.push("query"));
      await client.query("select pg_sleep(0.1)");
      order.push("work");
    });
    await query;

    expect(order).toEqual(["work", "query"]);
  });
});
