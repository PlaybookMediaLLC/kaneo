import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { catalog } from "../catalog";
import { oauthProviders } from "./index";
import { trello } from "./trello";

// Trello is not registered (connect deferred), so the local provider server does not serve its hosts.
// These tests answer fetch here. No request reaches a network.

const KEY = "trello-key";
const TOKEN = "a".repeat(64);
const board = (i: number) => i.toString(16).padStart(24, "0");
const calls: { url: string; authorization: string }[] = [];
function answer(routes: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url: url.href,
      authorization: new Headers(init?.headers).get("authorization") ?? "",
    });
    const body = routes[`${url.hostname}${url.pathname}`];
    return body === undefined
      ? Response.json({ message: "Not found" }, { status: 404 })
      : Response.json(body);
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  calls.length = 0;
});

describe("Trello provider (not registered)", () => {
  it("stays out of the registry and not available in the catalog", () => {
    expect(Object.keys(oauthProviders)).not.toContain("trello");
    expect(catalog.find((entry) => entry.id === "trello")).toMatchObject({
      available: false,
    });
  });

  it("asks Trello to return the token in the fragment of the callback URL", () => {
    const url = new URL(
      trello.authorizeUrl(
        { clientId: KEY },
        "https://kaneo.test/api/quills-public/signed/oauth/trello/callback",
        "payload.signature",
      ),
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://trello.com/1/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      key: KEY,
      return_url:
        "https://kaneo.test/api/quills-public/signed/oauth/trello/callback?state=payload.signature",
      callback_method: "fragment",
      response_type: "token",
      expiration: "never",
    });
  });

  it("checks the token with one call that keeps it out of the URL", async () => {
    answer({
      "api.trello.com/1/members/me": {
        username: "contract",
        fullName: "Contract",
      },
    });
    expect(await trello.exchange(TOKEN, "", { clientId: KEY })).toEqual({
      secrets: { accessToken: TOKEN },
      workspaceName: "Contract",
      account: "contract",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).not.toContain(TOKEN);
    expect(calls[0]!.authorization).toBe(
      `OAuth oauth_consumer_key="${KEY}", oauth_token="${TOKEN}"`,
    );
  });

  it("refuses a token that is not safe in a header, and a malformed member, with a fixed error", async () => {
    answer({ "api.trello.com/1/members/me": { message: "provider text" } });
    for (const code of ['a"b', "short", `${TOKEN}\r\nx: y`])
      await expect(
        trello.exchange(code, "", { clientId: KEY }),
      ).rejects.toMatchObject({
        status: 400,
        message: "The provider rejected the request.",
      });
    expect(calls).toEqual([]);
    await expect(
      trello.exchange(TOKEN, "", { clientId: KEY }),
    ).rejects.toMatchObject({
      status: 400,
      message: "The provider rejected the request.",
    });
  });

  it("lists open boards and the open lists of one board, with valid IDs only", async () => {
    answer({
      "api.trello.com/1/members/me/boards": [
        { id: board(1), name: "Roadmap" },
        { id: "../x", name: "Not an ID" },
      ],
      [`api.trello.com/1/boards/${board(1)}/lists`]: [
        { id: board(2), name: "Inbox" },
      ],
    });
    const secrets = { accessToken: TOKEN };
    const creds = { clientId: KEY };
    expect(await trello.destinations(secrets, {}, creds, {})).toEqual([
      { id: board(1), name: "Roadmap" },
    ]);
    expect(
      await trello.destinations(secrets, {}, creds, {
        kind: "list",
        parent: board(1),
      }),
    ).toEqual([{ id: board(2), name: "Inbox" }]);
    expect(calls.map((call) => new URL(call.url).search)).toEqual([
      "?fields=name&filter=open",
      "?fields=name&filter=open",
    ]);
    expect(trello.destinationKinds).toEqual({
      board: {},
      list: { parent: "board" },
    });
  });

  it("answers 502 for a list answer that is not a list", async () => {
    answer({ "api.trello.com/1/members/me/boards": { message: "x" } });
    await expect(
      trello.destinations({ accessToken: TOKEN }, {}, { clientId: KEY }, {}),
    ).rejects.toMatchObject({ status: 502 });
  });
});
