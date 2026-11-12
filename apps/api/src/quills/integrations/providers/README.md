# OAuth and key providers

Each provider is one file in this folder. `index.ts` collects the files in one registry,
`oauthProviders`. The registry drives:

- the catalog entry (`../catalog.ts`),
- the connect route `GET /quills/{workspaceId}/oauth/<key>/connect` and its OpenAPI operation,
- the `type` values of the OAuth callback and of the platform-credential routes,
- the destinations route (`GET /integrations/{integrationId}/destinations`),
- the token refresh in routes (`freshSecrets`),
- the hosts that tests send to the local provider server.

Issue #131 counts the connect and list entry points only. Delivery (the worker) and status sync are
out of scope.

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
   provider. Write fixtures for your own new routes in
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
- **`events: []`.** Keep it empty until the worker (`jobs/handlers/integration-send.ts`) sends for the
  provider. A provider with events and no worker code fails each delivery.
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
| `callback: "fragment"` | The token comes back in the URL fragment; `exchange` gets the token | bridge page, token post |
| `connectFields` | Values that a teammate enters before the redirect | connect route, callback |
| `connectWithKey` | Connect with a key, not OAuth | the provider's own route module |
| `destinations`, `destinationKinds` | Channel targets, by kind | destinations route |
| `search` | Issue search in one channel | external-items route |
| `target` | Channel ID rule. Absent: 1 to 30 letters and digits | search, delivery |
| `refresh` | New token fields for a due access token | `freshSecrets` |
| `contact` | CRM lookup by email | the contacts route module (lane P3) |
| `statuses` | Statuses that an inbound webhook reports | status sync (not in #131) |

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

## Fragment providers (Trello)

Trello returns its token in the URL fragment (`#token=…`), not as a `code` query value. A server never
receives a fragment, so a page in the browser reads it and posts it back. A provider like this declares
`callback: "fragment"`. Then:

1. The redirect URI is the bridge page, not the callback: `<API origin>/api/quills-public/signed/oauth/<type>/bridge`.
   The credentials routes return it as `redirectUri`. For Trello, add its origin to the allowed origins
   of the Trello API key.
2. `GET /quills-public/signed/oauth/{type}/bridge?state=…` (`openQuillsOAuthBridge`) is a signed route
   with `raw: "text/html"`. It checks the state as the callback does, but with a receipt of its own: the
   page opens once for each state and does not use the state up. The page (`../oauth-bridge.ts`) reads
   `token` from `location.hash`, removes the fragment with `history.replaceState`, and only then posts
   `{ token }` as JSON to `callback` next to it, with `credentials: "same-origin"`. The framework sends
   the page with `Content-Security-Policy: default-src 'none'; script-src 'sha256-…'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
   `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.
3. `POST /quills-public/signed/oauth/{type}/callback?state=…` (`completeQuillsOAuthFragmentConnect`), for
   fragment providers only. `Origin` must be the API origin, and `Sec-Fetch-Site`, when sent, must be
   `same-origin`. Then the same `oauthState` checks: valid signature, unexpired, this provider, the
   same session account, still holds `quills:manage_settings`, single use. The token has at most 2,048
   characters. It never enters a URL, a log, an event or a response.
4. The route calls `exchange(token, …)` with no transaction open. For Trello, `exchange` checks the
   token format, then the token itself with `GET https://api.trello.com/1/members/me`, and returns it
   as the secret. Then the route calls `connect` in one scoped transaction (`integration.connected`).

The code callback (`GET /oauth/{type}/callback`) does not take a fragment provider: that path has no
`Origin` check, and a token must not travel in a query string.

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

### P2: Asana, ClickUp, Trello, Monday, Notion

- **Asana** (`asana`): `hosts: /^app\.asana\.com$/`. One kind (projects). Asana uses refresh tokens.
- **ClickUp** (`clickup`): `hosts: /^(app|api)\.clickup\.com$/`.
  `destinationKinds: { space: {}, list: { parent: "space" } }`.
- **Trello** (`trello`): `hosts: /^(api\.)?trello\.com$/`, `callback: "fragment"` (see "Fragment
  providers"). `destinationKinds: { board: {}, list: { parent: "board" } }`.
- **Monday** (`monday`): `hosts: /^(auth|api)\.monday\.com$/`. One kind (boards).
- **Notion** (`notion`): `hosts: /^api\.notion\.com$/`. One kind (databases). The token exchange uses
  HTTP Basic authentication with the client ID and secret.

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
