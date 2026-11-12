# OAuth and key providers

Each provider is one file in this folder. `index.ts` collects the files in one registry,
`oauthProviders`. The registry drives:

- the catalog entry (`../catalog.ts`),
- the connect route `GET /quills/{workspaceId}/oauth/<key>/connect` and its OpenAPI operation,
- the `type` values of the OAuth callback and of the platform-credential routes,
- the destinations route (`GET /integrations/{integrationId}/destinations`),
- the token refresh in routes (`freshSecrets`),
- the deliveries of the worker (`deliver`, see "Add delivery to a provider"),
- the hosts that tests send to the local provider server.

Issue #131 counts the connect and list entry points only. Status sync (inbound) is out of scope.

## Add a provider

1. Add `providers/<file>.ts`. Copy the first line (the route-module comment) from `github.ts`, so that
   `framework/boundaries.test.ts` checks the imports of the file.
2. Export one object and end it with `satisfies OAuthProvider`:

   ```ts
   const hosts = /(auth|api)\.atlassian\.com/;
   // Every call passes the hosts: providerJson(url, init, hosts).
   export const jira = {
     name: "Jira",
     hosts,
     category: "issue_tracking",
     description: "Create Jira issues from new feedback.",
     events: [],
     channels: true,
     credentials: ["clientId", "clientSecret"],
     authorizeUrl: (creds, redirectUri, state) => "…",
     exchange: async (code, redirectUri, creds) => ({ … }),
     destinations: async (secrets, config, creds, scope) => [],
     statuses: [],
   } satisfies OAuthProvider;
   ```

3. Add two lines to `index.ts`: the import, and one entry after the last entry.

   ```ts
   import { jira } from "./jira";
     jira,
   ```

   The key is the integration type. It must be the id of the provider in the "not available" list in
   `../catalog.ts`. For Azure DevOps, write `import { azureDevops } from "./azure-devops";` and
   `azure_devops: azureDevops,`. `../catalog.test.ts` fails when the key is wrong.
4. Run `pnpm openapi:check:fix` from the repository root. The connect route of an OAuth provider is
   new: `startQuills<Key>OAuthConnect`, for example `startQuillsHubspotOAuthConnect`.
5. Do not add a connect fixture. `../oauth.fixture.ts` already holds one for each RFC 0001 OAuth
   provider except Trello (see "Trello"). Write fixtures for your own new routes in
   `providers/<file>.fixture.ts`, and add one line to `../index.fixture.ts`:
   `export * from "./providers/<file>.fixture";`.
6. For a test that calls the provider, add the local answers in your fixture file. Do not edit the
   shared function:

   ```ts
   import { providerAnswers } from "../provider-edge.fixture";
   providerAnswers.push((route) =>
     route === "POST /auth.atlassian.com/oauth/token"
       ? { access_token: "contract", refresh_token: "contract", expires_in: 3600 }
       : undefined,
   );
   ```

   The edge sends every host that matches a registered provider's `hosts` to the local server.
   `providerOverrides` sets a status or a dropped answer for one test.

## Rules

- **Use `satisfies OAuthProvider`, not a type annotation.** An annotated OAuth provider drops out of
  `OAuthProviderType`: the connect route then exists, but the typed client does not know it.
- **No import cycle.** A provider file imports values only from `../oauth-providers` and
  `../../framework/integration-config`. It never imports a value from `./index`, `../catalog`,
  `../connect` or `../oauth`. A type import (`import type`) is safe.
- **Fixed hosts.** Pass the provider's `hosts` to each call: `providerJson(url, init, hosts)`.
  `providerJson` then refuses any other host; the whole host name must match, and flags are ignored.
  Without `hosts`, it allows only the hosts of the first four providers. Build a host only from a
  validated value and a fixed domain suffix, never from free text.
- **Check stored values again.** Check a value from `config` (a cloud ID, a subdomain, an instance URL)
  against a strict pattern before it enters a URL. Encode each path value with `encodeURIComponent`.
