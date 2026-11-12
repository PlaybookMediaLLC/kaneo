import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import { encryptSecret } from "../../../notification-preferences/secrets";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import {
  TRELLO_CARD,
  TRELLO_CARD_URL,
  trelloId,
} from "../../integrations/providers/trello.fixture";
import { deliver, type Delivery } from "./integration-send";
import {
  CONTENT,
  describeDelivery,
  type DeliveryCase,
} from "./tracker-delivery.fixture";

// Trello card delivery: the worker evidence table of tracker-delivery.fixture.ts, then the card body
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

const CARDS = "POST /api.trello.com/1/cards";
// Built at run time: no key-like or token-like literal in the source.
const KEY = "key".repeat(11).slice(0, 32);
/** The OAuth app's key in a harness workspace (`…_a` or `…_b`): each workspace saves its own. */
const keyOf = (workspaceId: string) =>
  `${workspaceId.endsWith("_b") ? "b" : "a"}${KEY.slice(1)}`;
const token = (workspaceId: string) =>
  `t${"0".repeat(31)}${workspaceId.replace(/[^A-Za-z0-9]/g, "")}`;
const header = (key: string, accessToken: string) =>
  `OAuth oauth_consumer_key="${key}", oauth_token="${accessToken}"`;

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  provider: "trello",
  credentials: { accessToken: token("unit") },
  app: { clientId: KEY, clientSecret: "app-secret" },
  config: {},
  target: trelloId(11),
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

describe("Trello card body and answers", () => {
  it("sends a hostile title and description in the JSON body, and the key and token only in the header", async () => {
    const outcome = await deliver(
      delivery({
        content: {
          board: "Board",
          boardId: "board_1",
          post: {
            id: "post_1",
            title: 'Title "}]}\n&key=x&token=y',
            content: '"}], "idList": "x"\n<script>alert(1)</script>',
            author: "Ada",
          },
        },
      }),
    );
    expect(outcome).toEqual({
      state: "succeeded",
      result: { externalId: TRELLO_CARD, externalUrl: TRELLO_CARD_URL },
    });
    expect(providerCalls).toHaveLength(1);
    const [call] = providerCalls;
    // No query string: neither the key, the token nor the post text is in the URL.
    expect(call!.path).toBe("/api.trello.com/1/cards");
    expect(call!.authorization).toBe(header(KEY, token("unit")));
    expect(JSON.parse(call!.body)).toEqual({
      idList: trelloId(11),
      name: 'Title "}]} &key=x&token=y',
      desc: '"}], "idList": "x"\n<script>alert(1)</script>\n\n---\n**Submitted by:** Ada\n**Board:** Board',
      pos: "top",
    });
  });

  it("bounds the description to the post's 2000 characters and Trello's 16384", async () => {
    await deliver(
      delivery({
        content: {
          board: "b".repeat(20_000),
          boardId: "board_1",
          post: {
            id: "post_1",
            title: "t".repeat(400),
            content: "c".repeat(3000),
            author: "Ada",
          },
        },
      }),
    );
    const { name, desc } = JSON.parse(providerCalls[0]!.body);
    expect(name).toHaveLength(255);
    expect(desc.startsWith(`${"c".repeat(1999)}…\n`)).toBe(true);
    expect(desc).toHaveLength(16384);
  });

  it("asks for a reconnect with no call when the OAuth app's key or the token is missing or unsafe in a header", async () => {
    for (const [app, accessToken] of [
      [{}, token("unit")],
      [{ clientId: "" }, token("unit")],
      [{ clientId: `${KEY.slice(1)}"` }, token("unit")],
      [{ clientId: "short" }, token("unit")],
      [{ clientId: KEY }, `${token("unit")}\r\nx: y`],
      [{ clientId: KEY }, ""],
    ] as const)
      expect(
        await deliver(delivery({ app, credentials: { accessToken } })),
      ).toEqual({ state: "auth_required", errorCode: "authentication" });
    expect(providerCalls).toHaveLength(0);
  });

  it("refuses a channel that is not a list ID, with no call", async () => {
    for (const target of [
      "../x",
      trelloId(11).toUpperCase().replace("0", "A"),
      `${trelloId(11)}0`,
      "abc",
    ])
      expect(await deliver(delivery({ target }))).toMatchObject({
        state: "failed",
        errorCode: "provider_failed",
      });
    expect(providerCalls).toHaveLength(0);
  });

  it("links the card only on Trello's own host, and is uncertain without a card ID", async () => {
    for (const [shortUrl, url] of [
      [TRELLO_CARD_URL, TRELLO_CARD_URL],
      ["https://trello.com.evil.test/c/x", null],
      ["https://api.trello.com/c/x", null],
      ["https://user@trello.com/c/x", null],
      ["javascript:alert(1)", null],
    ] as const) {
      providerOverrides.set(CARDS, {
        status: 200,
        body: { id: TRELLO_CARD, shortUrl },
      });
      expect(await deliver(delivery()), shortUrl).toEqual({
        state: "succeeded",
        result: { externalId: TRELLO_CARD, externalUrl: url },
      });
    }
    for (const body of [{ id: "../x" }, { id: 7 }, {}]) {
      providerOverrides.set(CARDS, { status: 200, body });
      expect(await deliver(delivery())).toMatchObject({
        state: "uncertain",
        errorCode: "outcome_unknown",
      });
    }
  });
});

