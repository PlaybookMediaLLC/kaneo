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

// Not registered in index.ts: Trello returns its token in the URL fragment, and no page reads it yet.
// providers/README.md ("Trello") gives the design that completes the connect.

const hosts = /^(api\.)?trello\.com$/;
const api = "https://api.trello.com/1";
// A Trello ID has 24 hexadecimal digits.
const id = /^[0-9a-f]{24}$/;
// A Trello token. The rule keeps it safe in the Authorization header.
const token = /^[A-Za-z0-9]{32,256}$/;
// The OAuth header keeps the API key and the token out of the URL.
const auth = (apiKey: string, accessToken: string) => ({
  headers: {
    authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${accessToken}"`,
  },
});

/** The boards or lists of a Trello answer. 502 when the answer is not a list. */
function named(value: unknown) {
  if (!Array.isArray(value)) throw new ProviderCallError(502);
  return value
    .map(record)
    .filter((item) => id.test(text(item.id)))
    .map((item) => ({ id: text(item.id), name: text(item.name) }));
}

export const trello = {
  name: "Trello",
  hosts,
  category: "issue_tracking",
  description: "Connect a Trello account and list its boards and lists.",
  events: [],
  channels: true,
  // The client ID is the Trello API key.
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://trello.com/1/authorize?${form({
      key: creds.clientId!,
      return_url: `${redirectUri}?${form({ state })}`,
      callback_method: "fragment",
      response_type: "token",
      scope: "read,write",
      expiration: "never",
      name: "Quills",
    })}`,
  // `code` is the token from the URL fragment. One call checks it. Trello tokens set to never expire.
  exchange: async (code, _redirectUri, creds) => {
    if (!token.test(code)) throw rejected();
    const member = record(
      await providerJson(
        `${api}/members/me?fields=fullName,username`,
        auth(creds.clientId ?? "", code),
        hosts,
      ),
    );
    const username = text(member.username);
    if (!username) throw rejected();
    return {
      secrets: { accessToken: code },
      workspaceName: text(member.fullName) || username,
      account: username,
    };
  },
  destinationKinds: { board: {}, list: { parent: "board" } },
  // The route checked that a list's board is one of the member's open boards.
  destinations: async (secrets, _config, creds, scope) =>
    named(
      await providerJson(
        scope.kind === "list"
          ? `${api}/boards/${encodeURIComponent(scope.parent ?? "")}/lists?fields=name&filter=open`
          : `${api}/members/me/boards?fields=name&filter=open`,
        auth(creds.clientId ?? "", secrets.accessToken ?? ""),
        hosts,
      ),
    ),
  statuses: [],
} satisfies OAuthProvider;
