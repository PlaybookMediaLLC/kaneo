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

const hosts = /^api\.notion\.com$/;
const api = "https://api.notion.com/v1";
const json = { "content-type": "application/json", accept: "application/json" };
// A Notion ID is a UUID with dashes.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const notion = {
  name: "Notion",
  hosts,
  category: "issue_tracking",
  description: "Connect a Notion workspace and list its databases.",
  events: [],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `${api}/oauth/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      owner: "user",
      state,
    })}`,
  // The OAuth app authenticates with HTTP Basic. Notion access tokens do not expire.
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson(
        `${api}/oauth/token`,
        {
          method: "POST",
          headers: {
            ...json,
            authorization: `Basic ${Buffer.from(`${creds.clientId ?? ""}:${creds.clientSecret ?? ""}`).toString("base64")}`,
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        },
        hosts,
      ),
    );
    const accessToken = text(token.access_token);
    if (!accessToken) throw rejected();
    return {
      secrets: { accessToken },
      workspaceName: text(token.workspace_name) || "Notion",
      account: text(record(record(token.owner).user).name) || null,
    };
  },
  // The databases that the teammate shared with the integration, most recently edited first.
  destinations: async (secrets) => {
    const results = record(
      await providerJson(
        `${api}/search`,
        {
          method: "POST",
          headers: {
            ...json,
            authorization: `Bearer ${secrets.accessToken ?? ""}`,
            "notion-version": "2022-06-28",
          },
          body: JSON.stringify({
            filter: { property: "object", value: "database" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            page_size: 100,
          }),
        },
        hosts,
      ),
    ).results;
    if (!Array.isArray(results)) throw new ProviderCallError(502);
    return results
      .map(record)
      .filter((database) => uuid.test(text(database.id)))
      .map((database) => ({
        id: text(database.id),
        name:
          list(database.title)
            .map((part) => text(record(part).plain_text))
            .join("") || "Untitled",
      }));
  },
  statuses: [],
  // A channel ID is a database ID, which the default rule (30 letters and digits) refuses.
  target: (target) => uuid.test(target),
} satisfies OAuthProvider;
