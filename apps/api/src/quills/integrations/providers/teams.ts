// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  expiresAt,
  form,
  formHeaders,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

// Delegated scopes only: a teammate can consent unless the tenant restricts user consent
// (ROUTES-OAUTH.md, "Microsoft Teams"). Sending to a channel is delivery and needs more.
const scope = "Team.ReadBasic.All Channel.ReadBasic.All offline_access";
// Work and school accounts of any tenant. Personal accounts cannot use the Teams Graph APIs.
const login = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
const graph = "https://graph.microsoft.com";
const hosts = /^(login\.microsoftonline|graph\.microsoft)\.com$/;
const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const channelId = /^19:[\w.=+-]{1,200}@thread\.[a-z0-9]{1,20}$/i;

/** A token request. A missing access token is an empty string; the caller decides the error. */
async function token(
  grant: Record<string, string>,
  creds: Record<string, string>,
) {
  const answer = record(
    await providerJson(
      `${login}/token`,
      {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          scope,
          ...grant,
        }),
      },
      hosts,
    ),
  );
  return {
    accessToken: text(answer.access_token),
    refreshToken: text(answer.refresh_token),
    expiresAt: expiresAt(answer),
  };
}

/**
 * The `value` items of a Graph list. It follows `@odata.nextLink` only on the Graph origin, for at
 * most 10 pages and 200 items. A link to another host ends the list: the token never leaves Graph.
 */
async function graphList(path: string, accessToken: string) {
  const items: Record<string, unknown>[] = [];
  let next: string | null = `${graph}${path}`;
  for (let page = 0; next && page < 10 && items.length < 200; page++) {
    const answer = record(
      await providerJson(
        next,
        { headers: { authorization: `Bearer ${accessToken}` } },
        hosts,
      ),
    );
    if (!Array.isArray(answer.value)) throw new ProviderCallError(502);
    items.push(...answer.value.map(record));
    const link = URL.parse(text(answer["@odata.nextLink"]));
    next =
      link?.origin === graph && !link.username && !link.password
        ? link.href
        : null;
  }
  return items.slice(0, 200);
}

export const teams = {
  name: "Microsoft Teams",
  hosts,
  category: "notifications",
  description: "List the Microsoft Teams teams and channels of a connection.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `${login}/authorize?${form({
      client_id: creds.clientId!,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope,
      state,
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const secrets = await token(
      { code, grant_type: "authorization_code", redirect_uri: redirectUri },
      creds,
    );
    if (!secrets.accessToken) throw rejected();
    // The tenant name needs User.Read, which this connection does not ask for.
    return { secrets, workspaceName: "Microsoft Teams", account: null };
  },
  destinationKinds: { team: {}, channel: { parent: "team" } },
  destinations: async (secrets, _config, _creds, { kind, parent }) => {
    const accessToken = secrets.accessToken ?? "";
    if (kind !== "channel")
      return (await graphList("/v1.0/me/joinedTeams", accessToken))
        .filter((team) => guid.test(text(team.id)))
        .map((team) => ({ id: text(team.id), name: text(team.displayName) }));
    // The route checked that the parent is a listed team. Check the pattern again before the path.
    if (!guid.test(parent ?? "")) return [];
    return (
      await graphList(
        `/v1.0/teams/${encodeURIComponent(parent!)}/channels?$select=id,displayName`,
        accessToken,
      )
    )
      .filter((channel) => channelId.test(text(channel.id)))
      .map((channel) => ({
        id: text(channel.id),
        name: text(channel.displayName),
      }));
  },
  statuses: [],
  // Access tokens expire after about one hour. Microsoft returns a new refresh token each time.
  refresh: async (secrets, creds) => {
    const next = await token(
      {
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken ?? "",
      },
      creds,
    ).catch((error: unknown) => {
      // invalid_grant: the grant or the consent is gone. Reconnect.
      if (error instanceof ProviderCallError && error.status === 400)
        throw new ProviderCallError(401);
      throw error;
    });
    if (!next.accessToken) throw new ProviderCallError(401);
    return {
      ...next,
      refreshToken: next.refreshToken || (secrets.refreshToken ?? ""),
    };
  },
} satisfies OAuthProvider;
