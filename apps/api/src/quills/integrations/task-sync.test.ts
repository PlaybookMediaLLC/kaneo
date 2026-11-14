import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { boards } from "../../database/quills/schema/boards";
import { postStatuses } from "../../database/quills/schema/statuses";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  call,
  removeMembers,
  restrictedMember,
} from "../feedback/taxonomy-harness.fixture";
import { postIn, statusIn } from "../feedback/seeds.fixture";

// The board's taskSync setting through the board settings routes (RFC 0003, feature 12).

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
const owner = () => contractEnv().owner;

describe.skipIf(!url)("Board task sync setting", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  }, 120000);

  it("sets and clears the status and keeps the other settings", async () => {
    const env = contractEnv();
    const { boardId } = await postIn(env, env.a);
    const statusId = await statusIn(env, env.a);
    const path = `/boards/${boardId}/settings`;
    await call(app, env, owner(), "PATCH", path, { voteDisplay: "hidden" });
    const set = await call(app, env, owner(), "PATCH", path, {
      taskSync: { statusOnTaskDone: statusId },
    });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({
      boardId,
      voteDisplay: "hidden",
      defaultSort: null,
      taskSync: { statusOnTaskDone: statusId },
    });
    expect((await call(app, env, owner(), "GET", path)).body).toEqual(set.body);
    const cleared = await call(app, env, owner(), "PATCH", path, {
      taskSync: { statusOnTaskDone: null },
    });
    expect(cleared.body.taskSync).toEqual({ statusOnTaskDone: null });
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ settings: boards.settings })
        .from(boards)
        .where(eq(boards.id, boardId)),
    );
    expect(row!.settings).toEqual({
      voteDisplay: "hidden",
      taskSync: { statusOnTaskDone: null },
    });
    const { rows } = await pool.query(
      "SELECT payload FROM quills.events WHERE workspace_id=$1 AND type='board.settings_updated' AND entity_id=$2 ORDER BY id",
      [env.a, boardId],
    );
    expect(rows.map((event) => event.payload.fields)).toEqual([
      "voteDisplay",
      "taskSync",
      "taskSync",
    ]);
  });

  it("refuses another workspace's status, a deleted status and a bad ID, and changes nothing", async () => {
    const env = contractEnv();
    const { boardId } = await postIn(env, env.a);
    const path = `/boards/${boardId}/settings`;
    const foreign = await statusIn(env, env.b);
    const deleted = await statusIn(env, env.a);
    await env.scoped(env.a, (db) =>
      db
        .update(postStatuses)
        .set({ deletedAt: new Date() })
        .where(eq(postStatuses.id, deleted)),
    );
    for (const statusOnTaskDone of [foreign, deleted])
      expect(
        (
          await call(app, env, owner(), "PATCH", path, {
            taskSync: { statusOnTaskDone },
          })
        ).status,
      ).toBe(404);
    for (const taskSync of [{}, { statusOnTaskDone: "board_x" }])
      expect(
        (await call(app, env, owner(), "PATCH", path, { taskSync })).status,
      ).toBe(400);
    expect((await call(app, env, owner(), "GET", path)).body.taskSync).toEqual({
      statusOnTaskDone: null,
    });
  });

  it("needs manage_settings to change the setting", async () => {
    const env = contractEnv();
    const { boardId } = await postIn(env, env.a);
    const statusId = await statusIn(env, env.a);
    const member = await restrictedMember(env, [], "member");
    expect(
      (
        await call(app, env, member, "PATCH", `/boards/${boardId}/settings`, {
          taskSync: { statusOnTaskDone: statusId },
        })
      ).status,
    ).toBe(403);
  });
});
