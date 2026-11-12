import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { ASANA_TASK } from "../../integrations/providers/asana.fixture";
import { deliver, type Delivery } from "./integration-send";
import {
  describeDelivery,
  future,
  type DeliveryCase,
} from "./tracker-delivery.fixture";

// Asana task delivery: the worker evidence table of tracker-delivery.fixture.ts, then the task body
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

const TASKS = "POST /app.asana.com/api/1.0/tasks";

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  provider: "asana",
  credentials: { accessToken: "asana_token", refreshToken: "asana_refresh" },
  app: { clientId: "client", clientSecret: "app-secret" },
  config: { workspaceGid: "1200" },
  target: "1000",
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
const sentBody = () => JSON.parse(providerCalls[0]!.body);

afterEach(() => {
  providerOverrides.clear();
  providerCalls.length = 0;
});

describe("Asana task body and answers", () => {
  it("escapes a hostile title and description, and keeps the JSON intact", async () => {
    const outcome = await deliver(
      delivery({
        content: {
          board: 'Board </body><a href="x">',
          boardId: "board_1",
          post: {
            id: "post_1",
            title: 'Title "}]}\n<b>bold</b> &amp;\u0000',
            content:
              "</body><script>alert(1)</script>\n\u0007bell & <![CDATA[x]]>\n\uD800lone",
            author: "Ada <ada@example.test>",
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ state: "succeeded" });
    expect(sentBody()).toEqual({
      data: {
        // Plain text in JSON: one line, nothing escaped.
        name: 'Title "}]} <b>bold</b> &amp;\u0000',
        html_notes:
          "<body>&lt;/body&gt;&lt;script&gt;alert(1)&lt;/script&gt;\nbell &amp; &lt;![CDATA[x]]&gt;\nlone\n\n" +
          'Submitted by: Ada &lt;ada@example.test&gt;\nBoard: Board &lt;/body&gt;&lt;a href="x"&gt;</body>',
        projects: ["1000"],
        workspace: "1200",
      },
    });
  });

  it("asks for a reconnect with no call for a bad stored workspace, and refuses a channel that is not a gid", async () => {
    for (const workspaceGid of ["../1200", "12a", "", undefined])
      expect(
        await deliver(delivery({ config: { workspaceGid } })),
      ).toMatchObject({ state: "auth_required", errorCode: "authentication" });
    for (const target of ["../1000", "1000/x", "abc", "1".repeat(31)])
      expect(await deliver(delivery({ target }))).toMatchObject({
        state: "failed",
        errorCode: "provider_failed",
      });
    expect(providerCalls).toEqual([]);
  });

  it("links the task only on Asana's own host, and is uncertain without a gid", async () => {
    for (const [permalink, url] of [
      [
        `https://app.asana.com/0/1000/${ASANA_TASK}`,
        `https://app.asana.com/0/1000/${ASANA_TASK}`,
      ],
      ["https://app.asana.com.evil.test/x", null],
      ["https://user@app.asana.com/x", null],
      ["http://app.asana.com/x", null],
      ["https://app.asana.com:8443/x", null],
      [42, null],
    ] as const) {
      providerOverrides.set(TASKS, {
        status: 201,
        body: { data: { gid: ASANA_TASK, permalink_url: permalink } },
      });
      expect(await deliver(delivery()), String(permalink)).toEqual({
        state: "succeeded",
        result: { externalId: ASANA_TASK, externalUrl: url },
      });
    }
    for (const body of [{ data: { gid: "../1" } }, { data: {} }, []]) {
      providerOverrides.set(TASKS, { status: 201, body });
      expect(await deliver(delivery())).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
    }
  });

  it("sends nothing for an event that Asana does not deliver", async () => {
    expect(await deliver(delivery({ type: "comment.created" }))).toEqual({
      state: "succeeded",
    });
    expect(providerCalls).toEqual([]);
  });
});

const asana: DeliveryCase = {
  type: "asana",
  channel: "1000",
  otherChannel: "1001",
  config: { workspaceGid: "1200" },
  secrets: (workspaceId) => ({
    accessToken: `asana_${workspaceId}`,
    refreshToken: `asana_refresh_${workspaceId}`,
    expiresAt: future(),
  }),
  authorization: (workspaceId) => `Bearer asana_${workspaceId}`,
  create: TASKS,
  contentType: "application/json",
  query: "",
  token: "POST /app.asana.com/-/oauth_token",
  refreshedToken: "asana-access",
  refreshedRefreshToken: "asana-refresh",
  link: {
    externalId: ASANA_TASK,
    externalUrl: `https://app.asana.com/0/1000/${ASANA_TASK}`,
    externalDisplayId: null,
  },
  // Asana rich text: every part escaped, no tag but `<body>`.
  request: (body, { board, author }) =>
    expect(body).toEqual({
      data: {
        name: "Integration post",
        html_notes: `<body>First line\n&lt;script&gt;alert(1)&lt;/script&gt; &amp; **bold**\n\nSubmitted by: ${author}\nBoard: ${board}</body>`,
        projects: ["1000"],
        workspace: "1200",
      },
    }),
};

describeDelivery([asana], (testPool) => (pool = testPool));
