import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { MONDAY_ITEM } from "../../integrations/providers/monday.fixture";
import { deliver, type Delivery } from "./integration-send";
import {
  describeDelivery,
  type DeliveryCase,
} from "./tracker-delivery.fixture";

// Monday.com item delivery: the worker evidence table of tracker-delivery.fixture.ts, then the two
// calls (`create_item`, then `create_update`) without a database, with the partial success: an item
// whose update fails is still a success, so it is never created twice.

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
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const GRAPHQL = "POST /api.monday.com/v2";
type Answer = { status: number; body?: unknown } | "drop";

// Seam gap: the evidence table counts every call on the create route as a create, and the update
// (the item's body) uses the same GraphQL route. The update calls go to their own list, so the table
// counts item creates only. Remove this when the shared fixture tells a create from a follow-up call.
const updates: typeof providerCalls = [];
Object.defineProperty(providerCalls, "push", {
  enumerable: false,
  value: (...calls: typeof providerCalls) => {
    for (const call of calls)
      // The query comes first in the body, so a title or a post text cannot match.
      if (call.body.startsWith('{"query":"mutation CreateUpdate('))
        updates.push(call);
      else Array.prototype.push.call(providerCalls, call);
    return providerCalls.length;
  },
});

/** Answers for the next GraphQL calls in order; null is the local server's own answer. */
const queue: (Answer | null)[] = [];
const edge = vi.mocked(globalThis.fetch).getMockImplementation()!;
vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
  if (queue.length) {
    const next = queue.shift();
    if (next) providerOverrides.set(GRAPHQL, next);
    else providerOverrides.delete(GRAPHQL);
  }
  return edge(input, init);
});

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  provider: "monday",
  credentials: { accessToken: "monday_token" },
  app: { clientId: "client", clientSecret: "app-secret" },
  config: {},
  target: "4000",
  type: "post.created",
  occurredAt: new Date(),
  content: {
    board: "Ideas",
    boardId: "board_1",
    post: {
      id: "post_1",
      title: "Dark mode",
      content: "Please",
      author: "Ada",
    },
  },
  deliveryId: "op_1",
  ...overrides,
});
const item = { externalId: MONDAY_ITEM, externalUrl: null };
const errors = (...statuses: (number | undefined)[]) => ({
  status: 200,
  body: {
    data: null,
    errors: statuses.map((status_code) => ({
      message: "secret provider text",
      extensions: { code: "SomeException", status_code },
    })),
  },
});

afterEach(() => {
  queue.length = 0;
  providerOverrides.clear();
  providerCalls.length = 0;
  updates.length = 0;
});

