// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  callFailed,
  issueParts,
  statusOutcome,
  uncertain,
  type Outcome,
} from "../delivery";
import {
  form,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(auth|api)\.monday\.com$/;
const json = { "content-type": "application/json", accept: "application/json" };
// A board or item ID is digits. The same rule keeps a board ID valid as a channel ID.
const id = /^\d{1,30}$/;

/** One GraphQL request. Returns the whole answer: `data`, and `errors` when Monday refused it. */
const graphqlAnswer = async (
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
) =>
  record(
    await providerJson(
      "https://api.monday.com/v2",
      {
        method: "POST",
        headers: { ...json, authorization: accessToken },
        body: JSON.stringify({ query, variables }),
      },
      hosts,
    ),
  );

/** The `data` of one GraphQL query. Monday answers a failed query with 200, `errors` and no `data`: 502. */
async function graphql(accessToken: string, query: string) {
  const { data } = await graphqlAnswer(accessToken, query);
  if (!data || typeof data !== "object") throw new ProviderCallError(502);
  return record(data);
}

// The values are GraphQL variables, never query text.
const CREATE_ITEM = `mutation CreateItem($board: ID!, $name: String!) {
  create_item(board_id: $board, item_name: $name) { id }
}`;
const CREATE_UPDATE = `mutation CreateUpdate($item: ID!, $body: String!) {
  create_update(item_id: $item, body: $body) { id }
}`;
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The GraphQL errors of an answer without an item. Only a refusal proves that no item exists: every
 * error has the same 4xx `status_code` (mapped as that HTTP status) or a 4xx of several kinds
 * (`failed`). Any other answer is uncertain.
 */
function refusal(errors: unknown): Outcome {
  const statuses = [
    ...new Set(
      list(errors).map((error) =>
        Number(record(record(error).extensions).status_code),
      ),
    ),
  ];
  if (!statuses.length || !statuses.every((s) => s >= 400 && s < 500))
    return uncertain;
  return statuses.length === 1
    ? statusOutcome(statuses[0]!, false)
    : { state: "failed", errorCode: "provider_failed" };
}

export const monday = {
  name: "Monday.com",
  hosts,
  category: "issue_tracking",
  description: "Create Monday.com items from new feedback.",
  events: ["post.created"],
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
  // A board ID, the destination ID.
  target: (target) => id.test(target),
  // An item for a new post, then an update on it with the post as escaped HTML. Two calls.
  deliver: async ({ secrets, target, content }) => {
    const token = secrets.accessToken ?? "";
    const { title, paragraphs, footer } = issueParts(content);
    const answer = await graphqlAnswer(token, CREATE_ITEM, {
      board: target,
      name: title,
    });
    const item = text(record(record(answer.data).create_item).id);
    if (!id.test(item))
      // An answer that names `create_item` without a valid ID may follow a create.
      return record(answer.data).create_item
        ? uncertain
        : refusal(answer.errors);
    // The item exists, so the update must never throw: the worker would map its refusal to `failed`,
    // which offers a retry and so a second item. A failed update leaves the item without the body:
    // the delivery still succeeded, and its error code shows the sync history why.
    const failure = await graphqlAnswer(token, CREATE_UPDATE, {
      item,
      body: [...paragraphs, ...footer]
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join(""),
    }).then(
      (update) =>
        id.test(text(record(record(update.data).create_update).id))
          ? undefined
          : refusal(update.errors).errorCode,
      (error: unknown) => callFailed(error).errorCode,
    );
    // Monday.com item URLs name the account's own subdomain, which is not stored: no link URL.
    return {
      state: "succeeded",
      ...(failure && { errorCode: failure }),
      result: { externalId: item, externalUrl: null },
    };
  },
} satisfies OAuthProvider;
