// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

const hosts = /^(app|api)\.clickup\.com$/;
const api = "https://api.clickup.com/api/v2";
// ClickUp team, space and list IDs are digits. The same rule keeps them safe in a URL and valid as channel IDs.
const id = /^[A-Za-z0-9]{1,30}$/;
const bearer = (accessToken: string) => ({
  headers: { authorization: `Bearer ${accessToken}` },
});

/** The spaces or lists of a ClickUp answer. 502 when the answer has no such list. */
function named(value: unknown) {
  if (!Array.isArray(value)) throw new ProviderCallError(502);
  return value
    .map(record)
    .filter((item) => id.test(text(item.id)))
    .map((item) => ({ id: text(item.id), name: text(item.name) }));
}

export const clickup = {
  name: "ClickUp",
  hosts,
  category: "issue_tracking",
  description: "Connect a ClickUp workspace and list its spaces and lists.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://app.clickup.com/api?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      state,
    })}`,
  // ClickUp access tokens do not expire.
  exchange: async (code, _redirectUri, creds) => {
    const token = record(
      await providerJson(
        `${api}/oauth/token`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
          }),
        },
        hosts,
      ),
    );
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    // The spaces come from one ClickUp workspace (a team in the API): the first one, as in the source.
    const team = record(
      list(
        record(await providerJson(`${api}/team`, bearer(accessToken), hosts))
          .teams,
      )[0],
    );
    const teamId = text(team.id);
    if (!id.test(teamId)) throw rejected();
    return {
      secrets: { accessToken },
      workspaceName: text(team.name) || "ClickUp",
      account: null,
      config: { teamId },
    };
  },
  destinationKinds: { space: {}, list: { parent: "space" } },
  // A list is a folderless list of a space. The route checked that the space is one of this team's spaces.
  destinations: async (secrets, config, _creds, scope) => {
    const auth = bearer(secrets.accessToken ?? "");
    if (scope.kind === "list")
      return named(
        record(
          await providerJson(
            `${api}/space/${encodeURIComponent(scope.parent ?? "")}/list`,
            auth,
            hosts,
          ),
        ).lists,
      );
    const teamId = text(config.teamId);
    if (!id.test(teamId)) return [];
    return named(
      record(await providerJson(`${api}/team/${teamId}/space`, auth, hosts))
        .spaces,
    );
  },
  statuses: [],
} satisfies OAuthProvider;
