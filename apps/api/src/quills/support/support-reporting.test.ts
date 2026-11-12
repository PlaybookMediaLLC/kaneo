import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { call } from "../feedback/taxonomy-harness.fixture";
import { plainCustomer } from "./customer/seed.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter);
const DAY = 86400000;

/** Conversations of one visitor with these attribute bags, created `daysAgo` days ago. */
async function conversationsWith(
  env: ContractEnv,
  workspaceId: string,
  bags: (Record<string, unknown> | null)[],
  options: { test?: boolean; daysAgo?: number } = {},
) {
  const visitor = await plainCustomer(env, workspaceId);
  await env.scoped(workspaceId, async (db, actor) => {
    if (options.test)
      await db
        .update(principal)
        .set({ testOwnerPrincipalId: actor.principalId })
        .where(eq(principal.id, visitor.principalId));
    await db.insert(conversations).values(
      bags.map((bag) => ({
        visitorPrincipalId: visitor.principalId,
        channel: "messenger" as const,
        ...(bag && { customAttributes: bag }),
        createdAt: new Date(Date.now() - (options.daysAgo ?? 0) * DAY),
      })),
    );
  });
}

describe.skipIf(!url)("Quills attribute breakdown", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("counts only this workspace's real conversations in the window, per value", async () => {
    const env = contractEnv();
    const key = "tier";
    const envelope = (v: unknown) => ({ [key]: { v, src: "teammate" } });
    await conversationsWith(env, env.a, [
      envelope("pro"),
      { [key]: "pro" },
      envelope(["eu", "us", "eu"]),
      envelope(null),
      envelope([]),
      envelope([""]),
      { [key]: [null] },
      { other: "x" },
      null,
    ]);
    // Filtered before the counts, for values and for unset: a test customer, an old
    // conversation, workspace B.
    for (const [workspaceId, options] of [
      [env.a, { test: true }],
      [env.a, { daysAgo: 10 }],
      [env.b, {}],
    ] as const)
      await conversationsWith(
        env,
        workspaceId,
        [envelope("pro"), envelope("leak"), null],
        options,
      );

    const res = await call(
      app,
      env,
      env.owner,
      "GET",
      `/support/reporting/attribute-breakdown?key=${key}&from=${new Date(Date.now() - DAY).toISOString()}&to=${new Date(Date.now() + DAY).toISOString()}`,
    );
    expect(res).toEqual({
      status: 200,
      body: {
        unset: 6,
        values: [
          { value: "pro", count: 2 },
          { value: "eu", count: 1 },
          { value: "us", count: 1 },
        ],
        truncated: false,
      },
    });
  });

  it("refuses an empty, reversed or longer than 400-day window", async () => {
    const env = contractEnv();
    const at = (days: number) =>
      new Date(Date.now() + days * DAY).toISOString();
    for (const [from, to] of [
      [at(0), at(0)],
      [at(1), at(0)],
      [at(-401), at(0)],
    ])
      expect(
        (
          await call(
            app,
            env,
            env.owner,
            "GET",
            `/support/reporting/attribute-breakdown?key=tier&from=${from}&to=${to}`,
          )
        ).status,
      ).toBe(400);
  });

  it("keeps the 100 most frequent values and says that more exist", async () => {
    const env = contractEnv();
    const key = "ref";
    await conversationsWith(
      env,
      env.a,
      Array.from({ length: 101 }, (_, i) => ({
        [key]: { v: `r${String(i).padStart(3, "0")}`, src: "teammate" },
      })),
    );
    const res = await call(
      app,
      env,
      env.owner,
      "GET",
      `/support/reporting/attribute-breakdown?key=${key}&from=${new Date(Date.now() - DAY).toISOString()}&to=${new Date(Date.now() + DAY).toISOString()}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.values).toHaveLength(100);
    expect(res.body.values[0]).toEqual({ value: "r000", count: 1 });
    expect(res.body.truncated).toBe(true);
  });
});
