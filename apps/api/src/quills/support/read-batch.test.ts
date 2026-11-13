import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  removeMembers,
  restrictedMember,
} from "../feedback/taxonomy-harness.fixture";
import { batchable } from "../framework/read-batch";
import { registry } from "../framework/registry";
import { sharedRows } from "./customer/seed.fixture";

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

type Caller = { user: string; scope?: object };
async function send(
  method: string,
  path: string,
  caller: Caller,
  body?: unknown,
) {
  const res = await app.request(`/quills/${contractEnv().a}${path}`, {
    method,
    headers: {
      "x-test-user": caller.user,
      ...(caller.scope && { "x-test-scope": JSON.stringify(caller.scope) }),
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
type Read = { operationId: string; query?: Record<string, string> };
const batch = (caller: Caller, reads: Read[]) =>
  send("POST", "/read-batch", caller, { reads });

describe("batchable reads", () => {
  it("refuses a route with any check outside its handler or a combined action check", () => {
    const read = [...registry.keys()].find(
      (d) => d.operationId === "listQuillsTicketStatuses",
    )!;
    expect(batchable(read)).toBe(true);
    for (const extra of [
      { project: () => "project" },
      { after: async (result: unknown) => result },
      { load: async () => undefined },
      { native: { project: ["read"] } },
      { alsoRequires: ["update"] },
      { callerActions: true },
      { audience: "portal" },
      { audience: "app" },
      { sessionOnly: true },
      { method: "post" },
    ])
      expect([extra, batchable({ ...read, ...extra } as never)]).toEqual([
        extra,
        false,
      ]);
  });
});

describe.skipIf(!url)("Quills read batch", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  });

  it("gives each read the status and answer that its own route gives the same caller", async () => {
    const env = contractEnv();
    const foreignTicket = (await sharedRows(env)).foreignTicket.ticketId;
    const reads: (Read & { path: string })[] = [
      { operationId: "getQuillsOfficeHours", path: "/support/office-hours" },
      { operationId: "listQuillsTicketStatuses", path: "/ticket-statuses" },
      // Workspace B's ticket as a cursor: the route answers 404, and so must the batch.
      {
        operationId: "listQuillsTickets",
        path: "/tickets",
        query: { cursor: foreignTicket },
      },
      {
        operationId: "listQuillsTickets",
        path: "/tickets",
        query: { limit: "1000" },
      },
    ];
    const callers: [string, Caller, number[]][] = [
      [
        "member without manage_settings",
        { user: await restrictedMember(env, [], "member") },
        [403, 200, 404, 400],
      ],
      [
        "owner with a read-only API key",
        {
          user: env.owner,
          scope: { workspace: ["read"], quills: ["read"] },
        },
        [403, 200, 404, 400],
      ],
      ["owner", { user: env.owner }, [200, 200, 404, 400]],
    ];
    for (const [name, caller, expected] of callers) {
      const together = await batch(
        caller,
        reads.map(({ operationId, query }) => ({ operationId, query })),
      );
      expect([name, together.status]).toEqual([name, 200]);
      for (const [index, read] of reads.entries()) {
        const single = await send(
          "GET",
          `${read.path}?${new URLSearchParams(read.query)}`,
          caller,
        );
        const result = together.body.results[index];
        expect([name, read.operationId, single.status, result.status]).toEqual([
          name,
          read.operationId,
          expected[index],
          expected[index],
        ]);
        expect(result.body === null ? null : JSON.parse(result.body)).toEqual(
          single.status === 200 ? single.body : null,
        );
      }
    }
  });

  it("refuses every read that is not a batchable teammate GET, and still runs the others", async () => {
    const env = contractEnv();
    const refused = [
      "setQuillsOfficeHours",
      "getQuillsTicket",
      "listQuillsLinks",
      "readQuillsTogether",
      "getQuillsConversationPresence",
      // load and prepare: steps outside the handler.
      "getQuillsUsage",
      "unfurlQuillsLink",
      "noSuchRead",
    ];
    const res = await batch({ user: env.owner }, [
      ...refused.map((operationId) => ({ operationId })),
      { operationId: "listQuillsTicketStatuses" },
    ]);
    expect(res.status).toBe(200);
    expect(
      res.body.results.map((r: { status: number; body: unknown }) => [
        r.status,
        r.body,
      ]),
    ).toEqual([...refused.map(() => [404, null]), [200, expect.any(String)]]);
  });

  it("bounds the batch and each query", async () => {
    const env = contractEnv();
    const read = { operationId: "listQuillsTicketStatuses" };
    expect(
      (
        await batch(
          { user: env.owner },
          Array.from({ length: 21 }, () => read),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await batch({ user: env.owner }, [
          {
            ...read,
            query: Object.fromEntries(
              Array.from({ length: 31 }, (_, i) => [`k${i}`, "v"]),
            ),
          },
        ])
      ).status,
    ).toBe(400);
  });
});
