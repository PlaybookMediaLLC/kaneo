import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { createId } from "@kaneo/ids";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { boards } from "../../../database/quills/schema/boards";
import { DEFAULT_BOARD_ACCESS } from "../../../database/quills/types";
import * as kaneo from "../../../database/schema";
import {
  chatReply,
  provider,
  providerUrl,
} from "../../assistant/provider-edge.fixture";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import { portalAiReply } from "./ai.fixture";
import { scene, type Scene } from "./seed.fixture";

// Feature checks for improveQuillsPortalPostDraft that the contract cannot express: the board
// restriction on the input and the answer, the AI-off refusal, input bounds, the usage row and
// the per-account rate limit. Only the AI provider's HTTP edge is a test double.

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
vi.mock("../../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

async function improve(
  body: unknown,
  options: { user?: string; workspace?: string; ip?: string } = {},
) {
  const res = await app.request(
    `/quills-public/${options.workspace ?? contractEnv().a}/portal/post-draft/improve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.user !== "" && {
          "x-test-user": options.user ?? contractEnv().customerA,
        }),
        "x-kaneo-client-ip": options.ip ?? `203.0.113.${++client % 250}`,
      },
      body: JSON.stringify(body),
    },
  );
  return { status: res.status, body: await res.json() };
}

/** Chat calls of the portal composer prompt since the last reset. */
const draftCalls = () =>
  provider.requests.filter((r) =>
    String(r.body?.messages?.[0]?.content).startsWith(
      "You help a customer write",
    ),
  );

/** A new board in A with these access changes. */
const board = (access: Partial<typeof DEFAULT_BOARD_ACCESS> = {}) =>
  contractEnv().scoped(
    contractEnv().a,
    async (db) =>
      (
        await db
          .insert(boards)
          .values({
            name: "Announcements",
            slug: contractEnv().id("board"),
            access: { ...DEFAULT_BOARD_ACCESS, ...access },
          })
          .returning({ id: boards.id })
      )[0]!.id,
  );
/** A board in A that customers see but may not post to. */
const readOnlyBoard = () => board({ submit: "team" });

const usageRows = async (workspaceId: string) =>
  (
    await pool.query(
      "SELECT pipeline_step, call_type, total_tokens FROM quills.ai_usage_log WHERE workspace_id=$1 AND pipeline_step='portal_post_draft'",
      [workspaceId],
    )
  ).rows;

describe.skipIf(!url)("Quills portal composer AI help", () => {
  let s: Scene;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    s = await scene(contractEnv(), "portal");
  }, 120000);
  // Each check starts with fresh rate-limit counters; the last two checks spend them on purpose.
  beforeEach(async () => {
    await pool.query("DELETE FROM quills.rate_bucket WHERE workspace_id=$1", [
      contractEnv().a,
    ]);
  });
  afterAll(async () => {
    provider.reply(portalAiReply);
    await stopContract();
  });

  it("returns a bounded suggestion, logs the usage and stores nothing else", async () => {
    provider.requests.length = 0;
    provider.reply(() =>
      chatReply({
        title: "T".repeat(300),
        problem: "P".repeat(1500),
        boardId: s.a.boardId,
      }),
    );
    const events = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.events WHERE workspace_id=$1",
          [contractEnv().a],
        )
      ).rows[0].n;
    const before = await events();
    const used = (await usageRows(contractEnv().a)).length;
    const res = await improve({ title: "csv", details: "send reports" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      title: "T".repeat(200),
      problem: "P".repeat(1000),
      boardId: s.a.boardId,
    });
    const rows = await usageRows(contractEnv().a);
    expect(rows).toHaveLength(used + 1);
    expect(rows).toContainEqual({
      pipeline_step: "portal_post_draft",
      call_type: "chat_completion",
      total_tokens: 20,
    });
    expect(await events()).toBe(before);
    // The customer's text reaches the model as data, with the boards the caller may post to only.
    const [call] = draftCalls();
    const prompt = call!.body.messages[1].content as string;
    expect(prompt).toContain("<draft>");
    expect(prompt).toContain("send reports");
    expect(prompt).toContain(s.a.boardId);
    for (const value of [...s.a.hidden, s.b.boardId, s.b.postTitle])
      expect(prompt).not.toContain(value);
  });

  it("never suggests a board the caller cannot post to", async () => {
    const readOnly = await readOnlyBoard();
    for (const suggested of [readOnly, s.b.boardId, "board_made_up"]) {
      provider.reply(() =>
        chatReply({ title: "Title", problem: "Problem", boardId: suggested }),
      );
      const free = await improve({ title: "csv", details: "" });
      expect(free.status).toBe(200);
      expect(free.body.boardId).toBeNull();
      const kept = await improve({
        title: "csv",
        details: "",
        boardId: s.a.boardId,
      });
      expect(kept.body.boardId).toBe(s.a.boardId);
    }
  });

  it("suggests another board that takes the caller's posts over the given one", async () => {
    const reports = await board();
    provider.reply(() =>
      chatReply({ title: "Title", problem: "Problem", boardId: reports }),
    );
    const res = await improve({
      title: "csv",
      details: "",
      boardId: s.a.boardId,
    });
    expect(res.body.boardId).toBe(reports);
  });

  it("refuses a board the caller cannot post to, without an AI call", async () => {
    provider.requests.length = 0;
    provider.reply(portalAiReply);
    const readOnly = await readOnlyBoard();
    const refused = await improve({
      title: "csv",
      details: "",
      boardId: readOnly,
    });
    expect(refused.status).toBe(403);
    // A board in workspace B and a team-only board in A answer like a missing board.
    const missing = await improve({
      title: "csv",
      details: "",
      boardId: createId("board"),
    });
    expect(missing.status).toBe(404);
    for (const boardId of [s.b.boardId, await board({ view: "team" })])
      expect(await improve({ title: "csv", details: "", boardId })).toEqual(
        missing,
      );
    expect(draftCalls()).toHaveLength(0);
    // Workspace B's own customer path cannot reach A's boards either.
    const crossed = await improve(
      { title: "csv", details: "", boardId: s.a.boardId },
      { workspace: contractEnv().b },
    );
    expect(crossed.status).toBe(404);
  });

  it("asks a visitor to sign in", async () => {
    const res = await improve({ title: "csv", details: "" }, { user: "" });
    expect(res.status).toBe(401);
  });

  it("refuses with 409 when AI is off and 502 when the provider fails", async () => {
    provider.requests.length = 0;
    vi.stubEnv("QUILLS_AI_BASE_URL", "");
    const off = await improve({ title: "csv", details: "" });
    vi.stubEnv("QUILLS_AI_BASE_URL", providerUrl);
    expect(off.status).toBe(409);
    expect(off.body.message).toBe("AI is not configured");
    expect(draftCalls()).toHaveLength(0);
    provider.reply(() => ({ status: 500, json: { error: "provider secret" } }));
    const failed = await improve({ title: "csv", details: "" });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain("provider secret");
    provider.reply(portalAiReply);
  });

  it("bounds the input", async () => {
    for (const body of [
      { title: "a".repeat(201), details: "" },
      { title: "", details: "a".repeat(4001) },
      { title: "", details: "  " },
      { title: "csv", details: "", boardId: "not-a-board" },
    ])
      expect((await improve(body)).status).toBe(400);
  });

  it("allows 10 suggestions per account in 10 minutes, from any address", async () => {
    provider.reply(portalAiReply);
    const user = contractEnv().customerB;
    await contractEnv().portalCustomer(contractEnv().a, user);
    for (let i = 0; i < 10; i++)
      expect(
        (await improve({ title: "csv", details: "" }, { user })).status,
      ).toBe(200);
    const limited = await improve({ title: "csv", details: "" }, { user });
    expect(limited.status).toBe(429);
    // Another account keeps its own budget.
    expect((await improve({ title: "csv", details: "" })).status).toBe(200);
    // Eleven requests with an AI call each need more than the 5-second default on a busy machine.
  }, 30000);

  it("allows 10 suggestions per address in 10 minutes, for all accounts together", async () => {
    provider.reply(portalAiReply);
    const ip = "198.51.100.9";
    const customerB = contractEnv().customerB;
    await contractEnv().portalCustomer(contractEnv().a, customerB);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await improve(
            { title: "csv", details: "" },
            { ip, user: i % 2 ? customerB : undefined },
          )
        ).status,
      ).toBe(200);
    const limited = await improve({ title: "csv", details: "" }, { ip });
    expect(limited.status).toBe(429);
    // Eleven requests with an AI call each need more than the 5-second default on a busy machine.
  }, 30000);
});