const trello: DeliveryCase = {
  type: "trello",
  channel: trelloId(11),
  otherChannel: trelloId(12),
  config: {},
  // Trello tokens set to never expire: no refresh.
  secrets: (workspaceId) => ({ accessToken: token(workspaceId) }),
  authorization: (workspaceId) =>
    header(keyOf(workspaceId), token(workspaceId)),
  create: CARDS,
  contentType: "application/json",
  query: "",
  link: {
    externalId: TRELLO_CARD,
    externalUrl: TRELLO_CARD_URL,
    externalDisplayId: null,
  },
  // Markdown, as the post content is.
  request: (body, { board, author }) =>
    expect(body).toEqual({
      idList: trelloId(11),
      name: "Integration post",
      desc: `${CONTENT}\n\n---\n**Submitted by:** ${author}\n**Board:** ${board}`,
      pos: "top",
    }),
};

// Seam gap: the evidence table saves the workspace's OAuth app only for a provider with a token
// route (`token`). Trello has no refresh, but its delivery needs the app's API key. Until the shared
// fixture saves the app for such a provider, a trigger saves it whenever the table adds a Trello
// connection. Each workspace gets its own key, so the isolation test sees a key from the wrong
// workspace. Remove this block with that fixture change.
describe("Trello with the workspace's OAuth app", () => {
  const seed = "fu3b_trello_app";
  const sealed = (workspace: string) =>
    encryptSecret(
      JSON.stringify({
        clientId: keyOf(workspace),
        clientSecret: "app-secret",
      }),
    )!;
  beforeEach(async () => {
    await pool.query(
      `CREATE OR REPLACE FUNCTION public.${seed}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
         INSERT INTO quills.integration_platform_credentials (workspace_id, id, integration_type, secrets)
         VALUES (NEW.workspace_id, gen_random_uuid(), 'trello',
           CASE WHEN right(NEW.workspace_id, 2) = '_b' THEN '${sealed("_b")}' ELSE '${sealed("_a")}' END)
         ON CONFLICT DO NOTHING;
         RETURN NEW;
       END $$`,
    );
    await pool.query(
      `CREATE OR REPLACE TRIGGER ${seed} AFTER INSERT ON quills.integrations FOR EACH ROW
       WHEN (NEW.integration_type = 'trello') EXECUTE FUNCTION public.${seed}()`,
    );
  });
  afterEach(async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${seed} ON quills.integrations`);
    await pool.query(`DROP FUNCTION IF EXISTS public.${seed}()`);
  });
  describeDelivery([trello], (testPool) => (pool = testPool));
});