- **Secrets.** Tokens go only into `secrets` (sealed, never returned). `config` holds non-secret
  values. The integration summary shows only `workspaceName` and `account` from it.
- **Refresh.** `refresh` returns only `accessToken`, `refreshToken` and `expiresAt`. The stores keep
  only these fields. A provider that must store another refreshed value reports it to lane Z.
- **`events: []`.** Keep it empty until the provider has `deliver`. A provider with events and no
  `deliver` fails each delivery, and `jobs/handlers/provider-send.test.ts` fails.
- **No transaction.** The routes call a provider with no database transaction open. A provider
  function never gets a database handle.
- **Errors.** Use `providerJson`. It throws `ProviderCallError` with the status only; provider text
  never reaches a response.
- **Bot tokens.** A credential named `botToken` is required at save time (Discord).

## Capabilities

| Field | Meaning | Used by |
|---|---|---|
| `hosts` | Every host that the provider calls | `providerJson`, test edge |
| `credentials` | Platform credential fields of the OAuth app | credentials routes |
| `authorizeUrl`, `exchange` | OAuth redirect and code exchange | connect route, callback |
| `connectFields` | Values that a teammate enters before the redirect | connect route, callback |
| `connectWithKey` | Connect with a key, not OAuth | the provider's own route module |
| `destinations`, `destinationKinds` | Channel targets, by kind | destinations route |
| `search` | Issue search in one channel | external-items route |
| `target` | Channel ID rule. Absent: 1 to 30 letters and digits | channel add, search, delivery |
| `refresh` | New token fields for a due access token | `freshSecrets`, delivery (also once after a 401) |
| `contact` | CRM lookup by email | the contacts route module (lane P3) |
| `statuses` | Statuses that an inbound webhook reports | status sync (not in #131) |
| `events` | The event types that `deliver` sends | channel add (`checkEvents`), fan-out |
| `deliver` | Sends one delivery | the worker (`jobs/handlers/integration-send.ts`) |
| `deliveryScopes` | OAuth scopes that `deliver` needs | the worker, before any call |

## Add delivery to a provider

The worker (`jobs/handlers/integration.ts` and `integration-send.ts`) is provider-neutral. It claims the
operation and writes the receipt (the attempt, `running`, a 5-minute lease) before any call, then for a
provider in this registry:

1. skips an event that is not in `events` (`succeeded`, no call);
2. asks for a reconnect (`auth_required`, code `write_access_required`, no call) when `deliveryScopes`
   are not all in `config.scopes`;
3. refreshes a due token with `refresh` (a refused refresh: reconnect; no answer or a 5xx: retry);
4. refuses a channel that fails `target` (`failed`, no call);
5. calls `deliver` with no transaction open;
6. maps a thrown `ProviderCallError`: 401 with `refresh` refreshes once and calls `deliver` once more;
   401 or 403 asks for a reconnect; 408 or 429 retries; another 4xx fails; a 5xx or no answer is
   `uncertain` and is never sent again;
7. stores the outcome, the refreshed tokens and a `post_external_links` row for `result` in one
   transaction. Fan-out creates one create per installation, post and channel, and none for a post that
   an earlier installation already linked in the channel.

A later lane edits only its provider file, its fixture and its tests:

1. In `providers/<file>.ts`, set:
   - `events`: the event types that the source's `hook.ts` delivers (a tracker: `["post.created"]`).
   - `target`: a strict rule for the channel ID. A channel that names two values joins them with `:`
     (Jira `<project ID>:<issue type ID>`). The channel route accepts 1 to 100 characters without
     `/ \ ? # %` or control characters, then this rule; a rule never needs a route change.
   - `deliver: async ({ secrets, config, app, target, type, content }) => Outcome`:
     - Build every URL from a fixed host and the provider's `hosts`: `providerJson(url, init, hosts)`.
       Check each `config` value again before it enters a URL; return
       `{ state: "auth_required", errorCode: "authentication" }` for a bad one, with no call.
     - Encode each path value with `encodeURIComponent`.
     - Make the body with the shared builders in `../delivery.ts`: `issueParts(content)` (a one-line
       title of at most 255 characters, paragraphs of at most 2000 characters, the footer) or
       `issueBody({ content }, 2000)` (Markdown). Escape for the provider's format: HTML with an
       escape function, Jira-style documents with plain text nodes, chat with `chatText`.
     - Let a refused call throw; the worker maps it. Return `uncertain` for a 2xx answer without the
       created ID. Return `{ state: "succeeded", result: { externalId, externalUrl, externalDisplayId? } }`;
       keep `externalUrl` only on the provider's own HTTPS host, or build it from a fixed host.
     - A chat message (not a create) that may resend on a 5xx catches the error and returns
       `callFailed(error, false)`, as `slack.ts` does.
   - `deliveryScopes` (OAuth only): the write scopes. Ask for them in `authorizeUrl`, and store
     `config.scopes: grantedScopes(token, SCOPE)` in `exchange`. A connection made before the change
     then gets the fixed reconnect state.
2. In `providers/<file>.fixture.ts`, add the create answer with `providerAnswers.push`.
3. Add `jobs/handlers/<file>-delivery.test.ts`. Copy `tracker-delivery.test.ts`: its two `vi.mock`
   calls, one `DeliveryCase` row (the channel, config, secrets, authorization header, create route,
   token route, link and expected request body) and `describeDelivery([row], (p) => (pool = p))`.
   `tracker-delivery.fixture.ts` then runs the worker evidence for it: success and link, replay,
   reconnect and resync, lost and expired leases, retries, uncertain outcomes, 401 refresh, 403 and
   missing scopes, fixed errors, workspace isolation and an outcome rollback. Unit tests for the
   provider's answers and target rule go in the same file or in its provider test.
   The table assumes a create with a linked item. A chat provider (Teams) has no link and may retry a
   5xx: it writes its own cases in that file and keeps the same evidence list.
4. Fill the provider's heading in `../ROUTES-OAUTH.md`: events, scopes, the target and the differences
   from the source. Existing connections must reconnect when the scopes change: say so.

Nothing else changes: not `integration-send.ts`, `integration.ts`, `channels.ts`, `catalog.ts`,
`delivery.ts`, `index.ts` or a shared test file.

## Destination kinds and parents

A provider with one kind of destination needs nothing more. A provider with more kinds declares them:

```ts
destinationKinds: { project: {}, "issue-type": { parent: "project" } },
destinations: async (secrets, config, creds, scope) =>
  scope.kind === "issue-type" ? issueTypes(scope.parent!) : projects(),
```

- Without `kind`, the route lists the default kind (`scope.kind` is undefined).
- The route refuses an unknown kind, a child kind without `parent`, and a `parent` for a kind that has
  no parent (400). It does this before any provider call.
- For a child kind, the route first lists the parent kind. It refuses a `parent` that is not in that
  list (404). So the provider gets only a parent that it listed itself.
- `parent` has at most 200 characters, and no `/`, `\`, `?`, `#`, `%` or control characters. Spaces
  are allowed (an Azure DevOps project name).
- One level of parents only.

## Connect fields

A provider that needs a value before the redirect declares it with the pattern that the whole value
must match. The route adds the anchors. Write the pattern without flags: a flag also enters the
OpenAPI pattern text.

```ts
connectFields: { subdomain: /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/ },
authorizeUrl: (creds, redirectUri, state, fields) =>
  `https://${fields.subdomain}.zendesk.com/oauth/authorizations/new?…`,
exchange: async (code, redirectUri, creds, fields) => ({ …, config: { subdomain: fields.subdomain! } }),
```

- The connect route takes each field as a required query value (at most 253 characters). A value that
  does not match is 400.
- The signed OAuth state carries the values. An altered value breaks the signature (401).
- The callback checks the values again and passes them to `exchange`.
- The typed client has one type for all connect routes, with no query. A client adds the fields as
  query values itself.
- The first provider in the registry (GitHub) must have no connect fields.

## Key providers (Azure DevOps)

A key provider declares `connectWithKey` and no `authorizeUrl` or `exchange`. It has no OAuth connect
route, no callback and no platform credentials (`credentials: []`). It still gets the catalog entry and
the destinations route.

Its connect route is a route module of its own, as `../freshdesk.ts` is for Freshdesk. A generic route
would need a different body for each provider, and a route mounted in a loop has no client type.

1. Add `../azure-devops.ts` with `defineQuillsRoute`: `PUT /integrations/azure-devops/connection`,
   operation `saveQuillsAzureDevopsKey`, action `manage_settings`.
2. The body has bounded fields only, for example `token` (`credentialText`, at most 500) and
   `organization` (a strict pattern for an Azure DevOps organization name).
3. In `load`, seal first (`sealCredentials`), then call `connectWithKey` (one provider call, no
   transaction). The handler calls `connect(db, actor, "azure_devops", …)`. The event is
   `connectedEvent` (`integration.connected`).
4. Mount it with one line in `../index.ts`. Add its fixture in `providers/azure-devops.fixture.ts` and
   one line in `../index.fixture.ts`.

## Contact lookup and customer context (lane P3)

`../oauth.ts` exports `oauthConnection`, `withToken` and `keepRefreshed`. A new route module uses them
in the same order as `listQuillsIntegrationDestinations`:

- `prepare`: `oauthConnection(db, params.integrationId)`. Answer 409 when the provider has no `contact`.
- `call`: `withToken(prepared, (secrets) => provider.contact(secrets, config, query.email))`.
- `failure`: `called.failure`.
- `handler`: `keepRefreshed(db, called.connection, called.refreshed)`, then return only the selected
  and bounded `Contact` fields.

## Trello (connect deferred)

Trello returns its token in the URL fragment (`#token=…`), not as a `code` query value. A server never
receives a fragment. A page in the browser must read it and post it back. No such page exists yet.

What exists now: the connect route can build the authorization URL
(`https://trello.com/1/authorize?key=…&return_url=<callback>?state=…&callback_method=fragment&response_type=token&scope=read,write&expiration=never`).

The design that completes it (from `lib/server/integrations/oauth-fragment.ts` in the reference):

1. The provider declares `callback: "fragment"`.
2. The GET callback for such a provider answers an HTML bridge page. It does not consume the state.
   The page reads `token` from `location.hash`, removes the fragment with `history.replaceState`, and
   posts `{ token }` as JSON to the same URL with `credentials: "same-origin"`. Headers:
   `Content-Security-Policy: default-src 'none'; script-src 'nonce-…'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
   `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
3. A signed `POST /quills-public/signed/oauth/{type}/callback?state=…` route, for fragment providers
   only. It uses the same `oauthState` verifier: valid signature, unexpired, same session account,
   still holds `quills:manage_settings`, single use. It also requires an `Origin` header equal to the
   API origin. The body is at most 4 KiB. The token is a secret: it never enters a log, an event or a
   response.
4. The handler calls `exchange(token, …)`. For Trello, `exchange` checks the token with
   `GET https://api.trello.com/1/members/me` and returns it as the secret. Then it calls `connect`.

What is missing:

- `framework/define-route.ts` cannot answer `text/html` for a signed route. Its `raw` option allows
  only RSS and XML for portal, widget and public reads. Lane X1 owns that file.
- The POST route and the `callback: "fragment"` option, in `../oauth.ts`. They are small once the
  HTML answer exists.

Until then, lane P2 can write `providers/trello.ts` but must not register it. Trello then stays "not
available" in the catalog. A registered Trello would offer a connect that cannot complete.

## Notes for each lane

### P1: Jira, Linear, Azure DevOps

- **Jira** (`jira`): `hosts: /^(auth|api)\.atlassian\.com$/`.
  - Scope `offline_access`. `refresh` uses `https://auth.atlassian.com/oauth/token` (rotating refresh tokens).
  - `exchange` reads `GET https://api.atlassian.com/oauth/token/accessible-resources` and stores the
    cloud ID in `config.cloudId`.
  - Each call checks `config.cloudId` against a UUID pattern before it builds
    `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/…`.
  - `destinationKinds: { project: {}, "issue-type": { parent: "project" } }`. `fetchJiraProjectsFn` is
    `?kind=project`; `fetchJiraIssueTypesFn` is `?kind=issue-type&parent=<project ID>`.
- **Linear** (`linear`): `hosts: /^(api\.)?linear\.app$/`. One kind (teams): `fetchLinearTeamsFn` is the
  default list. Linear uses refresh tokens.
- **Azure DevOps** (`azure_devops`, file `azure-devops.ts`): a key provider. Follow "Key providers".
  - `hosts: /^dev\.azure\.com$/`.
  - Check the organization against a strict pattern, then build `https://dev.azure.com/<organization>/…`
    with `encodeURIComponent`.
  - Auth header: `Basic base64(":" + token)`.
  - `destinationKinds: { project: {}, "work-item-type": { parent: "project" } }`. The parent is the
    project name.
- **Delivery (FU3a):** the three providers deliver `post.created` (see `../ROUTES-OAUTH.md`). Jira and
  Linear ask for write scopes and store `config.scopes`; a connection made before FU3a reconnects.

### P2: Asana, ClickUp, Trello, Monday, Notion

- **Asana** (`asana`): `hosts: /^app\.asana\.com$/`. One kind (projects). Asana uses refresh tokens.
- **ClickUp** (`clickup`): `hosts: /^(app|api)\.clickup\.com$/`.
  `destinationKinds: { space: {}, list: { parent: "space" } }`.
- **Trello** (`trello`): connect deferred (see "Trello"). Its kinds would be
  `{ board: {}, list: { parent: "board" } }`.
- **Monday** (`monday`): `hosts: /^(auth|api)\.monday\.com$/`. One kind (boards).
- **Notion** (`notion`): `hosts: /^api\.notion\.com$/`. One kind (databases). The token exchange uses
  HTTP Basic authentication with the client ID and secret.
- **Delivery** (follow "Add delivery to a provider"). Each source hook delivers `post.created` only, so
  `events: ["post.created"]`. None of these OAuth apps lists scopes in `authorizeUrl` today (the app
  settings grant them), so `deliveryScopes` is not needed; a 403 asks for a reconnect.
  - Asana: `POST https://app.asana.com/api/1.0/tasks` with
    `{ data: { name, html_notes, projects: [<project gid>], workspace: config.workspaceGid } }`. Check
    `config.workspaceGid` (digits) again. `html_notes` is Asana's rich text: escape every part and use
    only `<body>`, `<strong>` and line breaks. Target: the project gid (digits). Result: `data.gid`;
    keep `data.permalink_url` only on `https://app.asana.com`.
  - ClickUp: `POST https://api.clickup.com/api/v2/list/<list ID>/task` with `{ name, description }`
    (plain text; ClickUp also takes `markdown_description`). The channel is the list (the child kind);
    target: the list ID (digits). Result: `id`; keep `url` only on `https://app.clickup.com`.
  - Monday: two GraphQL calls on `https://api.monday.com/v2`, `authorization: <token>` with no `Bearer`:
    `create_item(board_id, item_name)`, then `create_update(item_id, body)`. Pass the values as GraphQL
    variables, never in the query text. Once `create_item` answered with an ID, the item exists: catch
    any failure of `create_update` and return `succeeded` with the item (the source returns
    `uncertain`; either way never let it throw, or the worker would map a 4xx to `failed` and invite a
    retry). Monday answers 200 with `errors` for a refused query: map it, as `linear.ts` does. Target:
    the board ID (digits). The source has no URL.
  - Notion: `POST https://api.notion.com/v1/pages` with `Notion-Version: 2022-06-28`,
    `parent.database_id`, the title in `properties.title.title[0].text.content`, and the paragraphs as
    `paragraph` blocks with plain `rich_text` (at most 2000 characters each). The target rule exists
    (a UUID). Result: `id`; keep `url` only on `https://www.notion.so`.
  - Trello (after its connect lane): `POST https://api.trello.com/1/cards` with `idList`, `name`,
    `desc` and `pos: "top"`. Send the key and token in the
    `authorization: OAuth oauth_consumer_key="<key>", oauth_token="<token>"` header, not in the query
    string as the source does. Target: the list ID (24 hexadecimal characters). Result: `id`; keep
    `shortUrl` only on `https://trello.com`.

### P3: HubSpot, Intercom, Zendesk, Salesforce and customer context

- **HubSpot** (`hubspot`): `hosts: /^(app\.hubspot|api\.hubapi)\.com$/`. It has `refresh` and `contact`.
- **Intercom** (`intercom`): `hosts: /^(app\.intercom\.com|api\.intercom\.io)$/`. It has `contact`.
- **Zendesk** (`zendesk`): `connectFields: { subdomain: … }` (see "Connect fields").
  - `hosts: /^[a-z0-9-]+\.zendesk\.com$/`.
  - `exchange` stores `config.subdomain`. `contact` checks it again before it builds the host.
  - The contract fixture already sends `subdomain=contract`.
- **Salesforce** (`salesforce`): no connect field. The reference signs in through
  `login.salesforce.com`, and the token response names the instance (`instance_url`).
  - Check the instance host (HTTPS, a Salesforce domain suffix) before you store it in `config`.
  - `refresh` cannot change the stored instance (see "Rules").
- **Routes:** add the contacts route and the customer context route as route modules (see "Contact
  lookup and customer context"). Each one adds one mount line and one fixture line.

### P4: Microsoft Teams

- **Teams** (`teams`): `hosts: /^(login\.microsoftonline|graph\.microsoft)\.com$/`. Teams uses refresh tokens.
  - `destinationKinds: { team: {}, channel: { parent: "team" } }`.
  - Channel IDs (`19:…@thread.tacv2`) fit the parent pattern, so a channel can also be a parent.
  - Sending channel messages needs tenant admin consent and a bot registration. It is delivery, so it
    is out of scope for #131. The connect and list entry points need only delegated Graph scopes
    (`Team.ReadBasic.All`, `Channel.ReadBasic.All`, `offline_access`). The reference also asks for
    `ChannelMessage.Send`; that scope is for delivery.
  - **Delivery** (follow "Add delivery to a provider"). The source hook posts a message for every event,
    so `events` lists all three delivered events.
    - Target: `<team ID>:<channel ID>`, split at the first `:` (a team ID is a GUID with no `:`; a
      channel ID such as `19:abc@thread.tacv2` has `:` and `@`). The channel route already accepts
      both. The rule: a GUID, `:`, then `19:` and 1 to 80 of `[A-Za-z0-9._-]`, `@thread.` and
      `[a-z0-9]{1,10}`. The total is at most 100 characters (the mapping column).
    - Scopes: add `ChannelMessage.Send` to the requested scopes, store
      `config.scopes: grantedScopes(answer, scope)`, and set `deliveryScopes: ["ChannelMessage.Send"]`.
      A connection made before then gets the fixed reconnect state; say in the docs that it must
      reconnect.
    - Call: `POST https://graph.microsoft.com/v1.0/teams/<team ID>/channels/<channel ID>/messages`,
      each ID with `encodeURIComponent`, body `{ body: { contentType: "html", content } }` with every
      part escaped (`chatText(d)` gives the text).
    - A message is not a create: return no `result` (no link), as Slack does, and catch the error to
      return `callFailed(error, false)` if a 5xx may wait for a retry. Graph throttles with 429, which
      the worker retries.
