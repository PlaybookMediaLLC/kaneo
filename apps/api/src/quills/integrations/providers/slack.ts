// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  form,
  formHeaders,
  list,
  record,
  rejected,
  text,
  type OAuthProvider,
} from "../oauth-providers";

export const slack = {
  name: "Slack",
  category: "notifications",
  description: "Post feedback events to Slack channels.",
  events: ["post.created", "post.status_changed", "comment.created"],
  channels: true,
  credentials: ["clientId", "clientSecret"],
  authorizeUrl: (creds, redirectUri, state) =>
    `https://slack.com/oauth/v2/authorize?${form({
      client_id: creds.clientId!,
      redirect_uri: redirectUri,
      state,
      scope: "chat:write,channels:read",
    })}`,
  exchange: async (code, redirectUri, creds) => {
    const token = record(
      await providerJson("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: formHeaders,
        body: form({
          client_id: creds.clientId ?? "",
          client_secret: creds.clientSecret ?? "",
          code,
          redirect_uri: redirectUri,
        }),
      }),
    );
    // Slack answers 200 with ok: false for a rejected code.
    const accessToken = text(token.access_token);
    if (token.ok !== true || !accessToken) throw rejected();
    const team = record(token.team);
    return {
      secrets: { accessToken },
      workspaceName: text(team.name) || "Slack",
      account: text(team.name) || null,
      config: { teamId: text(team.id) },
    };
  },
  destinations: async (secrets) => {
    const answer = record(
      await providerJson(
        "https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200",
        { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
      ),
    );
    if (answer.ok !== true) throw new ProviderCallError(401);
    return list(answer.channels)
      .map(record)
      .map((channel) => ({
        id: text(channel.id),
        name: `#${text(channel.name)}`,
      }));
  },
  statuses: [],
} satisfies OAuthProvider;
