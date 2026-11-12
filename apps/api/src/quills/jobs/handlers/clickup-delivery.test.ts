import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { CLICKUP_TASK } from "../../integrations/providers/clickup.fixture";
import { deliver, type Delivery } from "./integration-send";
import {
  CONTENT,
  describeDelivery,
  type DeliveryCase,
} from "./tracker-delivery.fixture";

// ClickUp task delivery: the worker evidence table of tracker-delivery.fixture.ts, then the task body
// and the answers of the provider without a database.

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

const TASKS = "POST /api.clickup.com/api/v2/list/3000/task";

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  provider: "clickup",
  credentials: { accessToken: "clickup_token" },
  app: { clientId: "client", clientSecret: "app-secret" },
  config: { teamId: "900" },
  target: "3000",
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

afterEach(() => {
  providerOverrides.clear();
  providerCalls.length = 0;
});

describe("ClickUp task body and answers", () => {
  it("sends a hostile title and description as plain text, with the JSON intact", async () => {
    const outcome = await deliver(
      delivery({
        content: {
          board: "Board **x**",
          boardId: "board_1",
          post: {
            id: "post_1",
            title: 'Title "}]}\n\t<b>bold</b>',
            content:
              '"}], "name": "x"\n<script>alert(1)</script>\n\n[link](https://evil.test)',
            author: "Ada\r\nInjected: header",
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ state: "succeeded" });
    expect(providerCalls).toHaveLength(1);
    expect(JSON.parse(providerCalls[0]!.body)).toEqual({
      name: 'Title "}]} <b>bold</b>',
      description:
        '"}], "name": "x"\n<script>alert(1)</script>\n[link](https://evil.test)\n\n' +
        "Submitted by: Ada\r\nInjected: header\nBoard: Board **x**",
    });
    // Only the two fields: a description is never read as Markdown.
    expect(Object.keys(JSON.parse(providerCalls[0]!.body))).toEqual([
      "name",
      "description",
    ]);
  });

  it("refuses a channel that is not a list ID, with no call", async () => {
    for (const target of ["../3000", "3000/task", "abc", "1".repeat(31)])
      expect(await deliver(delivery({ target }))).toMatchObject({
        state: "failed",
        errorCode: "provider_failed",
      });
    expect(providerCalls).toEqual([]);
  });

  it("links the task only on ClickUp's own host, and is uncertain without an ID", async () => {
    for (const [url, link] of [
      [
        `https://app.clickup.com/t/${CLICKUP_TASK}`,
        `https://app.clickup.com/t/${CLICKUP_TASK}`,
      ],
      ["https://app.clickup.com.evil.test/t/x", null],
      ["https://api.clickup.com/t/x", null],
      ["https://user:pw@app.clickup.com/t/x", null],
      [null, null],
    ] as const) {
      providerOverrides.set(TASKS, {
        status: 200,
        body: { id: CLICKUP_TASK, url },
      });
      expect(await deliver(delivery()), String(url)).toEqual({
        state: "succeeded",
        result: { externalId: CLICKUP_TASK, externalUrl: link },
      });
    }
    for (const body of [{ id: "../x" }, { id: 42 }, {}, "text"]) {
      providerOverrides.set(TASKS, { status: 200, body });
      expect(await deliver(delivery())).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
    }
  });
});

const clickup: DeliveryCase = {
  type: "clickup",
  channel: "3000",
  otherChannel: "3001",
  config: { teamId: "900" },
  // ClickUp tokens do not expire: no refresh.
  secrets: (workspaceId) => ({ accessToken: `clickup_${workspaceId}` }),
  authorization: (workspaceId) => `Bearer clickup_${workspaceId}`,
  create: TASKS,
  contentType: "application/json",
  query: "",
  link: {
    externalId: CLICKUP_TASK,
    externalUrl: `https://app.clickup.com/t/${CLICKUP_TASK}`,
    externalDisplayId: null,
  },
  // Plain text: the post's Markdown and markup stay as typed.
  request: (body, { board, author }) =>
    expect(body).toEqual({
      name: "Integration post",
      description: `${CONTENT.replace("\n\n", "\n")}\n\nSubmitted by: ${author}\nBoard: ${board}`,
    }),
};

describeDelivery([clickup], (testPool) => (pool = testPool));
