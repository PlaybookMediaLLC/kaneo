import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import {
  NOTION_DATABASE,
  NOTION_PAGE,
  NOTION_PAGE_URL,
} from "../../integrations/providers/notion.fixture";
import { deliver, type Delivery } from "./integration-send";
import {
  describeDelivery,
  type DeliveryCase,
} from "./tracker-delivery.fixture";

// Notion page delivery: the worker evidence table of tracker-delivery.fixture.ts, then the page body
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

const PAGES = "POST /api.notion.com/v1/pages";
const paragraph = (content: string) => ({
  object: "block",
  type: "paragraph",
  paragraph: { rich_text: [{ type: "text", text: { content } }] },
});
const divider = { object: "block", type: "divider", divider: {} };

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  provider: "notion",
  credentials: { accessToken: "notion_token" },
  app: { clientId: "client", clientSecret: "app-secret" },
  config: {},
  target: NOTION_DATABASE,
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

describe("Notion page body and answers", () => {
  it("sends a hostile title and description as plain rich text, with the JSON intact", async () => {
    const outcome = await deliver(
      delivery({
        content: {
          board: "Board",
          boardId: "board_1",
          post: {
            id: "post_1",
            title: 'Title "}]}\n<b>bold</b> **x**',
            content: '"}]}, "children": []\n<script>alert(1)</script>',
            author: "Ada",
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ state: "succeeded" });
    expect(providerCalls[0]!.authorization).toBe("Bearer notion_token");
    expect(sentBody()).toEqual({
      parent: { database_id: NOTION_DATABASE },
      properties: {
        title: {
          title: [{ text: { content: 'Title "}]} <b>bold</b> **x**' } }],
        },
      },
      children: [
        paragraph('"}]}, "children": []'),
        paragraph("<script>alert(1)</script>"),
        divider,
        paragraph("Submitted by: Ada"),
        paragraph("Board: Board"),
      ],
    });
  });

  it("keeps a post of many lines within Notion's 100 blocks and 2000 characters a text", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `L${i}`);
    await deliver(
      delivery({
        content: {
          ...delivery().content,
          post: { ...delivery().content.post, content: lines.join("\n") },
        },
      }),
    );
    const { children } = sentBody() as {
      children: {
        paragraph?: { rich_text: { text: { content: string } }[] };
      }[];
    };
    expect(children).toHaveLength(100);
    expect(children[95]).toEqual(paragraph("L95"));
    // The lines after the 96th, within the 2000 characters that the post keeps, in one paragraph.
    const last = children[96]!.paragraph!.rich_text[0]!.text.content;
    expect(last.startsWith("L96\nL97\n")).toBe(true);
    expect(last.length).toBeLessThanOrEqual(2000);
    expect(children.at(-1)).toEqual(paragraph("Board: Ideas"));
  });

  it("refuses a channel that is not a database UUID, with no call", async () => {
    for (const target of [
      "../x",
      NOTION_PAGE.toUpperCase(),
      NOTION_DATABASE.replaceAll("-", ""),
      "abc",
    ])
      expect(await deliver(delivery({ target }))).toMatchObject({
        state: "failed",
        errorCode: "provider_failed",
      });
    expect(providerCalls).toEqual([]);
  });

  it("links the page only on Notion's own host, and is uncertain without a page ID", async () => {
    for (const [url, link] of [
      [NOTION_PAGE_URL, NOTION_PAGE_URL],
      ["https://www.notion.so.evil.test/x", null],
      ["https://evil.notion.site/x", null],
      ["http://www.notion.so/x", null],
      [undefined, null],
    ] as const) {
      providerOverrides.set(PAGES, {
        status: 200,
        body: { id: NOTION_PAGE, url },
      });
      expect(await deliver(delivery()), String(url)).toEqual({
        state: "succeeded",
        result: { externalId: NOTION_PAGE, externalUrl: link },
      });
    }
    for (const body of [
      { id: "../x" },
      { id: NOTION_PAGE.toUpperCase() },
      {},
    ]) {
      providerOverrides.set(PAGES, { status: 200, body });
      expect(await deliver(delivery())).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
    }
  });
});

const notion: DeliveryCase = {
  type: "notion",
  channel: NOTION_DATABASE,
  otherChannel: "00000000-0000-4000-8000-000000000001",
  config: {},
  // Notion tokens do not expire: no refresh.
  secrets: (workspaceId) => ({ accessToken: `notion_${workspaceId}` }),
  authorization: (workspaceId) => `Bearer notion_${workspaceId}`,
  create: PAGES,
  contentType: "application/json",
  query: "",
  link: {
    externalId: NOTION_PAGE,
    externalUrl: NOTION_PAGE_URL,
    externalDisplayId: null,
  },
  // Plain rich text: the post's markup and Markdown stay as typed.
  request: (body, { board, author }) =>
    expect(body).toEqual({
      parent: { database_id: NOTION_DATABASE },
      properties: {
        title: { title: [{ text: { content: "Integration post" } }] },
      },
      children: [
        paragraph("First line"),
        paragraph("<script>alert(1)</script> & **bold**"),
        divider,
        paragraph(`Submitted by: ${author}`),
        paragraph(`Board: ${board}`),
      ],
    }),
};

describeDelivery([notion], (testPool) => (pool = testPool));
