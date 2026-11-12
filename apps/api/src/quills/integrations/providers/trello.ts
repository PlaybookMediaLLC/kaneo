// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import { clip, issueBody, issueParts, uncertain } from "../delivery";
import {
  form,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

// Trello returns its token in the URL fragment. The bridge page reads it and posts it to the callback
// (`callback: "fragment"`, see providers/README.md, "Trello").

const hosts = /^(api\.)?trello\.com$/;
const api = "https://api.trello.com/1";
// A Trello ID has 24 hexadecimal digits.
const id = /^[0-9a-f]{24}$/;
// A Trello token, or an API key (32 characters). The rule keeps it safe in the Authorization header.
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
  description: "Create Trello cards from new feedback.",
  events: ["post.created"],
  channels: true,
  // The client ID is the Trello API key.
  credentials: ["clientId", "clientSecret"],
  callback: "fragment",
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
  // A list ID: the child destination. A card belongs to a list.
  target: (target) => id.test(target),
  // A card for a new post, at the top of the list. The description is Markdown, as the post content is.
  deliver: async ({ secrets, app, target, content }) => {
    // The API key (the OAuth app's client ID) and the token enter the Authorization header. A value
    // that does not match, or no saved OAuth app, asks for a reconnect with no call.
    const key = app.clientId ?? "";
    const accessToken = secrets.accessToken ?? "";
    if (!token.test(key) || !token.test(accessToken))
      return { state: "auth_required", errorCode: "authentication" };
    const card = record(
      await providerJson(
        `${api}/cards`,
        {
          method: "POST",
          headers: {
            ...auth(key, accessToken).headers,
            "content-type": "application/json",
            accept: "application/json",
          },
          // The values travel in the JSON body, never in the URL. Trello keeps at most 16384
          // characters of a description.
          body: JSON.stringify({
            idList: target,
            name: issueParts(content).title,
            desc: clip(issueBody({ content }, 2000), 16384),
            pos: "top",
          }),
        },
        hosts,
      ),
    );
    const cardId = text(card.id);
    // A 2xx without a card ID: the card may exist.
    if (!id.test(cardId)) return uncertain;
    const link = URL.parse(text(card.shortUrl))?.href;
    return {
      state: "succeeded",
      result: {
        externalId: cardId,
        externalUrl: link?.startsWith("https://trello.com/") ? link : null,
      },
    };
  },
} satisfies OAuthProvider;
