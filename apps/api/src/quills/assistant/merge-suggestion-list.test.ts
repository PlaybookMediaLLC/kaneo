import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { BoardId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { boards } from "../../database/quills/schema/boards";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { posts } from "../../database/quills/schema/posts";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import {
  call,
  linkedProject,
  removeMembers,
  restrictedMember,
} from "../feedback/taxonomy-harness.fixture";

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

/** Two new posts on a board of A and a suggestion that pairs them. */
const pair = (
  env: ContractEnv,
  boardId: BoardId,
  status: "pending" | "dismissed",
  hybridScore: number,
) =>
  env.scoped(env.a, async (db, actor) => {
    const [source, target] = await db
      .insert(posts)
      .values(
        ["Source", "Target"].map((title) => ({
          title,
          content: title,
          boardId,
          principalId: actor.principalId,
        })),
      )
      .returning({ id: posts.id });
    const [row] = await db
      .insert(mergeSuggestions)
      .values({
        sourcePostId: source!.id,
        targetPostId: target!.id,
        status,
        vectorScore: hybridScore,
        ftsScore: 0,
        hybridScore,
        llmConfidence: 0.9,
        resolvedAt: status === "dismissed" ? new Date() : null,
      })
      .returning({ id: mergeSuggestions.id });
    return row!.id;
  });
const board = (env: ContractEnv) =>
  env.scoped(env.a, async (db) => {
    const [row] = await db
      .insert(boards)
      .values({ name: "Duplicates", slug: env.id("board") })
      .returning({ id: boards.id });
    return row!.id;
  });

describe.skipIf(!url)("Merge suggestion list", () => {
  let member: string;
  const ids = {} as {
    strong: string;
    weak: string;
    hidden: string;
    dismissed: string;
  };
  const list = async (query: string) => {
    const res = await call(
      app,
      contractEnv(),
      member,
      "GET",
      `/merge-suggestions${query}`,
    );
    expect(res.status).toBe(200);
    return res.body as {
      items: { id: string; source: { boardName: string } }[];
      nextOffset: number | null;
    };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    const env = await startContract(pool, url!);
    member = await restrictedMember(env, []);
    const open = await board(env);
    const hidden = await board(env);
    await linkedProject(env, hidden);
    ids.strong = await pair(env, open, "pending", 0.99);
    ids.weak = await pair(env, open, "pending", 0.9);
    ids.hidden = await pair(env, hidden, "pending", 0.95);
    ids.dismissed = await pair(env, open, "dismissed", 0.9);
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  });

  it("lists the visible pending pairs, strongest first, a page at a time", async () => {
    const first = await list("?limit=1");
    expect(first.items.map((item) => item.id)).toEqual([ids.strong]);
    expect(first.items[0]!.source.boardName).toBe("Duplicates");
    expect(first.nextOffset).toBe(1);
    const second = await list("?limit=1&offset=1");
    expect(second.items.map((item) => item.id)).toEqual([ids.weak]);
    expect(second.nextOffset).toBeNull();
    expect(JSON.stringify(second)).not.toContain(ids.hidden);
  });

  it("lists the dismissed pairs apart from the pending ones", async () => {
    const dismissed = await list("?status=dismissed");
    expect(dismissed.items.map((item) => item.id)).toEqual([ids.dismissed]);
  });

  it("refuses another status", async () => {
    const res = await call(
      app,
      contractEnv(),
      member,
      "GET",
      "/merge-suggestions?status=accepted",
    );
    expect(res.status).toBe(400);
  });
});
