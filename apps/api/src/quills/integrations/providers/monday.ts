// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(auth|api)\.monday\.com$/;
const json = { "content-type": "application/json", accept: "application/json" };
// A board ID is digits. The same rule keeps it valid as a channel ID.
const id = /^[A-Za-z0-9]{1,30}$/;

/** The `data` of one GraphQL query. Monday answers a failed query with 200, `errors` and no `data`: 502. */
async function graphql(accessToken: string, query: string) {
  const { data } = record(
    await providerJson(
      "https://api.monday.com/v2",
      {
        method: "POST",
        headers: { ...json, authorization: accessToken },
        body: JSON.stringify({ query }),
      },
      hosts,
    ),
  );
  if (!data || typeof data !== "object") throw new ProviderCallError(502);
  return record(data);
}

export const monday = {
  name: "Monday.com",
  hosts,
  category: "issue_tracking",
  description: "Connect a Monday.com account and list its boards.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://auth.monday.com/oauth2/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      state,
    })}`,
  // Monday.com access tokens do not expire.
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson(
        "https://auth.monday.com/oauth2/token",
        {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        },
        hosts,
      ),
    );
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    const me = record(
      (await graphql(accessToken, "{ me { name account { name } } }")).me,
    );
    return {
      secrets: { accessToken },
      workspaceName: text(record(me.account).name) || "Monday.com",
      account: text(me.name) || null,
    };
  },
  destinations: async (secrets) => {
    const boards = (
      await graphql(
        secrets.accessToken ?? "",
        "{ boards(limit: 100, order_by: used_at) { id name } }",
      )
    ).boards;
    if (!Array.isArray(boards)) throw new ProviderCallError(502);
    return boards
      .map(record)
      .filter((board) => id.test(text(board.id)))
      .map((board) => ({ id: text(board.id), name: text(board.name) }));
  },
  statuses: [],
} satisfies OAuthProvider;