describe("Monday.com item body and answers", () => {
  it("passes a hostile title and description only as GraphQL variables, and escapes the update", async () => {
    const title =
      'Title") { id } } mutation CreateUpdate( { delete_board(board_id: 1) { id } } #\n"';
    const outcome = await deliver(
      delivery({
        content: {
          board: "Board <i>",
          boardId: "board_1",
          post: {
            id: "post_1",
            title,
            content: "<img src=x onerror=alert(1)>\n'quoted' & \"double\"",
            author: "Ada",
          },
        },
      }),
    );
    expect(outcome).toEqual({ state: "succeeded", result: item });
    expect(providerCalls).toHaveLength(1);
    expect(updates).toHaveLength(1);
    // The token is the whole header of both calls, with no `Bearer`.
    expect(providerCalls[0]!.authorization).toBe("monday_token");
    expect(updates[0]!.authorization).toBe("monday_token");
    const create = JSON.parse(providerCalls[0]!.body);
    expect(create.query).not.toContain("Title");
    expect(create.query).toContain(
      "create_item(board_id: $board, item_name: $name)",
    );
    expect(create.variables).toEqual({
      board: "4000",
      name: title.replace(/\s+/g, " ").trim(),
    });
    const update = JSON.parse(updates[0]!.body);
    expect(update.query).toContain(
      "create_update(item_id: $item, body: $body)",
    );
    expect(update.variables).toEqual({
      item: MONDAY_ITEM,
      body:
        "<p>&lt;img src=x onerror=alert(1)&gt;</p>" +
        "<p>&#39;quoted&#39; &amp; &quot;double&quot;</p>" +
        "<p>Submitted by: Ada</p><p>Board: Board &lt;i&gt;</p>",
    });
  });

  it.each([
    ["a 400", { status: 400 }, "provider_failed"],
    ["a 401", { status: 401 }, "authentication"],
    ["a 403", { status: 403 }, "authentication"],
    ["a 429", { status: 429 }, "unavailable"],
    ["a 500", { status: 500 }, "outcome_unknown"],
    ["no answer", "drop", "outcome_unknown"],
    ["GraphQL errors", errors(400), "provider_failed"],
    [
      "no update ID",
      { status: 200, body: { unexpected: true } },
      "outcome_unknown",
    ],
  ] as const)(
    "keeps the item as a success when the update gets %s, with the reason: no second item, no throw",
    async (_name, answer, errorCode) => {
      queue.push(null, answer);
      // `succeeded` offers no retry, whatever the code: the item is never made twice.
      expect(await deliver(delivery())).toEqual({
        state: "succeeded",
        errorCode,
        result: item,
      });
      expect(providerCalls).toHaveLength(1);
      expect(updates).toHaveLength(1);
    },
  );

  it("sends nothing for an event that Monday.com does not deliver", async () => {
    expect(await deliver(delivery({ type: "comment.created" }))).toEqual({
      state: "succeeded",
    });
    expect(providerCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it.each([
    ["a 401", [401], "auth_required"],
    ["a 403", [403], "auth_required"],
    ["a rate limit", [429], "retry_wait"],
    ["a refusal", [400], "failed"],
    ["several refusals", [400, 404], "failed"],
    // An error that can follow a write: the item may exist, so it is never sent again.
    ["a server error", [500], "uncertain"],
    ["a refusal and a server error", [400, 500], "uncertain"],
    ["no status", [undefined], "uncertain"],
    ["no error", [], "uncertain"],
  ] as const)(
    "maps an item create refused with %s, with no update",
    async (_name, statuses, state) => {
      queue.push(errors(...statuses));
      const outcome = await deliver(delivery());
      expect(outcome.state).toBe(state);
      expect(JSON.stringify(outcome)).not.toContain("provider text");
      expect(providerCalls).toHaveLength(1);
      expect(updates).toEqual([]);
    },
  );

  it("is uncertain for a create_item without a valid ID, with no update", async () => {
    for (const createItem of [{ id: "../1" }, { id: 42 }, {}])
      queue.push({
        status: 200,
        body: { data: { create_item: createItem }, errors: [] },
      });
    for (let i = 0; i < 3; i++)
      expect(await deliver(delivery())).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
    expect(updates).toEqual([]);
  });

  it("refuses a channel that is not a board ID, with no call", async () => {
    for (const target of ["../4000", "4000 ", "abc", "1".repeat(31)])
      expect(await deliver(delivery({ target }))).toMatchObject({
        state: "failed",
        errorCode: "provider_failed",
      });
    expect(providerCalls).toEqual([]);
    expect(updates).toEqual([]);
  });
});

const monday: DeliveryCase = {
  type: "monday",
  channel: "4000",
  otherChannel: "4001",
  config: {},
  // Monday.com tokens do not expire: no refresh.
  secrets: (workspaceId) => ({ accessToken: `monday_${workspaceId}` }),
  authorization: (workspaceId) => `monday_${workspaceId}`,
  create: GRAPHQL,
  contentType: "application/json",
  query: "",
  // Seam gap: the table types the link URL as a string; Monday.com has none.
  link: {
    externalId: MONDAY_ITEM,
    externalUrl: null as unknown as string,
    externalDisplayId: null,
  },
  // The item create, then the update that the worker sent with it: escaped HTML.
  request: (body, { board, author }) => {
    expect(body).toEqual({
      query: expect.stringContaining(
        "create_item(board_id: $board, item_name: $name)",
      ),
      variables: { board: "4000", name: "Integration post" },
    });
    expect(JSON.parse(updates.at(-1)!.body).variables).toEqual({
      item: MONDAY_ITEM,
      body: `<p>First line</p><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; **bold**</p><p>Submitted by: ${author}</p><p>Board: ${board}</p>`,
    });
  },
};

describeDelivery([monday], (testPool) => (pool = testPool));
